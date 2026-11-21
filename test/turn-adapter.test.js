// @ts-check
// The turn adapter (HarnessV3 Step 3 D6): a turn archived in another window's format and vocabulary comes out
// in the target's, every call rebuilt against the declared tools — translated when everything maps, folded as a
// whole when anything doesn't. Thinking drops; a cut body folds; the same inputs give the same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptTurn, wireFormatOf, ADAPTER_VERSION } from "../src/core/turn-adapter.js";
import { HAND_TOOLS } from "../src/adapters/tools/hands.js";
import { PLAN_TOOL } from "../src/app/agent/tools.js";

const OURS = [...HAND_TOOLS, PLAN_TOOL].map((t) => ({ name: t.name, schema: t.input_schema }));
const CC_EDIT = { name: "Edit", schema: { type: "object", required: ["file_path", "old_string", "new_string"], properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } } } };
const CC_READ = { name: "Read", schema: { type: "object", required: ["file_path"], properties: { file_path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } } } };

test("a same-format turn translates: our edit call rebuilt as the client's Edit, results untouched", () => {
  const turn = {
    user: { role: "user", content: "fix the typo" },
    work: [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "edit", input: { path: "f.js", edits: [{ oldText: "teh", newText: "the" }] } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ],
    final: { role: "assistant", content: "done" },
  };
  const out = adaptTurn(turn, { format: "anthropic", tools: [CC_EDIT] });
  assert.equal(out.mode, "translated");
  const call = out.messages[1].content.find((b) => b.type === "tool_use");
  assert.deepEqual({ name: call.name, input: call.input }, { name: "Edit", input: { file_path: "f.js", old_string: "teh", new_string: "the" } });
  // the result rides along with its id, so the pair stays valid for the target
  const res = out.messages[2].content[0];
  assert.equal(res.type, "tool_result");
  assert.equal(res.tool_use_id, "t1");
  assert.equal(out.messages.at(-1).content, "done");
});

test("an anthropic turn converted to openai: calls become tool_calls, results become tool messages", () => {
  const turn = {
    user: { role: "user", content: "read it" },
    work: [
      { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "read", input: { path: "a.js", offset: 5 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", content: "line 5" }] },
    ],
    final: { role: "assistant", content: "here" },
  };
  const out = adaptTurn(turn, { format: "openai", tools: [{ name: "Read", schema: CC_READ.schema }] });
  assert.equal(out.mode, "translated");
  const a = out.messages.find((m) => Array.isArray(m.tool_calls));
  assert.ok(a, "an assistant carries tool_calls");
  assert.deepEqual(JSON.parse(a.tool_calls[0].function.arguments), { file_path: "a.js", offset: 5 });
  const tool = out.messages.find((m) => m.role === "tool");
  assert.equal(tool.tool_call_id, "t9");
});

test("an openai turn converted to anthropic with the calls rebuilt", () => {
  const turn = {
    user: { role: "user", content: "read it" },
    work: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "Read", arguments: JSON.stringify({ file_path: "a.js" }) } }] },
      { role: "tool", tool_call_id: "c1", content: "bytes" },
    ],
    final: { role: "assistant", content: "done" },
  };
  const out = adaptTurn(turn, { format: "anthropic", tools: OURS });
  assert.equal(out.mode, "translated");
  const use = out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === "tool_use");
  assert.deepEqual({ name: use.name, input: use.input }, { name: "read", input: { path: "a.js" } });
  const res = out.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.type === "tool_result");
  assert.equal(res.tool_use_id, "c1");
});

test("a call with no equivalent folds the whole turn, never half of it", () => {
  const turn = {
    user: { role: "user", content: "go" },
    work: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Task", input: { prompt: "x" } }] }],
    final: { role: "assistant", content: "back" },
  };
  const out = adaptTurn(turn, { format: "anthropic", tools: OURS });
  assert.equal(out.mode, "folded");
  assert.match(String(out.reason), /Task/);
  // the fold is text-only: no tool_use blocks ride a folded turn
  assert.ok(!out.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use")));
  // every message of the turn is represented by the fold's envelope
  assert.ok(out.messages.length >= 2);
});

test("a never-crossing call passes through when the request declares the same tool", () => {
  const turn = (name, input) => ({
    user: { role: "user", content: "go" },
    work: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name, input }] }],
    final: { role: "assistant", content: "back" },
  });
  const ccFetch = { name: "WebFetch", schema: { type: "object", required: ["url", "prompt"], properties: { url: { type: "string" }, prompt: { type: "string" } } } };
  const same = adaptTurn(turn("WebFetch", { url: "https://x", prompt: "summarize" }), { format: "anthropic", tools: [ccFetch] });
  assert.equal(same.mode, "translated", "D5's no is about the crossing, not about rebuilding against the very tool that took the call");
  assert.deepEqual(same.messages[1].content.find((b) => b.type === "tool_use").input, { url: "https://x", prompt: "summarize" });
  const ours = adaptTurn(turn("WebFetch", { url: "https://x", prompt: "summarize" }), { format: "anthropic", tools: OURS });
  assert.equal(ours.mode, "folded", "our vocabulary has no WebFetch: the turn folds");
});

test("a message that said nothing but thinking is dropped, not emptied", () => {
  const turn = {
    user: { role: "user", content: "think then answer" },
    work: [
      { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "s1" }] },
      { role: "assistant", content: [{ type: "text", text: "the answer" }] },
    ],
    final: { role: "assistant", content: [{ type: "thinking", thinking: "more", signature: "s2" }, { type: "text", text: "done" }] },
  };
  const out = adaptTurn(turn, { format: "anthropic", tools: OURS });
  assert.equal(out.mode, "translated");
  assert.ok(out.messages.every((m) => !Array.isArray(m.content) || m.content.length), "no message carries an empty content array");
  assert.ok(!out.messages.some((m) => m.content?.some?.((b) => b.type === "thinking")));
  assert.equal(out.messages.length, 3, "the thinking-only message is gone, the text ones stay");
});

test("a mcp call passes through only when the same full name is declared", () => {
  const turn = (name) => ({
    user: { role: "user", content: "go" },
    work: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name, input: { repo: "x" } }] }],
    final: { role: "assistant", content: "back" },
  });
  const declared = [{ name: "mcp__github__create_issue", schema: { type: "object", properties: { repo: { type: "string" } } } }];
  const same = adaptTurn(turn("mcp__github__create_issue"), { format: "anthropic", tools: declared });
  assert.equal(same.mode, "translated");
  assert.equal(same.messages[1].content.find((b) => b.type === "tool_use").name, "mcp__github__create_issue");
  const other = adaptTurn(turn("mcp__other__thing"), { format: "anthropic", tools: declared });
  assert.equal(other.mode, "folded");
});

test("a body cut at storage folds, with the reason said", () => {
  const turn = {
    user: { role: "user", content: "big" },
    work: [],
    final: { _filament_truncated: true, bytes: 90000, head: '{"role":"assistant","content":"very lo' },
  };
  const out = adaptTurn(turn, { format: "anthropic", tools: OURS });
  assert.equal(out.mode, "folded");
  assert.match(String(out.reason), /cut/);
});

test("thinking blocks are dropped: another model's signatures never ride a rebuilt request", () => {
  const turn = {
    user: { role: "user", content: "hi" },
    work: [],
    final: { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "sig" }, { type: "text", text: "hello" }] },
  };
  const out = adaptTurn(turn, { format: "anthropic", tools: OURS });
  assert.equal(out.mode, "translated");
  assert.deepEqual(out.messages.at(-1).content, [{ type: "text", text: "hello" }]);
});

test("pure: same inputs give the same bytes, and the archived turn is never mutated", () => {
  const turn = {
    user: { role: "user", content: "fix" },
    work: [{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "edit", input: { path: "f.js", edits: [{ oldText: "a", newText: "b" }] } }] }],
    final: { role: "assistant", content: "done" },
  };
  const frozen = structuredClone(turn);
  const a = adaptTurn(turn, { format: "anthropic", tools: [CC_EDIT] });
  const b = adaptTurn(turn, { format: "anthropic", tools: [CC_EDIT] });
  assert.deepEqual(a, b);
  assert.deepEqual(turn, frozen, "the archived turn object is untouched");
  assert.equal(typeof ADAPTER_VERSION, "number");
});

test("wireFormatOf: tool_calls and tool roles mean openai; tool_use blocks mean anthropic; plain text is null", () => {
  assert.equal(wireFormatOf([{ role: "assistant", tool_calls: [] }]), "openai");
  assert.equal(wireFormatOf([{ role: "tool", tool_call_id: "c" }]), "openai");
  assert.equal(wireFormatOf([{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: {} }] }]), "anthropic");
  assert.equal(wireFormatOf([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "" }] }]), "anthropic");
  assert.equal(wireFormatOf([{ role: "user", content: "plain" }]), null);
});
