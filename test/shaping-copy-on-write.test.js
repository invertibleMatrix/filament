// Shaping copies only what it changes: the client's body comes out untouched, the shaped body is what every rule
// makes of it, and the parts no rule changed are the client's own objects — no deep copy of a whole conversation on
// every attempt. A memory follow-up that appends to the client's body afterwards reaches no body already shaped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRules, parseModelSuffix, shapeAnthropic, shapeOpenAI, shapeResponses } from "../src/core/shaping.js";
import { appendFollowUp } from "../src/app/memory-tools.js";

const req = (model, rules) => parseModelSuffix(model, rules);

/** A conversation that every changing rule finds something in. */
const anthropicBody = () => ({
  model: "claude-opus-4-6",
  max_tokens: 1000,
  stream: true,
  system: [{ type: "text", text: "first" }, { type: "text", text: "s".repeat(2000) }],
  tools: [{ name: "Read", input_schema: { type: "object" } }],
  output_config: { effort: "xhigh", format: { type: "json_object" } },
  thinking: { type: "adaptive" },
  messages: [
    { role: "user", content: [{ type: "text", text: "hello" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "unsigned" }, { type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "signed", signature: "sig" }, { type: "tool_use", id: "t1", name: "Read", input: { path: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "bytes" }, { type: "text", text: "go on" }] },
  ],
});

test("Anthropic: the client's body is untouched, the shaped one carries every change, the rest is shared", () => {
  const rules = mergeRules({ cache: { ensureBreakpoints: "system-and-last-user", respectClient: false } });
  const input = anthropicBody();
  const before = structuredClone(input);
  const { body, changes } = shapeAnthropic({ body: input, rules, requested: req("claude-opus-4-6", rules) });
  assert.deepEqual(input, before, "the client's body is untouched");
  // What the rules made of it
  assert.deepEqual(body.messages[1].content, [{ type: "text", text: "hi" }], "the unsigned thinking block left the history");
  assert.deepEqual(body.system[1].cache_control, { type: "ephemeral" }, "the system's last block carries the marker");
  assert.deepEqual(body.messages[3].content[1], { type: "text", text: "go on", cache_control: { type: "ephemeral" } }, "and the last user message's last block");
  assert.ok(changes.some((c) => /1 unsigned thinking block\(s\) removed/.test(c)));
  assert.deepEqual(body.messages[0].content[0], { type: "text", text: "hello", cache_control: { type: "ephemeral" } }, "and the user message before the newest reply, where the request before put its mark");
  assert.ok(changes.some((c) => /cache_control added on system \+ last user message \+ the user message before the newest reply/.test(c)));
  // What no rule changed is the client's own: nothing was copied for it
  assert.equal(body.messages[2], input.messages[2], "a signed assistant message is not copied");
  assert.equal(body.messages[3].content[0], input.messages[3].content[0], "nor a block beside the one marked");
  assert.equal(body.system[0], input.system[0]);
  assert.equal(body.tools, input.tools, "the tools are not copied");
  assert.notEqual(body.messages, input.messages, "the list a follow-up appends to is the shaped body's own");
});

test("Anthropic: a string system and a string last user message become marked blocks without touching the client's", () => {
  const rules = mergeRules({ cache: { ensureBreakpoints: "system-and-last-user", respectClient: false, minSystemChars: 0 } });
  const input = { model: "claude-fable-5-1", max_tokens: 100, system: "you help", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] };
  const before = structuredClone(input);
  const { body } = shapeAnthropic({ body: input, rules, requested: req("claude-fable-5-1", rules) });
  assert.deepEqual(input, before);
  assert.deepEqual(body.system, [{ type: "text", text: "you help", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(body.messages[2], { role: "user", content: [{ type: "text", text: "c", cache_control: { type: "ephemeral" } }] });
  assert.deepEqual(body.messages[0], { role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] });
  assert.equal(body.messages[1], input.messages[1]);
});

// (fails before: yes — the cache audit's sa_95101a98: only the newest user message was marked, so a round of ten calls
// at once put the request before's mark past Anthropic's lookback of about 20 blocks, and the whole history was
// written to the cache again)
test("Anthropic: a wide round marks the request before's last user message again, so its cache is read past the lookback", () => {
  const rules = mergeRules({ cache: { ensureBreakpoints: "system-and-last-user", respectClient: false, minSystemChars: 0 } });
  const calls = Array.from({ length: 12 }, (_, i) => ({ type: "tool_use", id: `c${i}`, name: "Read", input: { path: `f${i}` } }));
  const results = calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "x" }));
  const input = {
    model: "claude-opus-5-5",
    max_tokens: 100,
    system: "you help",
    messages: [
      { role: "user", content: "read them all" },
      { role: "assistant", content: [{ type: "tool_use", id: "c0a", name: "Read", input: { path: "index" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c0a", content: "the list" }] },
      { role: "assistant", content: calls },
      { role: "user", content: results },
    ],
  };
  const { body } = shapeAnthropic({ body: input, rules, requested: req("claude-opus-5-5", rules) });
  const marks = body.messages.flatMap((/** @type {any} */ m, /** @type {number} */ i) => (Array.isArray(m.content) ? m.content : []).map((/** @type {any} */ b, /** @type {number} */ j) => (b.cache_control ? `${i}.${j}` : "")).filter(Boolean));
  assert.deepEqual(marks, ["2.0", "4.11"], "the request before's mark, and this one's");
  assert.equal(body.messages.filter((/** @type {any} */ m) => JSON.stringify(m).includes("cache_control")).length + 1, 3, "three marks with the system's: within the provider's four");
  assert.deepEqual(shapeAnthropic({ body: { ...input, messages: input.messages.slice(0, 1) }, rules, requested: req("claude-opus-5-5", rules) }).body.messages[0].content[0].cache_control, { type: "ephemeral" }, "a first request: its own mark alone");
});

test("Anthropic: an effort the model cannot take leaves output_config as a copy, the client's keeps it", () => {
  const rules = mergeRules();
  // claude-haiku-4-5 takes no effort field: the effort goes, the format stays
  const input = { model: "claude-haiku-4-5", max_tokens: 100, output_config: { effort: "high", format: { type: "json_object" } }, messages: [{ role: "user", content: "q" }] };
  const before = structuredClone(input);
  const { body } = shapeAnthropic({ body: input, rules, requested: req("claude-haiku-4-5", rules) });
  assert.deepEqual(input, before);
  assert.deepEqual(body.output_config, { format: { type: "json_object" } });
  // A model that predates output_config.effort, with nothing else in it: the whole field goes
  const only = { model: "claude-sonnet-4-5", max_tokens: 100, thinking: { type: "adaptive" }, output_config: { effort: "high" }, messages: [{ role: "user", content: "q" }] };
  const onlyBefore = structuredClone(only);
  const s = shapeAnthropic({ body: only, rules, requested: req("claude-sonnet-4-5", rules) });
  assert.deepEqual(only, onlyBefore);
  assert.equal("output_config" in s.body, false);
});

test("Chat Completions: a suffix's reasoning.effort is the shaped body's own; the client's messages are shared", () => {
  const rules = mergeRules();
  const input = { model: "gpt-5.5-high", stream: true, reasoning: { effort: "low", summary: "auto" }, messages: [{ role: "user", content: "q" }] };
  const before = structuredClone(input);
  const { body } = shapeOpenAI({ body: input, rules, requested: req("gpt-5.5-high", rules) });
  assert.deepEqual(input, before);
  assert.deepEqual(body.reasoning, { effort: "high", summary: "auto" });
  assert.equal(body.messages[0], input.messages[0]);
  assert.notEqual(body.messages, input.messages);
});

test("a memory follow-up appended to the client's body reaches no body already shaped", () => {
  const rules = mergeRules();
  const generic = { blocks: [{ type: "tool_use", id: "m1", name: "filament_memory_search", input: { query: "x" } }] };
  const results = [{ id: "m1", output: "{}" }];
  // Anthropic: the follow-up pushes the model's call and Filament's results onto the client's messages
  const a = anthropicBody();
  const shapedA = shapeAnthropic({ body: a, rules, requested: req(a.model, rules) }).body;
  const sentA = JSON.stringify(shapedA);
  appendFollowUp({ format: "anthropic", body: a, generic, results });
  assert.equal(a.messages.length, 6, "the client's body grew");
  assert.equal(JSON.stringify(shapedA), sentA, "the shaped body is what was sent");
  // Responses passthrough: it pushes onto the Responses body's input
  const r = { model: "gpt-5.5", store: false, input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };
  const shapedR = shapeResponses({ body: r, rules, requested: req(r.model, rules) }).body;
  const sentR = JSON.stringify(shapedR);
  appendFollowUp({ format: "responses", body: { messages: [] }, responsesBody: r, passthrough: true, generic, results });
  assert.equal(r.input.length, 3, "the client's input grew");
  assert.equal(JSON.stringify(shapedR), sentR, "the shaped body is what was sent");
});
