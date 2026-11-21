// @ts-check
// HarnessV3-Responsiveness R2 (2026-10-01): the widgets' preview composes the whole history about a dozen times and
// the agent loop measures it every round, and 88% of a preview was the token count of texts already counted (a CPU
// profile of five previews over 26 turns: 2,288 of 2,599 ms in `countTextTokens`). The count of a text never changes,
// so a long text's count is remembered: the same answers, a bounded map, the most recently used kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenMemo, estimateTokens, estimateBodyTokens } from "../src/core/tokens.js";

test("a long text is counted once, a short one every time, and the answer is the counter's", () => {
  let calls = 0;
  const memo = createTokenMemo({ count: (s) => (calls++, s.length), minChars: 10, maxEntries: 5 });
  const long = "x".repeat(50);
  assert.equal(memo.count(long), 50);
  assert.equal(memo.count(long), 50);
  assert.equal(calls, 1, "the second count of the same text is remembered");
  assert.equal(memo.count("x".repeat(50)), 50);
  assert.equal(calls, 1, "the same text built again is the same text");
  assert.equal(memo.count("short"), 5);
  assert.equal(memo.count("short"), 5);
  assert.equal(calls, 3, "a text under minChars is always counted (cheaper than remembering)");
});

test("the map stays within its bound and drops the least recently used text", () => {
  let calls = 0;
  const memo = createTokenMemo({ count: (s) => (calls++, s.length), minChars: 1, maxEntries: 3 });
  const t = (/** @type {string} */ c) => c.repeat(4);
  memo.count(t("a"));
  memo.count(t("b"));
  memo.count(t("c"));
  memo.count(t("a")); // a is used again: now the newest
  memo.count(t("d")); // one over the bound: b, the least recently used, goes
  assert.equal(memo.size, 3);
  calls = 0;
  memo.count(t("a"));
  memo.count(t("c"));
  memo.count(t("d"));
  assert.equal(calls, 0, "a, c and d are still remembered");
  memo.count(t("b"));
  assert.equal(calls, 1, "b was the one dropped");
});

test("the estimates are what they were before the memo, cold and warm", () => {
  const body = {
    system: "You are a careful agent. ".repeat(40),
    messages: [
      { role: "user", content: [{ type: "text", text: "Read the file and summarise it. ".repeat(30) }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "src/a.js" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "const x = 1; // 数字 12345\n".repeat(200) }] },
    ],
    tools: [{ name: "read", description: "Read a file. ".repeat(30), input_schema: { type: "object" } }],
    tool_choice: { type: "auto" },
  };
  // Pinned from the estimator before the memo existed (2026-10-01): remembering must never move a count.
  for (let i = 0; i < 2; i++) {
    assert.equal(estimateBodyTokens(structuredClone(body), "request"), 3069);
    assert.equal(estimateBodyTokens(structuredClone(body), "conversation"), 2914);
    assert.equal(estimateTokens("The quick brown fox, 1234567 times. ".repeat(20)), 217);
  }
});
