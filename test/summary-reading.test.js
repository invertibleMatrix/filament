// What a summary pass reads (HarnessV4_Tasks C29, C30): Filament's copy of the chat — a coding agent's turns as their
// folds, the loop's with their calls and results — the person's and the model's words whole in every reading, in pieces
// a slice pass can end between; tool traffic to its cap, the cut said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldedTranscript, readTurn, readMessages, summaryTranscript, turnTranscript } from "../src/app/sessions/compaction.js";
import { rawMessages } from "../src/app/sessions/shapes.js";
import { wordsInPieces, renderMessages } from "../src/core/trim.js";
import { estimateTokens } from "../src/core/tokens.js";

/** A finished turn of `calls` steps: each says something, reads a file and gets `result` characters back. */
const workTurn = (n, { calls = 3, said = 40, result = 6000 } = {}) => ({
  turnId: 100 + n,
  n,
  user: { role: "user", content: [{ type: "text", text: `turn ${n}: go through the files` }] },
  work: Array.from({ length: calls }, (_, i) => [
    { role: "assistant", content: [{ type: "text", text: `Step ${i}: ${"word ".repeat(said)}SAID-${n}-${i}` }, { type: "tool_use", id: `c${n}_${i}`, name: "Read", input: { file_path: `src/f${i}.js` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `c${n}_${i}`, content: `RESULT-${n}-${i} ${"line ".repeat(result / 5)}` }] },
  ]).flat(),
  final: { role: "assistant", content: [{ type: "text", text: `Turn ${n} report: every file read.` }] },
  meta: {},
});

// (fails before: yes — HarnessV4_Tasks C30 item 3: the person's text was cut at 4,000 characters, each of the model's
// at 2,000 or 4,000; and the owner's rules of 10-31, rule 2 — "it reads the whole turns when they fit its window": a
// tool's input and its result were cut at 300 and 800 characters, a reading the rule does not have)
test("turnTranscript: the turn read whole — the person's and the model's words, each tool call's input and its result", () => {
  const long = (/** @type {string} */ mark, /** @type {number} */ n) => `${"word ".repeat(n / 5)}${mark}`;
  const t = {
    turnId: 1,
    n: 7,
    user: { role: "user", content: [{ type: "text", text: long("ASKED-END", 9000) }] },
    work: [
      { role: "assistant", content: [{ type: "text", text: long("SAID-END", 5000) }, { type: "tool_use", id: "a", name: "Write", input: { file_path: "src/a.js", content: "c".repeat(1000) } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: `${"r".repeat(2000)}RESULT-END` }] },
      { role: "assistant", content: [{ type: "tool_use", id: "b", name: "Read", input: { file_path: "src/b.js" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: "short result" }] },
    ],
    final: { role: "assistant", content: [{ type: "text", text: long("FINAL-END", 12000) }] },
    meta: {},
  };
  const lines = turnTranscript(t).split("\n");
  assert.equal(lines[0], "## Turn 7");
  assert.equal(lines[1], `User: ${long("ASKED-END", 9000)}`, "what was asked, to its end");
  assert.equal(lines[2], `Assistant: ${long("SAID-END", 5000)}`, "what the model said between calls");
  assert.equal(lines.at(-1), `Assistant: ${long("FINAL-END", 12000)}`, "the reply");
  assert.equal(lines[3], `Tool call Write: ${JSON.stringify(t.work[0].content[1].input)}`, "the call's input, to its end");
  assert.equal(lines[4], `Result: ${"r".repeat(2000)}RESULT-END`, "what it returned, to its end");
  assert.deepEqual(lines.slice(5, 7), ['Tool call Read: {"file_path":"src/b.js"}', "Result: short result"]);
  assert.equal(lines.length, 8);
});

// (fails before: yes — the one reading there was read each call's result, 800 characters of it, and cut the model's own words at 2,000)
test("foldedTranscript: what was asked, the model's words whole, each call on one line, and no result", () => {
  const t = workTurn(1, { calls: 3, said: 600 });
  const f = foldedTranscript(t);
  assert.match(f, /^## Turn 1\nUser: turn 1: go through the files\nAssistant: /);
  for (const i of [0, 1, 2]) {
    assert.ok(f.includes(`SAID-1-${i}`), `step ${i}'s words to their end`);
    assert.ok(f.includes(`⚙ Read src/f${i}.js`), `step ${i}'s call on a line`);
    assert.ok(!f.includes(`RESULT-1-${i}`), `step ${i}'s result is not read`);
  }
  assert.ok(f.includes("Turn 1 report: every file read."), "the reply");
  const whole = turnTranscript(t);
  assert.ok(whole.includes("Result: RESULT-1-0") && whole.includes("SAID-1-0"), "the whole reading has the results too, and the same words");
  const heavy = workTurn(2, { calls: 20, said: 10 });
  assert.ok(estimateTokens(foldedTranscript(heavy)) * 3 < estimateTokens(turnTranscript(heavy)), "a turn of tool work reads at a fraction folded");
});

// (fails before: yes — a turn the adapter folded into text was read as a reply: its first 4,000 characters)
test("readTurn and readMessages: a coding agent's copy reads every turn folded; the loop's reads a turn whole, one that reached it folded into text too", () => {
  const t = workTurn(3);
  assert.equal(readTurn(t), turnTranscript(t), "the loop's reading");
  assert.equal(readTurn(t, true), foldedTranscript(t), "a coding agent's copy");
  assert.deepEqual(readMessages(t), rawMessages(t), "as archived for a slice pass");
  const folded = readMessages(t, true);
  assert.deepEqual(folded.map((m) => m.role), ["user", "assistant"], "the fold: two messages");
  assert.ok(folded.every((m) => (Array.isArray(m.content) ? m.content : []).every((b) => b.type === "text")), "words alone");
  // Another engine's turn, folded into text on its way here: one long reply.
  const body = `[Filament folded this turn: 400 tool calls shown one line each — re-run a tool if you need its output]\n${Array.from({ length: 400 }, (_, i) => `⚙ Read src/g${i}.js → 120 lines · 3.4 KB`).join("\n")}\nLAST-WORDS`;
  const crossed = { turnId: 9, n: 9, user: { role: "user", content: [{ type: "text", text: "turn 9" }] }, work: [], final: { role: "assistant", content: [{ type: "text", text: body }] }, meta: { adapted: "folded" } };
  assert.equal(readTurn(crossed), turnTranscript(crossed), "the loop's reading, as any turn of its own");
  assert.ok(readTurn(crossed).includes("LAST-WORDS") && readTurn(crossed).includes("⚙ Read src/g399.js"), "read to its end");
  assert.equal(readMessages(crossed).length, 2);
  assert.ok(readMessages(crossed)[1].content[0].text.endsWith("LAST-WORDS"));
});

test("summaryTranscript: the summary before, then each turn in the copy's reading", () => {
  const list = [workTurn(4), workTurn(5), workTurn(6)];
  const s = summaryTranscript("[The summary an earlier compaction wrote of turns 1–3]\nEARLIER", list, true);
  assert.match(s, /^\[The summary an earlier compaction wrote of turns 1–3\]\nEARLIER\n\n## Turn 4\nUser: /);
  assert.ok(s.includes("⚙ Read src/f0.js") && !s.includes("RESULT-4-0"), "folded: each call on a line, no result");
  assert.ok(summaryTranscript(null, list).includes("Result: RESULT-4-0"), "whole by default");
});

// (fails before: yes — a slice pass rendered each message under its cap of 24,000 characters: the rest of a long summary was never read)
test("wordsInPieces: a message of words longer than a piece becomes messages of the same role, cut between lines, nothing lost; traffic is left as it is", () => {
  const lines = Array.from({ length: 300 }, (_, i) => `FACT-${i}: ${"something that was settled ".repeat(4)}`);
  const long = { role: "user", content: [{ type: "text", text: lines.join("\n") }] };
  const short = { role: "assistant", content: [{ type: "text", text: "Understood." }] };
  const call = { role: "assistant", content: [{ type: "text", text: "x".repeat(9000) }, { type: "tool_use", id: "a", name: "Read", input: {} }] };
  const result = { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "y".repeat(9000) }] };
  const toolRole = { role: "tool", tool_call_id: "a", content: "z".repeat(9000) };
  const out = wordsInPieces([long, short, call, result, toolRole], 2000);
  const pieces = out.slice(0, -4);
  assert.ok(pieces.length > 10 && pieces.every((m) => m.role === "user" && m.content[0].text.length <= 2000), `pieces: ${pieces.length}`);
  assert.equal(pieces.map((m) => m.content[0].text).join("\n"), lines.join("\n"), "every word, in order");
  assert.deepEqual(out.slice(-4), [short, call, result, toolRole], "a short message, a call, a result: as they were");
  assert.ok(!renderMessages(pieces, { cap: 2000 }).some((r) => /more characters in Filament's archive/.test(r)), "and the pass's cap clips none of it");
  // One line longer than a piece is cut where the piece ends.
  const one = wordsInPieces([{ role: "assistant", content: "q".repeat(5000) }], 2000);
  assert.deepEqual(one.map((m) => m.content[0].text.length), [2000, 2000, 1000]);
  // Two text blocks are one message's words.
  const two = wordsInPieces([{ role: "user", content: [{ type: "text", text: "a".repeat(1500) }, { type: "text", text: "b".repeat(1500) }] }], 2000);
  assert.deepEqual(two.map((m) => m.content[0].text.length), [1500, 1500]);
});

