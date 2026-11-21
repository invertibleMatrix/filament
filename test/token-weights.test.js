// @ts-check
// The agent loop measures its whole conversation two or three times a round, and every tool call and result was
// stringified and hashed each time: over a long turn, the square of its length. The turn keeps what each block weighs
// (`createBlockWeights`): the same counts as weighing anew, each block stringified once, a block put in another's place
// weighed anew, a message given new words weighed anew, each choice of thinking apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { createBlockWeights, estimateBodyParts, estimateBodyTokens } from "../src/core/tokens.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

const long = (s) => `${s} `.repeat(200);
/** A conversation with every kind of block a count treats apart. @returns {any[]} */
const convo = () => [
  { role: "user", content: long("the developer's first message, as one string") },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: long("signed thought"), signature: "sig" },
      { type: "thinking", thinking: long("unsigned thought") },
      { type: "redacted_thinking", data: "x".repeat(400) },
      { type: "text", text: long("a reply") },
      { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt", note: long("input") } },
    ],
  },
  {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "t1", content: long("what the file holds") },
      { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: long("seen") }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
      { type: "document", source: { type: "text", data: long("a document") } },
      { type: "document", source: { type: "base64", data: "B".repeat(8000) } },
      { type: "image", source: { type: "base64", data: "C" } },
    ],
  },
  { role: "assistant", content: [{ type: "text", text: "short" }], tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: long("args") } }] },
];

/**
 * How many times JSON.stringify ran on a value `pick` names, while `fn` ran.
 * @template T @param {(v: any) => boolean} pick @param {() => T} fn @returns {{ value: T, n: number }}
 */
const stringified = (pick, fn) => {
  const was = JSON.stringify;
  let n = 0;
  JSON.stringify = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    if (pick(a[0])) n++;
    return was.apply(JSON, /** @type {any} */ (a));
  });
  try {
    return { value: fn(), n };
  } finally {
    JSON.stringify = was;
  }
};
const isBlock = (/** @type {any} */ v) => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.type === "string";

// (fails before: yes — there was no keeper: the counts were whole every time, every block stringified on every measure)
test("weighed with the keeper: the counts weighing anew gives, in every choice of thinking, and each block stringified once", () => {
  const messages = convo();
  const weights = createBlockWeights();
  for (const thinking of /** @type {const} */ (["all", "signed", "none"])) {
    const plain = estimateBodyParts({ messages }, "conversation", { thinking });
    const kept = estimateBodyParts({ messages }, "conversation", { thinking, weights });
    assert.deepEqual(kept, plain, thinking);
    const again = stringified(isBlock, () => estimateBodyParts({ messages }, "conversation", { thinking, weights }));
    assert.deepEqual(again.value, plain, `${thinking}, again`);
    assert.equal(again.n, 0, `${thinking}: no block stringified again`);
  }
  const fresh = stringified(isBlock, () => estimateBodyParts({ messages }, "conversation", { thinking: "all" }));
  assert.ok(fresh.n >= 4, `without the keeper every call and result is stringified each time (${fresh.n})`);
  assert.equal(estimateBodyTokens({ messages }, "conversation", 1.3, { weights }), estimateBodyTokens({ messages }, "conversation", 1.3), "the scale applies as before");
});

test("a block put in another's place, a message given new words and one with new blocks are weighed anew", () => {
  const messages = convo();
  const weights = createBlockWeights();
  const count = () => estimateBodyParts({ messages }, "conversation", { weights });
  count();
  // As the loop clears an old result: a new block where the old one was.
  messages[2] = { ...messages[2], content: [{ ...messages[2].content[0], content: "[cleared]" }, ...messages[2].content.slice(1)] };
  assert.deepEqual(count(), estimateBodyParts({ messages }, "conversation"));
  // As a turn's first message is told what changed: new words on the same message.
  messages[0].content = long("other words, longer than the first ones were");
  assert.deepEqual(count(), estimateBodyParts({ messages }, "conversation"));
  messages[0].content = [{ type: "text", text: "now blocks" }];
  assert.deepEqual(count(), estimateBodyParts({ messages }, "conversation"));
  // A block added to a message's list (the loop's own results take notes so).
  messages[3].content.push({ type: "text", text: long("a note") });
  assert.deepEqual(count(), estimateBodyParts({ messages }, "conversation"));
});

const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

// (fails before: yes — each round measured the conversation twice, every earlier call stringified each time)
test("a turn of many rounds stringifies its first call once, however often it measures the conversation", async () => {
  const first = { type: "tool_use", id: "r1", name: "read", input: { path: "a.txt" } };
  let n = 0;
  const run = () =>
    runAgentTurn(/** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "go" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "auto",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      compact: { usable: 1e9, target: 0, window: 1e9, source: null, fixed: 0, summarize: async () => ({ text: "", by: "m" }) },
      call: async () => {
        n++;
        return n === 1 ? reply([first]) : n < 7 ? reply([{ type: "tool_use", id: `r${n}`, name: "read", input: { path: `${n}.txt` } }]) : reply([{ type: "text", text: "Done." }]);
      },
      costOf: () => 0,
      runHand: async (/** @type {string} */ name) => `${name} ran`,
      delegateRead: null,
      mailbox: { read: () => [] },
      permissions: null,
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
    }));
  const was = JSON.stringify;
  let times = 0;
  JSON.stringify = /** @type {any} */ ((/** @type {any[]} */ ...a) => {
    if (a[0] === first) times++;
    return was.apply(JSON, /** @type {any} */ (a));
  });
  try {
    const out = await run();
    assert.equal(out.status, "done");
  } finally {
    JSON.stringify = was;
  }
  assert.equal(n, 7, "seven rounds");
  assert.equal(times, 1, `the first call is stringified once for its weight (${times})`);
});
