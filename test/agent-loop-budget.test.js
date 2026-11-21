// @ts-check
// One result budget through the loop: every source cuts its own result to RESULT_BUDGET_BYTES with its own notice, and
// the loop's last guard catches only what took no budget — measured before a hook's note rides on the result, so the
// guard never takes Filament's own words. Driven directly with a scripted model call; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { RESULT_BUDGET_BYTES } from "../src/adapters/tools/hands.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
// The LoopSink contract in full: `count` feeds the round-start's blocksBefore for card placement.
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };

/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });

/** A turn whose one round reads a file, and the result the model got for it. @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const readResult = async (over) => {
  let n = 0;
  const out = await runAgentTurn(args({
    call: async () => (++n === 1 ? reply([toolUse("r1", "read", { path: "a.txt" })]) : reply([{ type: "text", text: "Done." }])),
    ...over,
  }));
  assert.equal(out.status, "done");
  return String(out.work[1].content[0].content);
};

const noteHooks = /** @type {any} */ ({
  pre: async () => [],
  post: async () => [{ on: "post-tool", tool: "read", command: "lint-notes", verdict: "allow", note: "the file has 3 TODOs", args: null, ms: 1, exit: 0 }],
  turnEnd: async () => [],
  sessionStart: async () => [],
  readBackBeforeDone: false,
});

test("a result inside the budget and the room for the cap's pointer reaches the model whole, and a hook's note rides after it", async () => {
  const within = "x".repeat(RESULT_BUDGET_BYTES + 400);
  const got = await readResult({ runHand: async () => within, hooks: noteHooks });
  assert.equal(got, `${within}\n\n[hook lint-notes: the file has 3 TODOs]`);
});

test("a result that took no budget is cut loudly by the last guard — and the hook's note after it survives whole", async () => {
  const got = await readResult({ runHand: async () => "y".repeat(RESULT_BUDGET_BYTES * 3), hooks: noteHooks });
  assert.match(got, /^y+\n…\[Filament: this result ran past the 24,512 bytes one result may carry and was cut here; ask for less \(a narrower range, search or query\) and call again\]\n\n\[hook lint-notes: the file has 3 TODOs\]$/);
  assert.equal(got.indexOf("\n…[Filament"), RESULT_BUDGET_BYTES + 512);
});

test("the post-tool hook judges the guarded result — what the model will read, not more", async () => {
  /** @type {number[]} */
  const seen = [];
  const hooks = /** @type {any} */ ({ ...noteHooks, post: async (/** @type {string} */ _t, /** @type {any} */ _i, /** @type {string} */ result) => (seen.push(result.length), []) });
  await readResult({ runHand: async () => "z".repeat(100_000), hooks });
  assert.ok(seen[0] < 25_000, `${seen[0]}`);
});
