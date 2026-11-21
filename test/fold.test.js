// The fold (src/core/fold.js): a finished turn as its report — the user's words, one stub per tool call, the model's
// text — with the turn segmentation it folds over (src/core/turns.js) and the composition a request record keeps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldGroup, composition, stubLine, argSummary, resultSummary } from "../src/core/fold.js";
import { segmentTurns } from "../src/core/turns.js";

/** The fold's numbers as a fold compaction passes them. */
const P = { stubChars: 160, foldImages: true };

// A conversation of completed turns with tool traffic, anthropic shape. Each turn: user text → assistant thinking +
// text + tool_use → tool_result (big) → assistant tool_use → tool_result → assistant final text.
function convo(turns, { format = "anthropic", tag = "topic", big = 4000 } = {}) {
  const out = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: `${tag} turn ${i}: please fix file${i}.js` });
    if (format === "anthropic") {
      out.push({ role: "assistant", content: [{ type: "thinking", thinking: `thinking about ${i} `.repeat(50), signature: "sig" }, { type: "text", text: `Looking at file${i}.js.` }, { type: "tool_use", id: `r${i}`, name: "Read", input: { file_path: `H:/proj/file${i}.js` } }] });
      out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `r${i}`, content: `line of file${i} `.repeat(Math.ceil(big / 15)) }] });
      out.push({ role: "assistant", content: [{ type: "tool_use", id: `b${i}`, name: "Bash", input: { command: `npm test -- file${i}` } }] });
      out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `b${i}`, content: `ok 3 tests`, is_error: false }] });
      out.push({ role: "assistant", content: [{ type: "text", text: `Fixed file${i}.js: the off-by-one on line 12 (${tag}). Tests pass.` }] });
    } else {
      out.push({ role: "assistant", content: `Looking at file${i}.js.`, tool_calls: [{ id: `r${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `H:/proj/file${i}.js` }) } }] });
      out.push({ role: "tool", tool_call_id: `r${i}`, content: `line of file${i} `.repeat(Math.ceil(big / 15)) });
      out.push({ role: "assistant", content: null, tool_calls: [{ id: `b${i}`, type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `npm test -- file${i}` }) } }] });
      out.push({ role: "tool", tool_call_id: `b${i}`, content: `ok 3 tests` });
      out.push({ role: "assistant", content: `Fixed file${i}.js: the off-by-one on line 12 (${tag}). Tests pass.` });
    }
  }
  return out;
}

// ---- segmentation --------------------------------------------------------------------------------------------------
test("segmentTurns: a turn starts at a user message that is not a tool result; leading system messages are not a turn", () => {
  const ms = [{ role: "system", content: "s" }, ...convo(3)];
  const { lead, groups } = segmentTurns(ms, "anthropic");
  assert.equal(lead, 1);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].from, 1);
  assert.equal(groups[2].to, ms.length);
  for (const g of groups) assert.equal(ms[g.from].role, "user");
  const oa = segmentTurns(convo(2, { format: "openai" }), "openai");
  assert.equal(oa.groups.length, 2, "openai role:tool legs do not start a turn");
});

test("segmentTurns: an assistant-first prologue passes through as its own raw group", () => {
  const ms = [{ role: "assistant", content: "hello" }, { role: "user", content: "hi" }, { role: "assistant", content: "yes" }, { role: "user", content: "go" }];
  const { groups } = segmentTurns(ms, "anthropic");
  assert.equal(groups[0].prologue, true);
  assert.deepEqual(groups.slice(1).map((g) => g.from), [1, 3]);
});

// ---- the fold ------------------------------------------------------------------------------------------------------
test("foldGroup: a completed turn becomes user text + one assistant message with the text and one stub per tool call, in order", () => {
  const ms = convo(1);
  const f = foldGroup(ms, segmentTurns(ms, "anthropic").groups[0], "anthropic", P);
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[0].role, "user"); assert.equal(f.messages[1].role, "assistant");
  const body = f.messages[1].content[0].text;
  assert.match(body, /^\[Filament folded this turn: 2 tool calls/);
  const lines = body.split("\n");
  assert.equal(lines[1], "Looking at file0.js.");
  assert.match(lines[2], /^⚙ Read H:\/proj\/file0\.js → \d+ lines? · [\d.]+ KB$/);
  assert.match(lines[3], /^⚙ Bash npm test -- file0 → ok 3 tests$/);
  assert.match(lines[4], /^Fixed file0\.js/);
  assert.equal(f.stubs, 2);
  assert.ok(!JSON.stringify(f.messages).includes("thinking about"), "thinking is gone");
  assert.ok(!JSON.stringify(f.messages).includes("tool_use"), "no tool blocks remain, so no pairing can be broken");
});

test("foldGroup: openai shape folds to plain strings with the same stubs", () => {
  const ms = convo(1, { format: "openai" });
  const f = foldGroup(ms, segmentTurns(ms, "openai").groups[0], "openai", P);
  assert.equal(typeof f.messages[1].content, "string");
  assert.equal(f.messages[1].tool_calls, undefined);
  assert.match(f.messages[1].content, /⚙ read_file H:\/proj\/file0\.js → \d+ lines? · [\d.]+ KB\n⚙ bash npm test -- file0 → ok 3 tests/);
});

test("foldGroup: a folded turn is a pure function of its bytes — the same turn folds the same as the conversation grows, and the input is never touched", () => {
  const short = convo(2);
  const long = convo(4);
  const before = JSON.stringify(long);
  const fold = (/** @type {any[]} */ ms, /** @type {number} */ i) => JSON.stringify(foldGroup(ms, segmentTurns(ms, "anthropic").groups[i], "anthropic", P).messages);
  assert.equal(fold(short, 0), fold(long, 0));
  assert.equal(fold(short, 1), fold(long, 1));
  assert.equal(fold(long, 1), fold(long, 1), "deterministic");
  assert.equal(JSON.stringify(long), before, "never mutates the input");
});

test("foldGroup: images in the turn's message become a placeholder, and stay when foldImages is off", () => {
  const ms = [
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(20000) } }] },
    { role: "assistant", content: [{ type: "text", text: "I see a chart with a red line." }] },
  ];
  const g = segmentTurns(ms, "anthropic").groups[0];
  const on = foldGroup(ms, g, "anthropic", P);
  assert.ok(!JSON.stringify(on.messages).includes("AAAAAAAA"), "the base64 is gone");
  assert.match(on.messages[0].content[0].text, /look\n\[image\]/);
  const off = foldGroup(ms, g, "anthropic", { ...P, foldImages: false });
  assert.ok(JSON.stringify(off.messages).includes("AAAAAAAA"), "kept when asked");
});

test("stubs: the identifying argument, a short result verbatim, a long one as size, an error as its first line; capped", () => {
  assert.equal(argSummary({ file_path: "a/b.js", other: 1 }), "a/b.js");
  assert.equal(argSummary(JSON.stringify({ command: "ls -la" })), "ls -la");
  assert.equal(argSummary({ x: 1, y: "z" }), "x=1 y=z");
  assert.equal(argSummary("plain"), "plain");
  assert.equal(resultSummary("ok"), "ok");
  assert.equal(resultSummary("", false), "(no output)");
  assert.equal(resultSummary("boom\nstack", true), "error: boom stack");
  assert.match(resultSummary("x".repeat(5000)), /^1 line · 4\.9 KB$/);
  assert.match(resultSummary("a\n".repeat(300)), /^300 lines · 600 chars$/);
  const s = stubLine("Read", { file_path: "p".repeat(300) }, "r".repeat(300), false, 100);
  assert.ok(s.length <= 100, `capped at stubChars (${s.length})`);
  assert.ok(s.startsWith("⚙ Read "));
});

// ---- composition ---------------------------------------------------------------------------------------------------
test("composition: characters by class, both formats", () => {
  const c = composition(convo(2), "anthropic", { system: "sys", tools: [{ name: "Read" }] });
  assert.ok(c.toolResult > c.userText, "tool results dominate this conversation");
  assert.ok(c.thinking > 0); assert.equal(c.toolCalls, 4); assert.equal(c.system, JSON.stringify("sys").length); assert.ok(c.tools > 0);
  const o = composition(convo(2, { format: "openai" }), "openai");
  assert.equal(o.toolCalls, 4); assert.ok(o.toolResult > 0); assert.ok(o.toolUse > 0);
  assert.deepEqual([c.subagents, c.subagentCalls, o.subagents], [0, 0, 0], "no sub-agent traffic, no share");
});

test("composition: sub-agents' share — launching calls, their results, Filament's reports and notices — is carved out, so the classes still add up", () => {
  const report = "[Filament: your background sub-agent sa_0123abcd (\"Scan\") finished. You asked it:\nSCAN\n\nIts report:\nALL CLEAR]";
  const ms = [
    { role: "user", content: [{ type: "text", text: report }, { type: "text", text: "go on" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "a1", name: "agent", input: { description: "d", prompt: "look around" } }, { type: "tool_use", id: "r1", name: "read", input: { path: "x" } }, { type: "tool_use", id: "z1", name: "Agent", input: { prompt: "client's own" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: "THE REPORT" }, { type: "tool_result", tool_use_id: "r1", content: "file body" }, { type: "tool_result", tool_use_id: "z1", content: [{ type: "text", text: "CLIENT REPORT" }] }] },
  ];
  const c = composition(ms, "anthropic");
  const launchChars = JSON.stringify({ description: "d", prompt: "look around" }).length + JSON.stringify({ prompt: "client's own" }).length;
  assert.equal(c.subagents, report.length + launchChars + "THE REPORT".length + "CLIENT REPORT".length);
  assert.deepEqual([c.subagentCalls, c.toolCalls], [2, 3], "launches count among the tool calls too");
  assert.deepEqual([c.userText, c.toolUse, c.toolResult], ["go on".length, JSON.stringify({ path: "x" }).length, "file body".length], "what is not theirs stays in its class");
  const whole = composition(ms.map((m) => ({ ...m, content: m.content.map((b) => (b.type === "tool_use" ? { ...b, name: "other" } : b.type === "text" ? { ...b, text: b.text.replace("sa_0123abcd", "sb_0123abcd") } : b)) })), "anthropic");
  const sum = (/** @type {any} */ x) => x.userText + x.assistantText + x.toolUse + x.toolResult + x.thinking + x.subagents;
  assert.equal(sum(c), sum(whole), "the same bytes, reclassed — never counted twice");
  const openai = composition([
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "Task", arguments: "{\"prompt\":\"p\"}" } }] },
    { role: "tool", tool_call_id: "c1", content: "TASK REPORT" },
  ], "openai");
  assert.deepEqual([openai.subagents, openai.subagentCalls, openai.toolResult, openai.toolUse], ["{\"prompt\":\"p\"}".length + "TASK REPORT".length, 1, 0, 0]);
});
