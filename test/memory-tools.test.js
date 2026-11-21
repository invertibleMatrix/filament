import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryHandle } from "../src/services/memory/port.js";
import { memoryToolDefs, attachMemoryTools, detachMemoryTools, isMemoryTool, parseReply, ourCalls, otherCalls, mergeJsonRounds, stripOurTools, appendFollowUp, createMemoryToolStream, genericFromStream, executeMemoryTool, sumUsage, clientUsageOf, totalUsageOf, applyCueJson, createCueStream } from "../src/memory-tools.js";

const sse = (obj, event) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(obj)}\n\n`;
const events = (text) => text.split("\n\n").filter(Boolean).map((b) => { const d = b.split("\n").find((l) => l.startsWith("data:")).slice(5).trim(); return d === "[DONE]" ? "[DONE]" : JSON.parse(d); });

test("tool definitions and attach/detach in all three formats", () => {
  assert.equal(memoryToolDefs("anthropic")[0].name, "filament_memory_search"); assert.ok(memoryToolDefs("anthropic")[0].input_schema.required.includes("query"));
  assert.equal(memoryToolDefs("openai")[2].function.name, "filament_memory_load"); assert.equal(memoryToolDefs("responses")[3].name, "filament_memory_remember"); assert.equal(memoryToolDefs("responses")[3].type, "function");
  const body = { tools: [{ name: "Read", input_schema: { type: "object" } }] };
  assert.equal(attachMemoryTools("anthropic", body), 9); assert.equal(attachMemoryTools("anthropic", body), 0, "idempotent"); assert.equal(body.tools.length, 10);
  detachMemoryTools(body); assert.equal(body.tools.length, 1);
  const rb = { input: "hi" }; const chat = {}; attachMemoryTools("responses", chat, rb); assert.equal(rb.tools.length, 9); assert.equal(rb.tools[0].parameters.type, "object"); assert.equal(chat.tools[0].type, "function");
  assert.ok(isMemoryTool("filament_memory_search") && !isMemoryTool("Read"));
});

test("parseReply and JSON merging: Anthropic", () => {
  const r1 = { id: "m1", model: "x", stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: "text", text: "Let me check." }, { type: "tool_use", id: "t1", name: "filament_memory_search", input: { query: "tray loop" } }] };
  const g = parseReply("anthropic", r1); assert.equal(ourCalls(g).length, 1); assert.equal(otherCalls(g).length, 0); assert.equal(g.stopReason, "tool_use");
  const r2 = { id: "m2", model: "x", stop_reason: "end_turn", usage: { input_tokens: 300, output_tokens: 50 }, content: [{ type: "text", text: "Found it: the tray restarts twice because…" }] };
  const merged = mergeJsonRounds("anthropic", [r1, r2]);
  assert.deepEqual(merged.content.map((b) => b.type), ["text", "text"]); assert.equal(merged.stop_reason, "end_turn");
  assert.deepEqual(merged.usage, { input_tokens: 100, output_tokens: 70, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, "the client sees the first round's prompt, not the loop total");
  assert.deepEqual(totalUsageOf("anthropic", [r1.usage, r2.usage]), { input: 400, output: 70 }, "the record's total sums every round");
  const mixed = { content: [{ type: "tool_use", id: "a", name: "Read", input: {} }, { type: "tool_use", id: "b", name: "filament_memory_search", input: { query: "x" } }], stop_reason: "tool_use" };
  assert.deepEqual(stripOurTools("anthropic", mixed).content.map((b) => b.name), ["Read"]);
});

test("parseReply and merging: OpenAI chat and Responses", () => {
  const o1 = { id: "c1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "filament_memory_sessions", arguments: "{\"query\":\"grok\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  const g = parseReply("openai", o1); assert.equal(ourCalls(g)[0].input.query, "grok");
  const o2 = { id: "c2", choices: [{ message: { role: "assistant", content: "Two sessions match." }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 } };
  const m = mergeJsonRounds("openai", [o1, o2]); assert.equal(m.choices[0].message.content, "Two sessions match."); assert.deepEqual(m.usage, { prompt_tokens: 10, completion_tokens: 13, total_tokens: 23 }, "client usage = round one's prompt + summed output"); assert.deepEqual(totalUsageOf("openai", [o1.usage, o2.usage]), { input: 50, output: 13 }); assert.equal(m.choices[0].message.tool_calls, undefined);
  const only = stripOurTools("openai", o1); assert.equal(only.choices[0].finish_reason, "stop"); assert.equal(only.choices[0].message.tool_calls, undefined);
  const r1 = { id: "resp_1", object: "response", status: "completed", output: [{ type: "function_call", id: "fc_1", call_id: "call_9", name: "filament_memory_load", arguments: "{\"session\":\"abc\"}" }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } };
  const gr = parseReply("responses", r1); assert.equal(ourCalls(gr)[0].callId, "call_9"); assert.equal(ourCalls(gr)[0].input.session, "abc");
  const r2 = { id: "resp_2", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Loaded." }] }], usage: { input_tokens: 50, output_tokens: 4, total_tokens: 54 } };
  const mr = mergeJsonRounds("responses", [r1, r2]); assert.deepEqual(mr.output.map((it) => it.type), ["message"]); assert.deepEqual(mr.usage, { input_tokens: 5, output_tokens: 7, total_tokens: 12 }); assert.deepEqual(totalUsageOf("responses", [r1.usage, r2.usage]), { input: 55, output: 7 });
  // cache fields survive into the client view and into the total
  const c1 = { usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 40 } };
  const c2 = { usage: { input_tokens: 700, output_tokens: 5 } };
  assert.deepEqual(clientUsageOf("anthropic", [c1.usage, c2.usage]), { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 500, cache_creation_input_tokens: 40 });
  assert.deepEqual(totalUsageOf("anthropic", [c1.usage, c2.usage]), { input: 710, output: 7, cacheRead: 500, cacheWrite: 40 });
});

test("appendFollowUp writes the assistant turn and results in each client format", () => {
  const g = { blocks: [{ type: "thinking", thinking: "hmm", signature: "sig" }, { type: "text", text: "Checking memory." }, { type: "tool_use", id: "t1", name: "filament_memory_search", input: { query: "q" } }], reasoning: "" };
  const a = { messages: [{ role: "user", content: "hi" }] };
  appendFollowUp({ format: "anthropic", body: a, generic: g, results: [{ id: "t1", output: "{\"results\":[]}" }] });
  assert.equal(a.messages.length, 3); assert.deepEqual(a.messages[1].content.map((b) => b.type), ["thinking", "text", "tool_use"]); assert.equal(a.messages[2].content[0].type, "tool_result"); assert.equal(a.messages[2].content[0].tool_use_id, "t1");
  const a2 = { messages: [{ role: "user", content: "hi" }] }; appendFollowUp({ format: "anthropic", body: a2, generic: g, results: [{ id: "t1", output: "x" }], sameFormat: false });
  assert.deepEqual(a2.messages[1].content.map((b) => b.type), ["text", "tool_use"], "thinking is not passed back across formats");
  const o = { messages: [{ role: "user", content: "hi" }] }; appendFollowUp({ format: "openai", body: o, generic: { ...g, reasoning: "r" }, results: [{ id: "t1", output: "x" }] });
  assert.equal(o.messages[1].tool_calls[0].function.name, "filament_memory_search"); assert.equal(o.messages[1].reasoning_content, "r"); assert.equal(o.messages[2].role, "tool"); assert.equal(o.messages[2].tool_call_id, "t1");
  const rb = { input: "hi", store: false }; const mirror = { messages: [{ role: "user", content: "hi" }] };
  appendFollowUp({ format: "responses", body: mirror, responsesBody: rb, passthrough: true, generic: { blocks: [{ type: "tool_use", id: "fc1", callId: "call_1", name: "filament_memory_sessions", input: { query: "x" } }] }, results: [{ id: "fc1", callId: "call_1", output: "{}" }] });
  assert.deepEqual(rb.input.map((it) => it.type), ["message", "function_call", "function_call_output"]); assert.equal(rb.input[0].role, "user");
  const rb2 = { input: [{ role: "user", content: "hi" }] }; appendFollowUp({ format: "responses", body: { messages: [] }, responsesBody: rb2, passthrough: true, generic: { blocks: [{ type: "tool_use", id: "fc1", callId: "call_1", name: "filament_memory_sessions", input: {} }] }, results: [{ id: "fc1", callId: "call_1", output: "{}" }], responseId: "resp_1" });
  assert.equal(rb2.previous_response_id, "resp_1"); assert.deepEqual(rb2.input.map((it) => it.type), ["function_call_output"], "stored responses chain by id");
});

test("stream (Anthropic): text flows, the memory tool block is withheld, the follow-up continues with renumbered indices and one terminal", () => {
  const s = createMemoryToolStream("anthropic");
  let out = "";
  out += s.push(sse({ type: "message_start", message: { id: "m1", model: "claude", usage: { input_tokens: 100, output_tokens: 1 } } }, "message_start"));
  out += s.push(sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start"));
  out += s.push(sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check memory." } }, "content_block_delta"));
  out += s.push(sse({ type: "content_block_stop", index: 0 }, "content_block_stop"));
  out += s.push(sse({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "filament_memory_search", input: {} } }, "content_block_start"));
  out += s.push(sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\":" } }, "content_block_delta"));
  out += s.push(sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "\"tray loop\"}" } }, "content_block_delta"));
  out += s.push(sse({ type: "content_block_stop", index: 1 }, "content_block_stop"));
  out += s.push(sse({ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 30 } }, "message_delta"));
  out += s.push(sse({ type: "message_stop" }, "message_stop"));
  const r1 = s.endResponse(); out += r1.forwarded;
  assert.equal(r1.needsFollowUp, true); assert.equal(r1.ours[0].input.query, "tray loop"); assert.equal(r1.stopReason, "tool_use");
  const ev1 = events(out); assert.deepEqual(ev1.map((e) => e.type), ["message_start", "content_block_start", "content_block_delta", "content_block_stop"], "tool block and terminal withheld");
  const g = genericFromStream(r1.generic); assert.deepEqual(g.blocks.map((b) => b.type), ["text", "tool_use"]); assert.equal(g.blocks[1].input.query, "tray loop");
  // follow-up round
  s.nextResponse(); let out2 = "";
  out2 += s.push(sse({ type: "message_start", message: { id: "m2", model: "claude", usage: { input_tokens: 400, output_tokens: 1 } } }, "message_start"));
  out2 += s.push(sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start"));
  out2 += s.push(sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " Found the fix from July." } }, "content_block_delta"));
  out2 += s.push(sse({ type: "content_block_stop", index: 0 }, "content_block_stop"));
  out2 += s.push(sse({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }, "message_delta"));
  out2 += s.push(sse({ type: "message_stop" }, "message_stop"));
  const r2 = s.endResponse(); out2 += r2.forwarded; assert.equal(r2.needsFollowUp, false);
  const ev2 = events(out2);
  assert.deepEqual(ev2.map((e) => e.type), ["content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"], "no second message_start");
  assert.equal(ev2[0].index, 1, "renumbered after the visible text block"); assert.equal(ev2[1].index, 1);
  assert.equal(ev2[3].usage.output_tokens, 42, "output summed across rounds (all visible text is kept)"); assert.equal(ev2[3].usage.input_tokens, 100, "input stays the first round's prompt: the client's context meter must not see the loop total");
  assert.deepEqual(s.totalUsage(), { input: 500, output: 42 }, "the record's total sums every round");
});

test("stream (Anthropic): events with no memory tool are forwarded as the original SSE bytes", () => {
  const s = createMemoryToolStream("anthropic");
  // Compact `data:` (no space) would be rewritten as `data: {…}` if the interceptor re-serialized.
  const ping = "event: ping\ndata:{\"type\":\"ping\"}\n\n";
  const raw = sse({ type: "message_start", message: { id: "m1", model: "claude", usage: { input_tokens: 3, output_tokens: 0 } } }, "message_start")
    + ping
    + sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start")
    + sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }, "content_block_delta")
    + sse({ type: "content_block_stop", index: 0 }, "content_block_stop")
    + sse({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }, "message_delta")
    + sse({ type: "message_stop" }, "message_stop");
  const out = s.push(raw);
  const r = s.endResponse();
  assert.equal(r.needsFollowUp, false);
  assert.equal(out + r.forwarded, raw, "byte-identical pass-through when no memory tool appears");
  assert.ok((out + r.forwarded).includes("data:{\"type\":\"ping\"}"), "compact data: frames are not re-serialized");
});

test("stream (Anthropic): a reply mixing a client tool and a memory tool is not looped; the memory call is deferred", () => {
  const s = createMemoryToolStream("anthropic"); let out = "";
  out += s.push(sse({ type: "message_start", message: { id: "m1", usage: { input_tokens: 1, output_tokens: 1 } } }, "message_start"));
  out += s.push(sse({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "a", name: "Read", input: {} } }, "content_block_start"));
  out += s.push(sse({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"file_path\":\"x\"}" } }, "content_block_delta"));
  out += s.push(sse({ type: "content_block_stop", index: 0 }, "content_block_stop"));
  out += s.push(sse({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "b", name: "filament_memory_search", input: {} } }, "content_block_start"));
  out += s.push(sse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"query\":\"x\"}" } }, "content_block_delta"));
  out += s.push(sse({ type: "content_block_stop", index: 1 }, "content_block_stop"));
  out += s.push(sse({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } }, "message_delta"));
  out += s.push(sse({ type: "message_stop" }, "message_stop"));
  const r = s.endResponse(); out += r.forwarded;
  assert.equal(r.needsFollowUp, false); assert.equal(r.deferred.length, 1); assert.equal(r.deferred[0].input.query, "x");
  const ev = events(out); assert.deepEqual(ev.map((e) => e.type), ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
  assert.equal(ev[1].content_block.name, "Read");
});

test("stream (OpenAI chat): a function.name that arrives on a later delta still withholds a memory tool", () => {
  const s = createMemoryToolStream("openai"); let out = "";
  const chunk = (delta, finish = null) => sse({ id: "c1", object: "chat.completion.chunk", model: "gpt", choices: [{ index: 0, delta, finish_reason: finish }] });
  out += s.push(chunk({ role: "assistant" }));
  out += s.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { arguments: "" } }] }));
  out += s.push(chunk({ tool_calls: [{ index: 0, function: { name: "filament_memory_search", arguments: "{\"query\":\"x\"}" } }] }));
  out += s.push(chunk({}, "tool_calls"));
  out += s.push("data: [DONE]\n\n");
  const r = s.endResponse(); out += r.forwarded;
  assert.equal(r.needsFollowUp, true);
  assert.equal(r.ours[0].input.query, "x");
  assert.equal(out.includes("filament_memory"), false, "the late name never reaches the client");
  assert.equal(events(out).some((e) => e !== "[DONE]" && e.choices?.[0]?.finish_reason), false, "the terminal is held");
});

test("stream (OpenAI chat): a final event the upstream did not terminate with a blank line is still forwarded at endResponse", () => {
  // Legal SSE at EOF: `data: [DONE]\n` with no blank line after it. endResponse() flushed that tail through push()
  // and threw push()'s return value away, so the client never saw the terminator — a silent loss on the client.
  const s = createMemoryToolStream("openai"); let out = "";
  const chunk = (delta, finish = null) => sse({ id: "c1", object: "chat.completion.chunk", model: "gpt", choices: [{ index: 0, delta, finish_reason: finish }] });
  out += s.push(chunk({ role: "assistant" }));
  out += s.push(chunk({ content: "hello" }));
  out += s.push(chunk({}, "stop"));
  out += s.push("data: [DONE]\n");
  const r = s.endResponse(); out += r.forwarded;
  assert.equal(r.needsFollowUp, false);
  assert.ok(out.includes("data: [DONE]"), `the unterminated terminator reaches the client: ${JSON.stringify(out)}`);
  assert.deepEqual(events(out).at(-1), "[DONE]");
});

test("stream (OpenAI chat): a late-arriving client tool name is forwarded once classified", () => {
  const s = createMemoryToolStream("openai"); let out = "";
  const chunk = (delta, finish = null) => sse({ id: "c1", object: "chat.completion.chunk", model: "gpt", choices: [{ index: 0, delta, finish_reason: finish }] });
  out += s.push(chunk({ role: "assistant" }));
  out += s.push(chunk({ tool_calls: [{ index: 0, id: "call_9", type: "function", function: { arguments: "{\"p\":1}" } }] }));
  out += s.push(chunk({ tool_calls: [{ index: 0, function: { name: "Read" } }] }));
  out += s.push(chunk({}, "tool_calls"));
  const r = s.endResponse(); out += r.forwarded;
  assert.equal(r.needsFollowUp, false);
  const names = events(out).flatMap((e) => (e.choices?.[0]?.delta?.tool_calls || []).map((t) => t.function?.name)).filter(Boolean);
  assert.deepEqual(names, ["Read"]);
  assert.ok(events(out).some((e) => e.choices?.[0]?.finish_reason === "tool_calls"));
});

test("stream (OpenAI chat): a memory-free reply is forwarded including compact data: frames", () => {
  const s = createMemoryToolStream("openai");
  const compact = "data:{\"id\":\"c1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"},\"finish_reason\":null}]}\n\n";
  const out = s.push(compact + "data: [DONE]\n\n");
  const r = s.endResponse();
  assert.equal(r.needsFollowUp, false);
  assert.ok((out + r.forwarded).includes("data:{\"id\":\"c1\""), "OpenAI pass-through keeps compact frames");
});

test("stream (OpenAI chat): tool_call deltas for memory tools are withheld, [DONE] held until the follow-up finishes, usage summed", () => {
  const s = createMemoryToolStream("openai"); let out = "";
  const chunk = (delta, finish = null, extra = {}) => sse({ id: "c1", object: "chat.completion.chunk", model: "gpt", choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
  out += s.push(chunk({ role: "assistant", content: "" }));
  out += s.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "filament_memory_sessions", arguments: "" } }] }));
  out += s.push(chunk({ tool_calls: [{ index: 0, function: { arguments: "{\"query\":\"grok\"}" } }] }));
  out += s.push(chunk({}, "tool_calls"));
  out += s.push(sse({ id: "c1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  out += s.push("data: [DONE]\n\n");
  const r1 = s.endResponse(); out += r1.forwarded; assert.equal(r1.needsFollowUp, true); assert.equal(r1.ours[0].input.query, "grok");
  const ev1 = events(out); assert.equal(ev1.length, 1, "only the role chunk went through"); assert.equal(ev1[0].choices[0].delta.role, "assistant");
  s.nextResponse(); let out2 = "";
  out2 += s.push(chunk({ role: "assistant", content: "" })); out2 += s.push(chunk({ content: "Two sessions match." })); out2 += s.push(chunk({}, "stop"));
  out2 += s.push(sse({ id: "c2", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 } }));
  out2 += s.push("data: [DONE]\n\n");
  const r2 = s.endResponse(); out2 += r2.forwarded; assert.equal(r2.needsFollowUp, false);
  const ev2 = events(out2); assert.equal(ev2.at(-1), "[DONE]"); const usage = ev2.find((e) => e !== "[DONE]" && e.usage)?.usage; assert.ok(usage, "usage chunk forwarded"); assert.deepEqual(usage, { prompt_tokens: 10, completion_tokens: 13, total_tokens: 23 }, "the client sees round one's prompt plus the summed output");
  assert.deepEqual(s.totalUsage(), { input: 50, output: 13 }, "the record keeps every round's total");
  assert.ok(ev2.some((e) => e !== "[DONE]" && e.choices?.[0]?.finish_reason === "stop"));
});

test("stream (Responses): function_call items for memory tools are withheld; response.completed of the last round merges output and usage", () => {
  const s = createMemoryToolStream("responses"); let out = "";
  out += s.push(sse({ type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress" } }, "response.created"));
  out += s.push(sse({ type: "response.output_item.added", sequence_number: 1, output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "filament_memory_load", arguments: "" } }, "response.output_item.added"));
  out += s.push(sse({ type: "response.function_call_arguments.delta", sequence_number: 2, output_index: 0, item_id: "fc_1", delta: "{\"session\":\"k1\"}" }, "response.function_call_arguments.delta"));
  out += s.push(sse({ type: "response.function_call_arguments.done", sequence_number: 3, output_index: 0, item_id: "fc_1", arguments: "{\"session\":\"k1\"}" }, "response.function_call_arguments.done"));
  out += s.push(sse({ type: "response.output_item.done", sequence_number: 4, output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "filament_memory_load", arguments: "{\"session\":\"k1\"}" } }, "response.output_item.done"));
  out += s.push(sse({ type: "response.completed", sequence_number: 5, response: { id: "resp_1", status: "completed", output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "filament_memory_load", arguments: "{\"session\":\"k1\"}" }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } }, "response.completed"));
  const r1 = s.endResponse(); out += r1.forwarded; assert.equal(r1.needsFollowUp, true); assert.equal(r1.ours[0].callId, "call_1"); assert.equal(r1.responseId, "resp_1");
  assert.deepEqual(events(out).map((e) => e.type), ["response.created"]);
  s.nextResponse(); let out2 = "";
  out2 += s.push(sse({ type: "response.created", sequence_number: 0, response: { id: "resp_2", status: "in_progress" } }, "response.created"));
  out2 += s.push(sse({ type: "response.output_item.added", sequence_number: 1, output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [] } }, "response.output_item.added"));
  out2 += s.push(sse({ type: "response.output_text.delta", sequence_number: 2, output_index: 0, item_id: "msg_1", content_index: 0, delta: "Loaded." }, "response.output_text.delta"));
  out2 += s.push(sse({ type: "response.output_item.done", sequence_number: 3, output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Loaded." }] } }, "response.output_item.done"));
  out2 += s.push(sse({ type: "response.completed", sequence_number: 4, response: { id: "resp_2", status: "completed", output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Loaded." }] }], usage: { input_tokens: 50, output_tokens: 4, total_tokens: 54 } } }, "response.completed"));
  const r2 = s.endResponse(); out2 += r2.forwarded; assert.equal(r2.needsFollowUp, false);
  const ev2 = events(out2); assert.deepEqual(ev2.map((e) => e.type), ["response.output_item.added", "response.output_text.delta", "response.output_item.done", "response.completed"], "no second response.created");
  assert.deepEqual(ev2.map((e) => e.sequence_number), [1, 2, 3, 4], "sequence numbers continue");
  assert.equal(ev2[0].output_index, 0, "first visible item"); assert.deepEqual(ev2[3].response.usage, { input_tokens: 5, output_tokens: 7, total_tokens: 12 }, "round one's prompt, summed output"); assert.deepEqual(ev2[3].response.output.map((it) => it.type), ["message"]);
});

// (fails before: yes — the bug hunt of 10-30, WIRE-5: an upstream that framed its events with CRLF had nothing forwarded
// until its reply ended, then all of it as one event — and a memory tool among it reached the client, never withheld)
test("stream: an upstream that frames its events with CRLF is read event by event, a CRLF cut between two pieces too", () => {
  const crlf = (/** @type {string} */ t) => t.replace(/\n/g, "\r\n");
  const s = createMemoryToolStream("anthropic");
  let out = s.push(crlf(sse({ type: "message_start", message: { id: "m1", model: "claude", usage: { input_tokens: 10, output_tokens: 1 } } }, "message_start")));
  assert.deepEqual(events(out).map((e) => e.type), ["message_start"], "forwarded as it comes, not held to the reply's end");
  const toolStart = crlf(sse({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "filament_memory_search", input: {} } }, "content_block_start"));
  out += s.push(toolStart.slice(0, -1)); // the piece ends between the blank line's CR and its LF
  out += s.push(toolStart.slice(-1) + crlf(sse({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":\"crlf\"}" } }, "content_block_delta")));
  out += s.push(crlf(sse({ type: "content_block_stop", index: 0 }, "content_block_stop") + sse({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } }, "message_delta") + sse({ type: "message_stop" }, "message_stop")));
  const r = s.endResponse(); out += r.forwarded;
  assert.equal(r.needsFollowUp, true); assert.equal(r.ours[0].input.query, "crlf");
  assert.equal(out.includes("filament_memory"), false, "the memory tool is withheld");
  assert.deepEqual(events(out).map((e) => e.type), ["message_start"]);
  // The cue stage reads the client's stream the same way.
  const cue = "Memory: 1 earlier session here.";
  const c = createCueStream("openai", cue);
  const chunk = (delta) => sse({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] });
  const evC = events(c.push(crlf(chunk({ role: "assistant", content: "" }) + chunk({ content: "Hi" }))));
  assert.deepEqual(evC.map((e) => e.choices[0].delta.content), ["", `${cue}\n\n`, "Hi"]);
  assert.equal(c.applied, true);
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a reply the upstream cut while a memory call's input streamed ran
// that call on its cut input and asked the model again, so the client was shown a whole reply where the upstream broke off)
test("stream: a reply cut before its end runs no memory round, whatever its format", () => {
  const a = createMemoryToolStream("anthropic");
  a.push(sse({ type: "message_start", message: { id: "m1", usage: { input_tokens: 5, output_tokens: 1 } } }, "message_start"));
  a.push(sse({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "filament_memory_search", input: {} } }, "content_block_start"));
  a.push(sse({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":\"tr" } }, "content_block_delta"));
  const ra = a.endResponse();
  assert.equal(ra.needsFollowUp, false, "Anthropic: no stop reason, no message_stop");
  assert.deepEqual(ra.deferred, []);
  const o = createMemoryToolStream("openai");
  const chunk = (delta, finish = null) => sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] });
  o.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "filament_memory_search", arguments: "{\"query\":\"tr" } }] }));
  assert.equal(o.endResponse().needsFollowUp, false, "Chat: no finish_reason, no [DONE]");
  const r = createMemoryToolStream("responses");
  r.push(sse({ type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress" } }, "response.created"));
  r.push(sse({ type: "response.output_item.added", sequence_number: 1, output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "filament_memory_search", arguments: "" } }, "response.output_item.added"));
  r.push(sse({ type: "response.function_call_arguments.delta", sequence_number: 2, output_index: 0, delta: "{\"query\":\"tr" }, "response.function_call_arguments.delta"));
  assert.equal(r.endResponse().needsFollowUp, false, "Responses: no final response");
  // The same call, its reply ended, runs as ever.
  const whole = createMemoryToolStream("openai");
  whole.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "filament_memory_search", arguments: "{\"query\":\"tray\"}" } }] }));
  whole.push(chunk({}, "tool_calls"));
  const rw = whole.endResponse();
  assert.equal(rw.needsFollowUp, true);
  assert.equal(rw.ours[0].input.query, "tray");
});

// (fails before: yes — the bug hunt of 10-30, WIRE P3: in a round the memory stage rewrites, a delta that spelled its
// thinking `reasoning` — OpenRouter's, Ollama's — carried nothing the stage counted, and was dropped on its way to the client)
test("stream (OpenAI chat): a follow-up round's reasoning-spelled thinking reaches the client", () => {
  const s = createMemoryToolStream("openai");
  const chunk = (delta, finish = null) => sse({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] });
  s.push(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "filament_memory_search", arguments: "{\"query\":\"x\"}" } }] }));
  s.push(chunk({}, "tool_calls"));
  s.push("data: [DONE]\n\n");
  assert.equal(s.endResponse().needsFollowUp, true);
  s.nextResponse();
  let out = s.push(chunk({ reasoning: "Weighing the two sessions." }));
  out += s.push(chunk({ content: "The second one." }));
  out += s.push(chunk({}, "stop"));
  out += s.push("data: [DONE]\n\n");
  out += s.endResponse().forwarded;
  const said = events(out).filter((e) => e !== "[DONE]").map((e) => e.choices?.[0]?.delta?.reasoning).filter(Boolean);
  assert.deepEqual(said, ["Weighing the two sessions."]);
});

test("executeMemoryTool dispatches to the brain and caps output", async () => {
  const asked = [];
  const brain = { search: async (q, o) => (asked.push(o), [{ id: "m1", kind: "fact", text: `about ${q}`, score: 0.7, chainId: "k1", turnId: 3, when: "2026-09-01" }]), sessions: (q) => [{ id: "k1", title: "t" }], load: (id, o) => ({ text: `session ${id} ${o.view}` }), remember: async (t, o) => ({ id: "m9" }), forget: async (id) => ({ ok: true }) };
  const scope = memoryHandle({ brain }, { role: "model", project: "p" });
  const s = JSON.parse(await executeMemoryTool(scope, "filament_memory_search", { query: "tray", limit: 5 })); assert.equal(s.results[0].session, "k1"); assert.equal(s.results[0].score, 0.7);
  await executeMemoryTool(scope, "filament_memory_search", { query: "tray", project_only: true, limit: 99 });
  assert.deepEqual(asked, [{ projectId: null, only: false, limit: 5, at: "p" }, { projectId: "p", only: true, limit: 30, at: "p" }], "every project, or the handle's own alone; at most 30; checked against the handle's folder (M3-4)");
  assert.equal(JSON.parse(await executeMemoryTool(scope, "filament_memory_sessions", { query: "x" })).sessions[0].id, "k1");
  assert.equal(await executeMemoryTool(scope, "filament_memory_load", { session: "k1", view: "summary" }), "session k1 summary");
  assert.equal(JSON.parse(await executeMemoryTool(scope, "filament_memory_remember", { text: "x" })).id, "m9");
  assert.equal(JSON.parse(await executeMemoryTool(scope, "filament_memory_forget", { id: "m1" })).ok, true);
  assert.ok(JSON.parse(await executeMemoryTool(scope, "filament_memory_nope", {})).error);
  assert.deepEqual(sumUsage([{ a: 1, n: { x: 2 } }, { a: 2, n: { x: 3 }, b: "s" }]), { a: 3, n: { x: 5 }, b: "s" });
});

test("cue: in front of the first text in JSON and streams of all three formats; nothing when the reply is only tool calls", () => {
  const cue = "Memory: 1 earlier session here (k1 tray loop). Say \"@mem load k1\" to bring one in.";
  const a = { content: [{ type: "text", text: "Hello" }] }; assert.equal(applyCueJson("anthropic", a, cue), true); assert.ok(a.content[0].text.startsWith(cue + "\n\nHello"));
  const o = { choices: [{ message: { role: "assistant", content: "Hi" } }] }; applyCueJson("openai", o, cue); assert.ok(o.choices[0].message.content.startsWith(cue));
  const r = { output: [{ type: "message", content: [{ type: "output_text", text: "Yo" }] }] }; applyCueJson("responses", r, cue); assert.ok(r.output[0].content[0].text.startsWith(cue));
  assert.equal(applyCueJson("anthropic", { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] }, cue), true, "a text block is added when there is none");
  // anthropic stream: the delta lands right after the first text block starts
  const sA = createCueStream("anthropic", cue);
  const outA = sA.push(sse({ type: "message_start", message: { id: "m" } }, "message_start") + sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start") + sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }, "content_block_delta"));
  const evA = events(outA); assert.deepEqual(evA.map((e) => e.type), ["message_start", "content_block_start", "content_block_delta", "content_block_delta"]); assert.equal(evA[2].delta.text, cue + "\n\n"); assert.equal(evA[3].delta.text, "Hello"); assert.equal(sA.applied, true);
  const sT = createCueStream("anthropic", cue); sT.push(sse({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "Read", input: {} } }, "content_block_start")); assert.equal(sT.applied, false, "tool-only replies get no cue");
  // openai stream: after the role chunk
  const sO = createCueStream("openai", cue); const chunk = (delta) => sse({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] });
  const evO = events(sO.push(chunk({ role: "assistant", content: "" }) + chunk({ content: "Hi" })));
  assert.equal(evO.length, 3); assert.equal(evO[0].choices[0].delta.role, "assistant"); assert.equal(evO[1].choices[0].delta.content, cue + "\n\n"); assert.equal(evO[2].choices[0].delta.content, "Hi");
  // responses stream: a delta before the first text delta, sequence numbers stay increasing, completed carries the cue
  const sR = createCueStream("responses", cue);
  const evR = events(sR.push(sse({ type: "response.created", sequence_number: 0, response: { id: "r" } }, "response.created") + sse({ type: "response.output_text.delta", sequence_number: 1, output_index: 0, item_id: "m", content_index: 0, delta: "Yo" }, "response.output_text.delta") + sse({ type: "response.completed", sequence_number: 2, response: { id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "Yo" }] }] } }, "response.completed")));
  assert.deepEqual(evR.map((e) => e.type), ["response.created", "response.output_text.delta", "response.output_text.delta", "response.completed"]); assert.equal(evR[1].delta, cue + "\n\n"); assert.deepEqual(evR.map((e) => e.sequence_number), [0, 1, 2, 3]); assert.ok(evR[3].response.output[0].content[0].text.startsWith(cue));
});
