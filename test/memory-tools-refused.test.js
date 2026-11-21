// @ts-check
// HarnessV3-AtHome AH-D1: memory is on for everyone, so what it adds must never make a request fail. A request that
// carried no tools of its own is given memory's, and a model that takes none (an Ollama model without a tool template,
// a model OpenRouter has no tool-capable provider for) refuses the whole request for them. Filament sends it again as
// the client sent it, and only a retry that succeeds is remembered: that model's later requests that carry no tools
// of their own are offered none, until the upstream's address or type changes, or a restart.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeUpstream, parseSse } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let s;

/** @param {string} message */
const refuse = (message) => ({ status: 400, json: { error: { message, type: "invalid_request_error" } } });
/** @param {any} b */
const carriesTools = (b) => Array.isArray(b?.tools) && b.tools.length > 0;
/** @param {any} b */
const memoryTools = (b) => (b?.tools || []).filter((/** @type {any} */ t) => /^filament_memory_/.test(t.function?.name || t.name || ""));

before(async () => {
  up = await fakeUpstream((call) => {
    const b = call.body || {};
    // Takes no tools: a request carrying any is refused whole, as Ollama does for a model without a tool template.
    if (String(b.model).startsWith("notools") && carriesTools(b)) return refuse(`registry.ollama.ai/library/${b.model} does not support tools`);
    // Refuses everything, tools first: they were not the cause.
    if (b.model === "broken") return refuse("tools are not supported, and everything else is broken here");
    // A refusal that is not about tools.
    if (b.model === "toolong") return refuse("This model's maximum context length is 8192 tokens");
    // Refusals that name a tool or a function in passing, about something else: with or without memory's tools.
    if (b.model === "toolmsg") return refuse("Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.");
    if (b.model === "fnlong") return refuse("This model's maximum context length is 8192 tokens. However, your messages resulted in 9100 tokens (8700 in the messages, 400 in the functions). Please reduce the length of the messages or functions.");
    // Tools refused with another status, as other servers do: OpenRouter's 404, a server's 422.
    if (b.model === "nt404" && carriesTools(b)) return { status: 404, json: { error: { message: "No endpoints found that support tool use" } } };
    if (b.model === "nt422" && carriesTools(b)) return { status: 422, json: { error: { message: "tools are not supported by this model" } } };
    // The same 404 from a server Filament has not been told the wire API of. It has no Responses.
    if (b.model === "nt404auto") {
      if (call.kind === "responses") return { status: 404, json: { error: { message: "Not Found" } } };
      if (carriesTools(b)) return { status: 404, json: { error: { message: "No endpoints found that support tool use" } } };
    }
    // A server with no Chat Completions, whose 404 happens to name a function.
    if (b.model === "ro-model" && call.kind === "openai") return { status: 404, json: { error: { message: "no such function on this server" } } };
    // Takes no functions either, the old name for tools.
    if (b.model === "nofn" && (carriesTools(b) || b.functions)) return refuse("nofn does not support functions");
    return undefined;
  });
  s = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.memory.autopilot = { enabled: true, tools: true, cue: false, rewrite: false };
      cfg.upstreams = [
        { id: "local", name: "local", type: "openai-compatible", baseUrl: up.url, apiKey: "x" },
        // Chat Completions only: a 404 there is the model's answer, not a question of which wire API the server speaks.
        { id: "pinned", name: "pinned", type: "openai-compatible", baseUrl: up.url, apiKey: "x", wireApi: "chat-completions" },
        // Its own entry: what Filament learns of its wire API stays out of the other tests.
        { id: "auto2", name: "auto2", type: "openai-compatible", baseUrl: up.url, apiKey: "x" },
      ];
      cfg.routes = [
        // Two names for one model behind them.
        { match: "alias-a", upstream: "local", upstreamModel: "notools-real" },
        { match: "alias-b", upstream: "local", upstreamModel: "notools-real" },
        { match: "nt404", upstream: "pinned", upstreamModel: "{model}" },
        { match: "ro-model", upstream: "auto2", upstreamModel: "{model}" },
        { match: "*", upstream: "local", upstreamModel: "{model}" },
      ];
    },
  });
});
after(async () => {
  await s?.stop();
  await up?.close();
});

/** A chat request with no tools of its own, as an app sends one. @param {string} model @param {string} text @param {any} [extra] */
const ask = (model, text, extra = {}) =>
  s.post("/v1/chat/completions", { model, messages: [{ role: "user", content: text }], ...extra });
const sent = () => up.received.filter((c) => c.kind === "openai").map((c) => c.body);
const lastRecord = () => /** @type {any} */ (s.app.usage.list(1)[0]);

// (fails before: yes — the client got the model's 400, with memory's tools still on the request, and nothing was remembered)
test("a model that takes no tools is not failed by memory's: the request goes again as the client sent it, and the model is remembered", async () => {
  up.reset();
  const r = await ask("notools", "hello there");
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).choices[0].message.content, "MODEL ANSWER");
  const [first, again, ...more] = sent();
  assert.equal(more.length, 0, "two calls, no more");
  assert.ok(memoryTools(first).length >= 3, "the first carried memory's tools");
  assert.ok(JSON.stringify(first.messages).includes("Memory tools ("), "and its briefing named them");
  assert.equal("tools" in again, false, "the second is the client's request: no tools key at all");
  assert.deepEqual(again.messages.at(-1), { role: "user", content: "hello there" }, "and the client's message as sent");
  const rec = lastRecord();
  assert.equal(rec.status, "ok");
  assert.equal(rec.memory.tools, false, "the request that answered carried none");
  assert.ok(rec.changes.some((/** @type {string} */ c) => /^memory: notools at local refused the request for Filament's memory tools \(HTTP 400: .*does not support tools/.test(c)), rec.changes.join(" | "));
  assert.ok(rec.changes.some((/** @type {string} */ c) => /^memory: notools at local answered without them — it takes no tools/.test(c)), rec.changes.join(" | "));

  // Remembered: the model's next request that carries no tools is offered none, in one call, and a briefing built for
  // it does not name tools the model lacks.
  up.reset();
  const r2 = await ask("notools", "a different conversation");
  assert.equal(r2.status, 200, await r2.clone().text());
  await r2.json();
  const [only, ...rest] = sent();
  assert.equal(rest.length, 0, "one call");
  assert.equal("tools" in only, false);
  assert.ok(!JSON.stringify(only.messages).includes("Memory tools ("), "the briefing names no tools");
  assert.ok(lastRecord().changes.some((/** @type {string} */ c) => /^memory: tools not offered — notools at local refused them on an earlier request/.test(c)), lastRecord().changes.join(" | "));
});

// (fails before: yes — the streamed reply opened with the model's error)
test("the same holds for a streamed Anthropic-format request, translated on the way", async () => {
  up.reset();
  const r = await s.post("/v1/messages", { model: "notools-claude", max_tokens: 64, stream: true, messages: [{ role: "user", content: "stream it" }] });
  assert.equal(r.status, 200, await r.clone().text());
  const events = parseSse(await r.text());
  const text = events.map((e) => e.data?.delta?.text || "").join("");
  assert.equal(text, "MODEL ANSWER", JSON.stringify(events).slice(0, 400));
  const calls = sent();
  assert.equal(calls.length, 2);
  assert.ok(memoryTools(calls[0]).length >= 3);
  assert.equal("tools" in calls[1], false);
});

// (fails before: yes — the Responses client got the model's 400)
test("and for a Responses-API client", async () => {
  up.reset();
  const r = await s.post("/v1/responses", { model: "notools-responses", input: "from the Responses API" });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.output.find((/** @type {any} */ it) => it.type === "message")?.content?.[0]?.text, "MODEL ANSWER");
  const calls = sent();
  assert.equal(calls.length, 2);
  assert.equal("tools" in calls[1], false);
});

// (fails before: yes — there was no second call, so "the tools were not the cause" was never said)
test("a retry that fails too remembers nothing: the client gets the model's own error, and the next request offers the tools again", async () => {
  up.reset();
  const r = await ask("broken", "anything");
  assert.equal(r.status, 400);
  assert.match(await r.text(), /broken here/);
  assert.equal(sent().length, 2, "asked with the tools, then without");
  assert.equal("tools" in sent()[1], false);
  assert.ok(lastRecord().changes.some((/** @type {string} */ c) => /^memory: broken at local answered HTTP 400 without them too — the tools were not the cause; nothing was remembered/.test(c)), lastRecord().changes.join(" | "));
  up.reset();
  await (await ask("broken", "anything else")).text();
  assert.ok(memoryTools(sent()[0]).length >= 3, "not remembered: memory's tools are offered again");
});

// (fails before: no — a refusal that names no tools was always passed on in one call; this pins that the retry is narrow)
test("a refusal that is not about tools reaches the client in one call, unchanged", async () => {
  up.reset();
  const r = await ask("toolong", "a long one");
  assert.equal(r.status, 400);
  assert.match(await r.text(), /maximum context length is 8192 tokens/);
  assert.equal(sent().length, 1);
  assert.ok(!lastRecord().changes.some((/** @type {string} */ c) => /memory tools/.test(c)), lastRecord().changes.join(" | "));
});

// (fails before: yes — the bug hunt of 10-30: any 400, 404 or 422 that named a tool or a function went again without
// memory's tools — a tool message out of place, a context length counted "in the functions" — a second call, paid for,
// that met the same refusal)
test("a refusal that names a tool or a function in passing is not one about tools: it reaches the client in one call", async () => {
  for (const [model, said] of /** @type {[string, RegExp][]} */ ([["toolmsg", /role 'tool' must be a response/], ["fnlong", /400 in the functions/]])) {
    up.reset();
    const r = await ask(model, "anything");
    assert.equal(r.status, 400, model);
    assert.match(await r.text(), said);
    assert.equal(sent().length, 1, `${model}: one call`);
    assert.ok(memoryTools(sent()[0]).length >= 3, "it carried memory's tools all the same");
    assert.ok(!lastRecord().changes.some((/** @type {string} */ c) => /memory tools|without them/.test(c)), lastRecord().changes.join(" | "));
  }
});

// (fails before: no — Filament never strips a client's own tools; this pins that the retry leaves them alone)
test("a request with tools of its own is the client's business: no retry, its refusal reaches the client", async () => {
  up.reset();
  const tools = [{ type: "function", function: { name: "Read", description: "read a file", parameters: { type: "object", properties: {} } } }];
  const r = await ask("notools-own", "read it", { tools });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /does not support tools/);
  assert.equal(sent().length, 1);
  // (fails before: no — added for the mutants that read a remembered refusal for such a request, and took functions or
  // an empty list for tools of none) a model remembered as taking no tools is not looked up for it either
  up.reset();
  const known = await ask("notools", "read it again", { tools });
  assert.equal(known.status, 400);
  assert.equal(sent().length, 1);
  assert.ok(!lastRecord().changes.some((/** @type {string} */ c) => /tools not offered/.test(c)), lastRecord().changes.join(" | "));
  // functions, the old name for tools, are the client's too
  up.reset();
  const fn = await ask("nofn", "call it", { functions: [{ name: "lookup", parameters: { type: "object", properties: {} } }] });
  assert.equal(fn.status, 400);
  assert.equal(sent().length, 1);
  // an empty list is no tools: memory's are offered, and the refusal is retried as sent
  up.reset();
  const empty = await ask("notools-empty", "nothing of mine", { tools: [] });
  assert.equal(empty.status, 200, await empty.clone().text());
  assert.equal(sent().length, 2);
  assert.ok(memoryTools(sent()[0]).length >= 3);
});

// (fails before: no — written after the code, for the mutants that dropped 404 and 422) OpenRouter refuses tools with a
// 404, other servers with a 422: each is retried as the client sent it, and remembered
test("a refusal for tools as a 404 or a 422 goes again as the client sent it", async () => {
  for (const [model, status, at] of /** @type {[string, number, string][]} */ ([["nt404", 404, "pinned"], ["nt422", 422, "local"]])) {
    up.reset();
    const r = await ask(model, "hello");
    assert.equal(r.status, 200, await r.clone().text());
    await r.json();
    assert.equal(sent().length, 2, model);
    assert.equal("tools" in sent()[1], false);
    assert.ok(lastRecord().changes.some((/** @type {string} */ c) => c.startsWith(`memory: ${model} at ${at} refused the request for Filament's memory tools (HTTP ${status}:`)), lastRecord().changes.join(" | "));
  }
});

// (fails before: yes — HarnessV4_Tasks C3: at an upstream whose wire API Filament detects, the 404 was taken for "no Chat
// Completions here" before its words were read: the request went to Responses, tools and all, and the client got that
// 404)
test("a 404 that names tools is the model's refusal even where the wire API is detected: no detour to Responses", async () => {
  up.reset();
  const r = await ask("nt404auto", "hello");
  assert.equal(r.status, 200, await r.clone().text());
  await r.json();
  assert.equal(up.received.filter((c) => c.kind === "responses").length, 0, "Responses was never asked");
  assert.equal(sent().length, 2);
  assert.equal("tools" in sent()[1], false);
  const changes = lastRecord().changes.join(" | ");
  assert.match(changes, /memory: nt404auto at local refused the request for Filament's memory tools \(HTTP 404: /);
  assert.match(changes, /memory: nt404auto at local answered without them — it takes no tools/);
  assert.doesNotMatch(changes, /wire API:/);
  // Nothing was learned about the server's wire API: its next request starts on Chat Completions.
  up.reset();
  await (await ask("some-other-model", "hello")).json();
  assert.deepEqual(up.received.map((c) => c.kind), ["openai"]);
});

// (fails before: yes, on the count of calls alone — the detour ran first, in two; the server was found either way. And
// again in the bug hunt of 10-30: a 404 that named a function went again without memory's tools before Responses was
// asked, a paid call that met the same 404) a server with no Chat Completions is still found when its 404 happens to
// name a function: the words refuse no tools, so Responses is asked next
test("a server with no Chat Completions is still found when its 404 names a function", async () => {
  up.reset();
  const r = await ask("ro-model", "hello");
  assert.equal(r.status, 200, await r.clone().text());
  await r.json();
  assert.deepEqual(up.received.map((c) => c.kind), ["openai", "responses"]);
  const changes = lastRecord().changes.join(" | ");
  assert.doesNotMatch(changes, /without them/);
  assert.match(changes, /wire API: auto2 has no Chat Completions — Responses served the request/);
  // Remembered: the next request goes straight to Responses.
  up.reset();
  await (await ask("ro-model", "again")).json();
  assert.deepEqual(up.received.map((c) => c.kind), ["responses"]);
});

// (fails before: no — for the mutants that remembered, and looked up, the name the client asked for) a refusal is the
// model's the route sends: remembered under that name, and found by it from another name routed there
test("a refusal is remembered under the model the route sends, so another name for it is offered no tools", async () => {
  up.reset();
  const r = await ask("alias-a", "hello");
  assert.equal(r.status, 200, await r.clone().text());
  await r.json();
  assert.deepEqual(sent().map((b) => b.model), ["notools-real", "notools-real"]);
  assert.ok(lastRecord().changes.some((/** @type {string} */ c) => c.startsWith("memory: notools-real at local answered without them")), lastRecord().changes.join(" | "));
  up.reset();
  await (await ask("alias-b", "the other name")).json();
  assert.equal(sent().length, 1, "one call: the model behind the name refused before");
  assert.equal("tools" in sent()[0], false);
});

// (fails before: yes — nothing was remembered, so the request before the change carried memory's tools too)
test("what was remembered goes when the upstream's address changes: the model is asked with memory's tools again", async () => {
  up.reset();
  await (await ask("notools", "still remembered")).text();
  assert.equal(sent().length, 1, "remembered from the first test: one call, no tools");
  assert.equal("tools" in sent()[0], false);
  // (fails before: no — added for the mutant that forgot on any change) a change that leaves its address, type and wire
  // API as they were — its name, a slash at the end of its address — keeps it remembered
  const before = (await (await s.api("/api/state")).json()).config;
  before.upstreams = before.upstreams.map((/** @type {any} */ u) => (u.id === "local" ? { ...u, name: "local, renamed", baseUrl: `${up.url}/` } : u));
  const same = await s.api("/api/config", { method: "PUT", body: before });
  assert.equal(same.status, 200, await same.text());
  up.reset();
  await (await ask("notools", "still remembered after a rename")).text();
  assert.equal(sent().length, 1);
  assert.equal("tools" in sent()[0], false);
  const st = await (await s.api("/api/state")).json();
  const cfg = st.config;
  cfg.upstreams = cfg.upstreams.map((/** @type {any} */ u) => (u.id === "local" ? { ...u, baseUrl: `${up.url}/v1` } : u));
  const put = await s.api("/api/config", { method: "PUT", body: cfg });
  assert.equal(put.status, 200, await put.text());
  up.reset();
  const r = await ask("notools", "after the address changed");
  assert.equal(r.status, 200, await r.clone().text());
  await r.json();
  assert.equal(sent().length, 2, "asked with memory's tools again, then without");
  assert.ok(memoryTools(sent()[0]).length >= 3);
});
