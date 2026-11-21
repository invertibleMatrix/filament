// The OpenAI Responses API front door: translation to Chat Completions and back, conversation state, and a real
// Filament in front of a fake OpenAI-compatible upstream.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { responsesToChat, chatToResponse, createChatToResponsesStream, ResponseStore, carryAdded, carriesReturned } from "../src/responses.js";

test("responsesToChat: instructions, items, function calls and outputs, tools, text format, reasoning, limits", () => {
  const { chat, items, notes } = responsesToChat({ model: "m", instructions: "be brief", input: [
    { role: "user", content: [{ type: "input_text", text: "what is the weather?" }, { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "low" }] },
    { type: "function_call", call_id: "call_1", name: "get_weather", arguments: "{\"city\":\"Paris\"}" },
    { type: "function_call_output", call_id: "call_1", output: "sunny" },
    { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "thinking" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "It is sunny." }] },
    { role: "user", content: "thanks" },
  ], tools: [{ type: "function", name: "get_weather", description: "d", parameters: { type: "object", properties: {} }, strict: true }, { type: "web_search_preview" }], tool_choice: { type: "function", name: "get_weather" }, text: { format: { type: "json_schema", name: "out", schema: { type: "object" }, strict: true } }, reasoning: { effort: "high" }, max_output_tokens: 300, stream: true, temperature: 0.2 });
  assert.equal(chat.model, "m"); assert.deepEqual(chat.messages[0], { role: "system", content: "be brief" });
  assert.equal(chat.messages[1].role, "user"); assert.equal(chat.messages[1].content[0].text, "what is the weather?"); assert.equal(chat.messages[1].content[1].image_url.url, "data:image/png;base64,AAAA"); assert.equal(chat.messages[1].content[1].image_url.detail, "low");
  assert.equal(chat.messages[2].role, "assistant"); assert.equal(chat.messages[2].content, null); assert.equal(chat.messages[2].tool_calls[0].id, "call_1"); assert.equal(chat.messages[2].tool_calls[0].function.name, "get_weather"); assert.equal(chat.messages[2].tool_calls[0].function.arguments, "{\"city\":\"Paris\"}");
  assert.deepEqual(chat.messages[3], { role: "tool", tool_call_id: "call_1", content: "sunny" });
  assert.deepEqual(chat.messages[4], { role: "assistant", content: "It is sunny." });
  assert.deepEqual(chat.messages[5], { role: "user", content: "thanks" });
  assert.equal(chat.tools.length, 1); assert.equal(chat.tools[0].function.name, "get_weather"); assert.equal(chat.tools[0].function.strict, true);
  assert.deepEqual(chat.tool_choice, { type: "function", function: { name: "get_weather" } });
  assert.equal(chat.response_format.type, "json_schema"); assert.equal(chat.response_format.json_schema.name, "out"); assert.equal(chat.response_format.json_schema.strict, true);
  assert.equal(chat.reasoning_effort, "high"); assert.equal(chat.max_completion_tokens, 300); assert.equal(chat.stream, true); assert.deepEqual(chat.stream_options, { include_usage: true }); assert.equal(chat.temperature, 0.2);
  assert.equal(items.length, 6); assert.ok(notes.some((n) => n.includes("web_search_preview")), notes.join(" | ")); assert.ok(notes.some((n) => n.includes("reasoning items")));
  const simple = responsesToChat({ model: "m", input: "hi" }); assert.deepEqual(simple.chat.messages, [{ role: "user", content: "hi" }]); assert.equal(simple.chat.stream, false); assert.equal(simple.chat.stream_options, undefined);
  const dev = responsesToChat({ model: "m", input: [{ role: "developer", content: "rules" }, { role: "user", content: "q" }] }); assert.equal(dev.chat.messages[0].role, "system");
  assert.throws(() => responsesToChat({ model: "m" }), /input is required/);
  assert.throws(() => responsesToChat({ model: "m", input: "x", background: true }), /background/);
});

test("responsesToChat names the input item each person's and tool's message came from; carryAdded carries what was added to them onto copies of those items", () => {
  const body = { model: "m", instructions: "be brief", input: [
    "not an item",
    { role: "user", content: "read it" },
    { type: "function_call", call_id: "c1", name: "Read", arguments: "{}" },
    { type: "function_call_output", call_id: "c1", output: [{ type: "input_text", text: "file" }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }] },
    { type: "function_call_output", call_id: "c2", output: "plain" },
    { role: "user", content: [{ type: "input_text", text: "and now?" }] },
  ] };
  const conv = responsesToChat(body);
  assert.equal(conv.input, body.input, "with nothing before it, a passthrough sends the client's own input");
  assert.deepEqual(conv.sources.map((s) => [s.message.role, s.at, s.len]), [["user", 1, 7], ["tool", 3, 4], ["tool", 4, 5], ["user", 4, 2], ["user", 5, 8]], "the images a list output returned come from the run's last output");
  const [person, listed, , carried, newest] = conv.sources.map((s) => s.message);
  assert.equal(carriesReturned(carried), true); assert.equal(carriesReturned(person), false); assert.equal(carriesReturned({ role: "user", content: [{ type: "text", text: "[What tool call c1 (Read) returned:] is what I typed" }] }), false);
  person.content += "\n\n<block a>";
  listed.content += "\n\n<block t>";
  carried.content.push({ type: "text", text: "<block c>" });
  newest.content += "\n\n<block n>\n\n<block m>";
  const sent = { ...body };
  carryAdded(sent, conv.sources);
  assert.notEqual(sent.input, body.input);
  assert.equal(body.input[1].content, "read it", "the client's items stay as they came");
  assert.equal(sent.input[1].content, "read it\n\n<block a>");
  assert.deepEqual(sent.input[3].output.slice(1), [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }, { type: "input_text", text: "<block t>" }]);
  assert.equal(sent.input[4].output, "plain\n\n<block c>");
  assert.deepEqual(sent.input[5].content.slice(1), [{ type: "input_text", text: "<block n>\n\n<block m>" }]);
  assert.equal(sent.input[0], "not an item"); assert.equal(sent.input[2], body.input[2], "an item nothing was added to is the same item");
  const nothing = { ...body }; carryAdded(nothing, responsesToChat(body).sources); assert.equal(nothing.input, body.input, "nothing added, nothing replaced");
  // A string input is one message: what is added follows it.
  const s = { model: "m", input: "hi" }; const sc = responsesToChat(s); sc.chat.messages[0].content += "\n\n<b>"; carryAdded(s, sc.sources); assert.equal(s.input, "hi\n\n<b>");
  // (fails before: no — a guard the mutation pass asked for: an item that makes no message takes no place)
  assert.deepEqual(responsesToChat({ model: "m", input: [{ type: "item_reference", id: "r1" }, { role: "user", content: "after it" }] }).sources.map((x) => x.at), [1]);
  // A request that continues an earlier one: its input is the prior items and its own.
  const prior = [{ type: "message", role: "user", content: [{ type: "input_text", text: "earlier" }] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "yes" }] }];
  const pc = responsesToChat({ model: "m", input: "next" }, { prior });
  assert.deepEqual(pc.input.map((it) => it.content[0].text), ["earlier", "yes", "next"]); assert.deepEqual(pc.sources.map((x) => x.at), [0, 2]);
  pc.sources[0].message.content += "\n\n<b0>"; const ps = { model: "m", input: pc.input }; carryAdded(ps, pc.sources);
  assert.deepEqual(ps.input[0].content, [{ type: "input_text", text: "earlier" }, { type: "input_text", text: "<b0>" }]); assert.deepEqual(prior[0].content, [{ type: "input_text", text: "earlier" }], "the kept conversation's items stay as they were");
});

test("chatToResponse: reasoning, text and tool calls become output items; usage and status map", () => {
  const r = chatToResponse({ id: "c", model: "served-m", choices: [{ index: 0, message: { role: "assistant", content: "Hello", reasoning_content: "hmm", tool_calls: [{ id: "call_9", type: "function", function: { name: "f", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 2 } } }, { model: "m", input: "x", metadata: { a: "b" } }, { id: "resp_1", created: 1 });
  assert.equal(r.object, "response"); assert.equal(r.id, "resp_1"); assert.equal(r.created_at, 1); assert.equal(r.status, "completed"); assert.equal(r.model, "served-m");
  assert.deepEqual(r.output.map((it) => it.type), ["reasoning", "message", "function_call"]);
  assert.equal(r.output[0].summary[0].text, "hmm"); assert.equal(r.output[1].content[0].type, "output_text"); assert.equal(r.output[1].content[0].text, "Hello"); assert.equal(r.output[2].call_id, "call_9"); assert.equal(r.output[2].name, "f"); assert.equal(r.output[2].status, "completed");
  assert.deepEqual(r.usage, { input_tokens: 10, input_tokens_details: { cached_tokens: 4 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 }, total_tokens: 15 });
  assert.deepEqual(r.metadata, { a: "b" }); assert.equal(r.store, true);
  const cut = chatToResponse({ choices: [{ message: { content: "part" }, finish_reason: "length" }] }, { model: "m", input: "x", store: false }, { id: "r2", created: 1 });
  assert.equal(cut.status, "incomplete"); assert.deepEqual(cut.incomplete_details, { reason: "max_output_tokens" }); assert.equal(cut.store, false); assert.equal(cut.usage, null);
});

test("createChatToResponsesStream: chunks become the Responses event sequence, in order, usage at the end", () => {
  const tr = createChatToResponsesStream({ model: "m", input: "x" }, { id: "resp_s", created: 1 });
  const mk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  let out = tr.push(mk({ role: "assistant", content: "" }));
  out += tr.push(mk({ reasoning_content: "think " })); out += tr.push(mk({ reasoning_content: "more" }));
  out += tr.push(mk({ content: "Hel" })); out += tr.push(mk({ content: "lo" }));
  out += tr.push(mk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "f", arguments: "{\"a\":" } }] }));
  out += tr.push(mk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }));
  out += tr.push(mk({}, "tool_calls")); out += tr.push(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 3, completion_tokens: 7 } })}\n\n`); out += tr.push("data: [DONE]\n\n"); out += tr.end();
  const events = out.split("\n\n").filter(Boolean).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data:")).slice(5)));
  assert.deepEqual(events.map((e) => e.type), [
    "response.created", "response.in_progress",
    "response.output_item.added", "response.reasoning_summary_part.added", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done", "response.reasoning_summary_part.done", "response.output_item.done",
    "response.output_item.added", "response.content_part.added", "response.output_text.delta", "response.output_text.delta", "response.output_text.done", "response.content_part.done", "response.output_item.done",
    "response.output_item.added", "response.function_call_arguments.delta", "response.function_call_arguments.delta", "response.function_call_arguments.done", "response.output_item.done",
    "response.completed",
  ]);
  assert.ok(events.every((e, i) => e.sequence_number === i), "sequence numbers count up from 0");
  assert.ok(out.includes("event: response.output_text.delta\ndata: "), "each event carries its event: line");
  const done = events.at(-1).response; assert.equal(done.status, "completed"); assert.deepEqual(done.output.map((it) => it.type), ["reasoning", "message", "function_call"]);
  assert.equal(done.output[0].summary[0].text, "think more"); assert.equal(done.output[1].content[0].text, "Hello"); assert.equal(done.output[1].status, "completed"); assert.equal(done.output[2].arguments, "{\"a\":1}"); assert.equal(done.output[2].call_id, "call_a"); assert.equal(done.output[2].name, "f");
  assert.equal(done.usage.input_tokens, 3); assert.equal(done.usage.output_tokens, 7); assert.equal(done.usage.total_tokens, 10);
  const added = events.find((e) => e.type === "response.output_item.added" && e.item.type === "function_call"); assert.equal(added.item.name, "f"); assert.equal(added.item.call_id, "call_a");
  // a cut-off reply is incomplete
  const tr1 = createChatToResponsesStream({ model: "m", input: "x" }, { id: "r1", created: 1 });
  const o1 = tr1.push(mk({ content: "a" })) + tr1.push(mk({}, "length")) + tr1.end();
  assert.ok(o1.includes("event: response.incomplete\n") && o1.includes('"reason":"max_output_tokens"'));
  // an error chunk fails the response
  const tr2 = createChatToResponsesStream({ model: "m", input: "x" }, { id: "r2", created: 1 });
  const o2 = tr2.push(mk({ content: "a" })) + tr2.push(`data: ${JSON.stringify({ error: { message: "boom", type: "server_error" } })}\n\n`) + tr2.end();
  assert.ok(o2.includes("event: error\n") && o2.includes("event: response.failed\n") && o2.includes('"status":"failed"') && o2.includes('"message":"boom"'), o2.slice(-500));
  assert.equal(tr2.state.status, "failed");
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a chat stream that broke off mid-reply reached the Responses client
// as response.completed, and was kept for previous_response_id as a whole reply)
test("createChatToResponsesStream: a chat stream that broke off mid-reply fails the response; one its server ended stands", () => {
  const mk = (delta, finish = null) => `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const tr = createChatToResponsesStream({ model: "m", input: "x" }, { id: "rc", created: 1 });
  const out = tr.push(mk({ role: "assistant", content: "" }) + mk({ content: "half a rep" })) + tr.end();
  assert.ok(!out.includes("event: response.completed\n"), out.slice(-500));
  assert.ok(out.includes("event: error\n") && out.includes("event: response.failed\n") && out.includes('"message":"incomplete upstream stream"'), out.slice(-500));
  assert.equal(tr.state.status, "failed");
  assert.equal(tr.resp.output[0].content[0].text, "half a rep", "what came is in the failed response");
  const said = createChatToResponsesStream({ model: "m", input: "x" }, { id: "rd", created: 1 });
  const o2 = said.push(mk({ content: "a" }) + "data: [DONE]\n\n") + said.end();
  assert.ok(o2.includes("event: response.completed\n"), "its [DONE] said the end, a finish_reason or none");
  assert.equal(said.state.status, "completed");
});

test("ResponseStore keeps conversations for a while and forgets the oldest", async () => {
  const s = new ResponseStore({ ttlMs: 50, max: 2 }); s.put("a", { items: [1] }); s.put("b", { items: [2] }); s.put("c", { items: [3] });
  assert.equal(s.get("a"), null, "oldest evicted at max"); assert.deepEqual(s.get("c").items, [3]); assert.equal(s.size, 2);
  await new Promise((r) => setTimeout(r, 80)); assert.equal(s.get("c"), null, "expired");
});

// ---- a real Filament in front of a fake OpenAI-compatible upstream ----
let fake, app, port, dataDir, lastBody = null;
before(async () => {
  fake = http.createServer((req, res) => {
    let buf = ""; req.on("data", (d) => (buf += d));
    req.on("end", () => {
      const body = JSON.parse(buf || "{}"); lastBody = body;
      const mk = (delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(mk({ role: "assistant", content: "" })); res.write(mk({ reasoning_content: "thinking" })); res.write(mk({ content: "Hi " })); res.write(mk({ content: "there" }));
        if (body.tools?.length) res.write(mk({ tool_calls: [{ index: 0, id: "call_x", type: "function", function: { name: body.tools[0].function.name, arguments: "{\"q\":1}" } }] }));
        res.write(mk({}, body.tools?.length ? "tool_calls" : "stop"));
        res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 12, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 2 } } })}\n\n`);
        return res.end("data: [DONE]\n\n");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "c2", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: `You said: ${body.messages.at(-1).content}`, reasoning_content: "r" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } }));
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dataDir = mkdtempSync(join(tmpdir(), "filament-resp-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "oai", name: "oai", type: "openai-compatible", baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: "s" }];
  cfg.routes = [{ match: "gpt-*", upstream: "oai", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); fake.close(); rmSync(dataDir, { recursive: true, force: true }); });
const post = (body) => fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k" }, body: JSON.stringify(body) });

test("POST /v1/responses: JSON reply, previous_response_id continues the conversation, store=false forgets, errors keep OpenAI's shape", async () => {
  const r = await post({ model: "gpt-x", input: "hello", instructions: "be nice" }); assert.equal(r.status, 200); assert.ok(r.headers.get("x-filament-request-id"));
  const j = await r.json(); assert.equal(j.object, "response"); assert.equal(j.status, "completed"); assert.match(j.id, /^resp_/); assert.equal(j.instructions, "be nice");
  assert.deepEqual(lastBody.messages, [{ role: "system", content: "be nice" }, { role: "user", content: "hello" }]); assert.equal(lastBody.stream, false);
  assert.deepEqual(j.output.map((it) => it.type), ["reasoning", "message"]); assert.equal(j.output[1].content[0].text, "You said: hello"); assert.equal(j.usage.input_tokens, 5); assert.equal(j.usage.output_tokens, 4); assert.equal(j.usage.total_tokens, 9);
  const rec = app.usage.list(1)[0]; assert.equal(rec.api, "responses"); assert.equal(rec.status, "ok"); assert.ok(rec.changes.some((c) => c.includes("Responses API")), rec.changes.join(" | "));
  // The pair the dashboard's "connected as" row depends on: a Responses request is converted to a chat request, so the
  // record says `format: "openai"` while `api` is what names the endpoint the client actually spoke. Asserting `api`
  // alone is what let the drawer name /v1/chat/completions for a client that never called it.
  assert.equal(rec.format, "openai", "the inbound format is openai-shaped, and `api` distinguishes the real endpoint");
  // continue: the earlier turn is replayed before the new input
  const r2 = await post({ model: "gpt-x", input: "and again", previous_response_id: j.id }); assert.equal(r2.status, 200); const j2 = await r2.json();
  assert.equal(j2.previous_response_id, j.id); assert.deepEqual(lastBody.messages.map((m) => m.role), ["user", "assistant", "user"]); assert.equal(lastBody.messages[1].content, "You said: hello"); assert.equal(lastBody.messages[2].content, "and again");
  // unknown id -> 404 in OpenAI's error shape
  const r3 = await post({ model: "gpt-x", input: "x", previous_response_id: "resp_nope" }); assert.equal(r3.status, 404); const e3 = await r3.json(); assert.equal(e3.error.code, "previous_response_not_found"); assert.equal(e3.error.param, "previous_response_id");
  // store: false -> not kept
  const r4 = await post({ model: "gpt-x", input: "forget me", store: false }); const j4 = await r4.json(); assert.equal(j4.store, false);
  const r5 = await post({ model: "gpt-x", input: "x", previous_response_id: j4.id }); assert.equal(r5.status, 404);
  // bad requests
  const r6 = await post({ model: "gpt-x" }); assert.equal(r6.status, 400); assert.equal((await r6.json()).error.param, "input");
  const r7 = await post({ model: "nothing-routes-here", input: "x" }); assert.equal(r7.status, 404); assert.match((await r7.json()).error.message, /no route/);
  const r8 = await fetch(`http://127.0.0.1:${port}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: JSON.stringify({ model: "gpt-x", input: "x" }) }); assert.equal(r8.status, 401);
});

test("POST /v1/responses streaming: reasoning summary, text and a function call arrive as Responses events; the tool result goes back as a tool message", async () => {
  const r = await post({ model: "gpt-x", input: [{ role: "user", content: [{ type: "input_text", text: "call it" }] }], tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }], stream: true });
  assert.equal(r.status, 200); assert.ok(r.headers.get("content-type").includes("text/event-stream")); assert.ok(r.headers.get("x-filament-request-id"));
  const text = await r.text();
  const events = text.split("\n\n").filter((b) => b.includes("data:")).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data:")).slice(5)));
  const types = events.map((e) => e.type);
  assert.equal(types[0], "response.created"); assert.ok(types.includes("response.reasoning_summary_text.delta")); assert.ok(types.includes("response.output_text.delta")); assert.ok(types.includes("response.function_call_arguments.done")); assert.equal(types.at(-1), "response.completed");
  const done = events.at(-1).response; assert.deepEqual(done.output.map((it) => it.type), ["reasoning", "message", "function_call"]);
  assert.equal(done.output[1].content[0].text, "Hi there"); assert.equal(done.output[2].name, "lookup"); assert.equal(done.output[2].arguments, "{\"q\":1}"); assert.equal(done.output[2].call_id, "call_x");
  assert.equal(done.usage.input_tokens, 12); assert.equal(done.usage.output_tokens, 6); assert.equal(done.usage.input_tokens_details.cached_tokens, 2);
  assert.equal(lastBody.tools[0].function.name, "lookup"); assert.deepEqual(lastBody.stream_options, { include_usage: true }); assert.equal(lastBody.messages[0].content, "call it");
  // the function result comes back as function_call_output and reaches the model as a tool message after the call
  const r2 = await post({ model: "gpt-x", input: [{ type: "function_call_output", call_id: "call_x", output: "42" }], previous_response_id: done.id }); assert.equal(r2.status, 200); await r2.json();
  assert.deepEqual(lastBody.messages.map((m) => m.role), ["user", "assistant", "tool"]);
  assert.equal(lastBody.messages[1].content, "Hi there"); assert.equal(lastBody.messages[1].tool_calls[0].id, "call_x"); assert.equal(lastBody.messages[1].tool_calls[0].function.name, "lookup");
  assert.deepEqual(lastBody.messages[2], { role: "tool", tool_call_id: "call_x", content: "42" });
});

// ---- the outbound direction: Filament talking to a server that only offers /v1/responses ----
import { chatToResponsesRequest, responseToChat, createResponsesToChatStream } from "../src/responses.js";

test("chatToResponsesRequest: messages become items, system becomes instructions, tools and formats carry over", () => {
  const r = chatToResponsesRequest({ model: "grok-4.6", stream: true, stream_options: { include_usage: true }, max_tokens: 300, reasoning_effort: "high", temperature: 0.3, messages: [
    { role: "system", content: "be brief" }, { role: "system", content: [{ type: "text", text: "and kind" }] },
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "low" } }] },
    { role: "assistant", content: "sure", tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{\"a\":1}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "42" }, { role: "user", content: "thanks" },
  ], tools: [{ type: "function", function: { name: "f", description: "d", parameters: { type: "object", properties: {} }, strict: true } }], tool_choice: { type: "function", function: { name: "f" } }, response_format: { type: "json_schema", json_schema: { name: "out", schema: { type: "object" }, strict: true } } });
  assert.equal(r.model, "grok-4.6"); assert.equal(r.instructions, "be brief\n\nand kind"); assert.equal(r.stream, true); assert.equal(r.stream_options, undefined); assert.equal(r.max_output_tokens, 300); assert.deepEqual(r.reasoning, { effort: "high" }); assert.equal(r.temperature, 0.3); assert.equal(r.store, false);
  assert.deepEqual(r.input.map((it) => it.type || it.role), ["user", "message", "function_call", "function_call_output", "user"]);
  assert.equal(r.input[0].content[0].text, "look"); assert.equal(r.input[0].content[1].type, "input_image"); assert.equal(r.input[0].content[1].image_url, "data:image/png;base64,AA"); assert.equal(r.input[0].content[1].detail, "low");
  assert.equal(r.input[1].role, "assistant"); assert.equal(r.input[1].content[0].text, "sure"); assert.equal(r.input[2].call_id, "call_1"); assert.equal(r.input[2].arguments, "{\"a\":1}"); assert.deepEqual(r.input[3], { type: "function_call_output", call_id: "call_1", output: "42" });
  assert.equal(r.tools[0].name, "f"); assert.equal(r.tools[0].strict, true); assert.deepEqual(r.tool_choice, { type: "function", name: "f" }); assert.equal(r.text.format.type, "json_schema"); assert.equal(r.text.format.name, "out");
});

// (fails before: yes — the bug hunt of 10-30, WIRE-4: a tool message's images and files were dropped on the way to a
// Responses server, its words alone kept)
test("chatToResponsesRequest: a tool message's images and files ride in its function_call_output", () => {
  const r = chatToResponsesRequest({ model: "grok-4.6", messages: [
    { role: "user", content: "look" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_s", type: "function", function: { name: "screenshot", arguments: "{}" } }, { id: "call_t", type: "function", function: { name: "title", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_s", content: [{ type: "text", text: "the page:" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "high" } }, { type: "file", file: { filename: "r.pdf", file_data: "data:application/pdf;base64,JVBERg==" } }] },
    { role: "tool", tool_call_id: "call_t", content: [{ type: "text", text: "Home" }] },
  ] });
  assert.deepEqual(r.input.map((it) => it.type || it.role), ["user", "function_call", "function_call", "function_call_output", "function_call_output"]);
  assert.deepEqual(r.input[3], { type: "function_call_output", call_id: "call_s", output: [
    { type: "input_text", text: "the page:" },
    { type: "input_image", image_url: "data:image/png;base64,AA", detail: "high" },
    { type: "input_file", file_data: "data:application/pdf;base64,JVBERg==", filename: "r.pdf" },
  ] });
  assert.deepEqual(r.input[4], { type: "function_call_output", call_id: "call_t", output: "Home" }, "words alone stay the string they were");
});

test("responseToChat and the stream converter turn a Responses reply into Chat Completions with reasoning, tools and usage", () => {
  const resp = { id: "abc", object: "response", created_at: 5, model: "grok-4.6", status: "completed", output: [
    { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "The user said pong" }], status: "completed" },
    { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "pong", annotations: [] }] },
    { id: "fc_1", type: "function_call", call_id: "call_z", name: "lookup", arguments: "{\"q\":2}", status: "completed" },
  ], usage: { input_tokens: 643, input_tokens_details: { cached_tokens: 100 }, output_tokens: 180, output_tokens_details: { reasoning_tokens: 179 }, total_tokens: 823 } };
  const c = responseToChat(resp); assert.equal(c.object, "chat.completion"); assert.equal(c.model, "grok-4.6"); assert.equal(c.choices[0].message.content, "pong"); assert.equal(c.choices[0].message.reasoning_content, "The user said pong"); assert.equal(c.choices[0].message.tool_calls[0].id, "call_z"); assert.equal(c.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(c.usage, { prompt_tokens: 643, completion_tokens: 180, total_tokens: 823, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 179 } });
  assert.equal(responseToChat({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", content: [{ type: "output_text", text: "cut" }] }] }).choices[0].finish_reason, "length");
  assert.ok(responseToChat({ status: "failed", error: { code: "rate_limit", message: "slow down" } }).error);
  // the stream
  const tr = createResponsesToChatStream({ model: "grok-4.6" });
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: 0, ...data })}\n\n`;
  let out = tr.push(ev("response.created", { response: { id: "abc", model: "grok-4.6" } }));
  out += tr.push(ev("response.output_item.added", { output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } }));
  out += tr.push(ev("response.reasoning_summary_text.delta", { item_id: "rs_1", output_index: 0, summary_index: 0, delta: "thinking" }));
  out += tr.push(ev("response.output_item.added", { output_index: 1, item: { id: "msg_1", type: "message", role: "assistant", content: [] } }));
  out += tr.push(ev("response.output_text.delta", { item_id: "msg_1", output_index: 1, content_index: 0, delta: "po" }) + ev("response.output_text.delta", { item_id: "msg_1", output_index: 1, content_index: 0, delta: "ng" }));
  out += tr.push(ev("response.output_item.added", { output_index: 2, item: { id: "fc_1", type: "function_call", call_id: "call_z", name: "lookup", arguments: "" } }));
  out += tr.push(ev("response.function_call_arguments.delta", { item_id: "fc_1", output_index: 2, delta: "{\"q\":" }) + ev("response.function_call_arguments.delta", { item_id: "fc_1", output_index: 2, delta: "2}" }) + ev("response.function_call_arguments.done", { item_id: "fc_1", output_index: 2, arguments: "{\"q\":2}" }));
  out += tr.push(ev("response.completed", { response: { ...resp } })); out += tr.end();
  const chunks = out.split("\n\n").filter((b) => b.startsWith("data: ") && !b.includes("[DONE]")).map((b) => JSON.parse(b.slice(6)));
  const deltas = chunks.map((c) => c.choices?.[0]?.delta).filter(Boolean);
  assert.equal(deltas[0].role, "assistant"); assert.equal(deltas.filter((d) => d.reasoning_content).map((d) => d.reasoning_content).join(""), "thinking"); assert.equal(deltas.filter((d) => d.content).map((d) => d.content).join(""), "pong");
  const tcs = deltas.filter((d) => d.tool_calls).flatMap((d) => d.tool_calls); assert.equal(tcs[0].id, "call_z"); assert.equal(tcs[0].function.name, "lookup"); assert.equal(tcs.map((t) => t.function.arguments).join(""), "{\"q\":2}", "arguments once, from the deltas, not again from done");
  assert.equal(chunks.find((c) => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason, "tool_calls");
  const usageChunk = chunks.find((c) => c.usage && !c.choices?.length); assert.equal(usageChunk.usage.prompt_tokens, 643); assert.ok(out.trim().endsWith("data: [DONE]"));
  assert.equal(tr.state.stopReason, "tool_calls"); assert.equal(tr.state.usage.input, 643 - 100, "Filament's usage: uncached input"); assert.equal(tr.state.usage.cacheRead, 100); assert.equal(tr.state.textChars, 4); assert.equal(tr.state.thinkingChars, 8);
});

// (fails before: yes — the bug hunt of 10-30, WIRE-1: a Responses stream that broke off before its final event was ended
// for the chat client with a finish_reason "stop" and [DONE] it never sent)
test("createResponsesToChatStream: a Responses stream that broke off before its final event ends as an error", () => {
  const tr = createResponsesToChatStream({ model: "grok-4.6" });
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: 0, ...data })}\n\n`;
  const out = tr.push(ev("response.created", { response: { id: "abc", model: "grok-4.6" } }) + ev("response.output_text.delta", { item_id: "msg_1", output_index: 0, content_index: 0, delta: "half a rep" })) + tr.end();
  const said = out.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => b.slice(6));
  assert.ok(out.includes('"content":"half a rep"'), out);
  assert.ok(!said.some((d) => d !== "[DONE]" && JSON.parse(d).choices?.[0]?.finish_reason), "no finish the upstream never sent");
  assert.deepEqual(said.slice(-2), [JSON.stringify({ error: { message: "incomplete upstream stream", type: "server_error" } }), "[DONE]"]);
  assert.equal(tr.state.error, "incomplete upstream stream");
});

// A fake server that only offers /v1/responses (404 on Chat Completions), reached through the same test app.
let rfake, rport, rlast = null, chatAttempts = 0;
// Set up lazily by the tests that need it (top-level hooks of one file do not wait for each other).
let wireReady = null;
const wireSetup = () => (wireReady ||= (async () => {
  rfake = http.createServer((req, res) => {
    let buf = ""; req.on("data", (d) => (buf += d));
    req.on("end", () => {
      if (req.url.startsWith("/v1/chat/completions")) { chatAttempts++; res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "Not Found", type: "invalid_request_error" } })); }
      if (req.url.startsWith("/v1/models")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ object: "list", data: [{ id: "grok-4.6" }] })); }
      const body = JSON.parse(buf || "{}"); rlast = body;
      const lastUser = [...(body.input || [])].reverse().find((it) => it.role === "user"); const asked = lastUser ? lastUser.content.map((p) => p.text || "").join("") : String(body.input);
      const final = { id: "r1", object: "response", created_at: 1, model: body.model, status: "completed", output: [{ id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "pondering" }] }, { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: `Grok says: ${asked}`, annotations: [] }] }], usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 10 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 12 }, total_tokens: 70, cost_in_usd_ticks: 10220000 } };
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" }); const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("response.created", { response: { ...final, status: "in_progress", output: [] } }); ev("response.output_item.added", { output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } }); ev("response.reasoning_summary_text.delta", { item_id: "rs_1", output_index: 0, summary_index: 0, delta: "pondering" });
        ev("response.output_item.added", { output_index: 1, item: { id: "msg_1", type: "message", role: "assistant", content: [] } }); ev("response.output_text.delta", { item_id: "msg_1", output_index: 1, content_index: 0, delta: "Grok says: " }); ev("response.output_text.delta", { item_id: "msg_1", output_index: 1, content_index: 0, delta: asked });
        ev("response.completed", { response: final }); return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(final));
    });
  });
  await new Promise((r) => rfake.listen(0, "127.0.0.1", r)); rport = rfake.address().port;
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); const cfg = st.config;
  cfg.upstreams.push({ id: "rx", name: "responses only", type: "openai-compatible", baseUrl: `http://127.0.0.1:${rport}/v1`, apiKey: "s", wireApi: "responses" });
  cfg.upstreams.push({ id: "rauto", name: "responses only, auto", type: "openai-compatible", baseUrl: `http://127.0.0.1:${rport}`, apiKey: "s" });
  cfg.routes.push({ match: "rx/*", upstream: "rx", upstreamModel: "{1}" }, { match: "rauto/*", upstream: "rauto", upstreamModel: "{1}" });
  const r = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) }); assert.equal(r.status, 200, await r.text());
})());
after(() => rfake?.close());
const H2 = { "content-type": "application/json", authorization: "Bearer k" };

test("wireApi = responses: an OpenAI-style client streams Chat Completions back while the server speaks Responses; usage is recorded", async () => {
  await wireSetup();
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H2, body: JSON.stringify({ model: "rx/grok-4.6", stream: true, messages: [{ role: "system", content: "terse" }, { role: "user", content: "ping" }] }) });
  assert.equal(r.status, 200); assert.ok(r.headers.get("content-type").includes("text/event-stream"));
  const chunks = (await r.text()).split("\n\n").filter((b) => b.startsWith("data: ") && !b.includes("[DONE]")).map((b) => JSON.parse(b.slice(6)));
  const deltas = chunks.map((c) => c.choices?.[0]?.delta).filter(Boolean);
  assert.equal(deltas.filter((d) => d.content).map((d) => d.content).join(""), "Grok says: ping"); assert.equal(deltas.filter((d) => d.reasoning_content).map((d) => d.reasoning_content).join(""), "pondering");
  assert.equal(rlast.instructions, "terse"); assert.equal(rlast.input[0].content[0].text, "ping"); assert.equal(rlast.stream, true); assert.equal(rlast.store, false);
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok"); assert.equal(rec.tokens.input, 40); assert.equal(rec.tokens.cacheRead, 10); assert.equal(rec.tokens.output, 20); assert.ok(rec.url.endsWith("/v1/responses"), rec.url); assert.equal(rec.cost, 0.001022, "the provider's charge survives the conversion to Chat Completions"); assert.equal(rec.costSource, "provider"); assert.ok(rec.changes.some((c) => c.includes("/v1/responses")), rec.changes.join(" | "));
  // JSON reply, Anthropic-format client: two conversions, thinking block plus text
  const a = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: "POST", headers: H2, body: JSON.stringify({ model: "rx/grok-4.6", max_tokens: 100, messages: [{ role: "user", content: "hello" }] }) });
  assert.equal(a.status, 200); const aj = await a.json(); assert.equal(aj.type, "message"); assert.deepEqual(aj.content.map((b) => b.type), ["thinking", "text"]); assert.equal(aj.content[1].text, "Grok says: hello"); assert.equal(aj.usage.input_tokens, 40); assert.equal(aj.usage.cache_read_input_tokens, 10); assert.equal(aj.usage.output_tokens, 20);
  assert.equal(rlast.stream, undefined); assert.equal(rlast.max_output_tokens, 100);
  // a Responses-API client end to end: Responses in, Responses to the server, Responses out
  const p = await post({ model: "rx/grok-4.6", input: "round trip" }); assert.equal(p.status, 200); const pj = await p.json(); assert.equal(pj.object, "response"); assert.equal(pj.output.find((it) => it.type === "message").content[0].text, "Grok says: round trip"); assert.equal(pj.usage.input_tokens, 50); assert.equal(pj.usage.input_tokens_details.cached_tokens, 10);
});

test("passthrough: a Responses client and a Responses server exchange the original shapes; usage still recorded; previous_response_id works", async () => {
  await wireSetup();
  // JSON: the server receives the client's own items (not a repacked chat body) and the client gets the server's own object
  const r = await post({ model: "rx/grok-4.6", instructions: "terse", input: [{ role: "user", content: [{ type: "input_text", text: "straight" }] }], reasoning: { effort: "low" }, metadata: { k: "v" } });
  assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.id, "r1", "the server's own response id reaches the client untouched"); assert.equal(j.output[1].content[0].text, "Grok says: straight");
  assert.equal(rlast.instructions, "terse"); assert.equal(rlast.input[0].content[0].type, "input_text"); assert.deepEqual(rlast.reasoning, { effort: "low" }); assert.deepEqual(rlast.metadata, { k: "v" }); assert.equal(rlast.model, "grok-4.6"); assert.equal(rlast.messages, undefined);
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok"); assert.equal(rec.api, "responses"); assert.ok(rec.changes.some((c) => c.includes("passthrough")), rec.changes.join(" | ")); assert.ok(!rec.changes.some((c) => c.includes("converted back")));
  assert.equal(rec.tokens.input, 40); assert.equal(rec.tokens.cacheRead, 10); assert.equal(rec.tokens.output, 20); assert.equal(rec.tokens.thinking, 12); assert.equal(rec.stopReason, "completed");
  assert.equal(rec.cost, 0.001022, "the provider's own charge beats the price card"); assert.equal(rec.costSource, "provider"); assert.equal(rec.tokens.providerCost, undefined);
  // stream: the server's events pass through as they are; the store still learns the answer
  const s = await post({ model: "rx/grok-4.6", input: "again", stream: true }); assert.equal(s.status, 200);
  const text = await s.text(); assert.ok(text.includes("event: response.created") && text.includes('"delta":"Grok says: "') && text.includes("event: response.completed"), text.slice(0, 400));
  assert.ok(text.includes('"id":"r1"'), "server ids untouched"); assert.equal(rlast.stream, true);
  const rec2 = app.usage.list(1)[0]; assert.equal(rec2.tokens.output, 20); assert.equal(rec2.textChars, "Grok says: again".length); assert.equal(rec2.thinkingChars, "pondering".length); assert.ok(rec2.changes.some((c) => c.includes("passthrough")));
  const c = await post({ model: "rx/grok-4.6", input: "and then", previous_response_id: "r1" }); assert.equal(c.status, 200, await c.text());
  assert.ok(rlast.input.some((it) => it.role === "assistant" && it.content?.[0]?.text?.startsWith("Grok says:")), "the earlier answer is replayed from the store: " + JSON.stringify(rlast.input));
  assert.equal(rlast.previous_response_id, undefined, "Filament resolves previous_response_id itself and sends the full input");
  // effort suffix on the model name lands in reasoning.effort, like on every other route
  const e = await post({ model: "rx/grok-4.6-high", input: "effort" }); assert.equal(e.status, 200); await e.json(); assert.equal(rlast.model, "grok-4.6"); assert.deepEqual(rlast.reasoning, { effort: "high" });
});

test("wireApi = auto: a 404 on Chat Completions is retried on /v1/responses once and remembered", async () => {
  await wireSetup(); chatAttempts = 0;
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H2, body: JSON.stringify({ model: "rauto/grok-4.6", messages: [{ role: "user", content: "first" }] }) });
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.choices[0].message.content, "Grok says: first"); assert.equal(chatAttempts, 1);
  const rec = app.usage.list(1)[0]; assert.equal(rec.status, "ok"); assert.ok(rec.changes.some((c) => c.includes("has no Chat Completions") && c.includes("remembers that")), rec.changes.join(" | "));
  const r2 = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H2, body: JSON.stringify({ model: "rauto/grok-4.6", messages: [{ role: "user", content: "second" }] }) });
  assert.equal(r2.status, 200); assert.equal((await r2.json()).choices[0].message.content, "Grok says: second"); assert.equal(chatAttempts, 1, "remembered: no second detour");
  const rec2 = app.usage.list(1)[0]; assert.ok(!rec2.changes.some((c) => c.includes("has no Chat Completions"))); assert.ok(rec2.changes.some((c) => c.includes("/v1/responses")));
});

// (fails before: the latch lived until a restart, whatever the upstream's settings became — the GLM incident)
test("wireApi = auto (BUG-02): changing the upstream's address clears what was remembered, so Chat Completions is tried again", async () => {
  await wireSetup();
  const ask = async (text) => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: H2, body: JSON.stringify({ model: "rauto/grok-4.6", messages: [{ role: "user", content: text }] }) });
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
  };
  await ask("latch it");
  const before = chatAttempts;
  await ask("latched");
  assert.equal(chatAttempts, before, "latched: Chat Completions is skipped");
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const cfg = st.config;
  cfg.upstreams = cfg.upstreams.map((u) => (u.id === "rauto" ? { ...u, baseUrl: `http://127.0.0.1:${rport}/v1` } : u));
  const put = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) });
  assert.equal(put.status, 200, await put.text());
  await ask("after the address changed");
  assert.equal(chatAttempts, before + 1, "the changed address gets its Chat Completions tried again");
});
