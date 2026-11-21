// @ts-check
// A command judged once, read once (the performance audit of 10-29, second pass): whether a command only reads is a
// look at the disk — each path it names resolved, PowerShell's folders walked — and one call's judgement asked it of
// the same command at its fence, its gate and a review rule, each looking again. Now a judgement reads each command
// once: the loop's for one call, the coding agent's switch for one request.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { removeDirs } from "./helpers/wait.js";

/** How often `fn` resolves a path while it runs: the readers' looks at the disk. @param {() => unknown} fn */
async function resolvesIn(fn) {
  const real = fs.realpathSync;
  let n = 0;
  const counted = Object.assign((/** @type {any[]} */ ...a) => (n++, /** @type {any} */ (real)(...a)), { native: real.native });
  fs.realpathSync = /** @type {any} */ (counted);
  syncBuiltinESMExports();
  try {
    await fn();
  } finally {
    fs.realpathSync = real;
    syncBuiltinESMExports();
  }
  return n;
}

/** A rule that asks with a second look, which leaves a command that only reads to the gate (SG-D13). */
const REVIEW = [{ tool: "bash", pattern: "*", verdict: "review" }];

// (fails before: yes — the gate read the command, and the review rule read it again)
test("the coding agent's switch reads a request's command once, whatever rules judge it", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-reads-once-"));
  try {
    writeFileSync(join(root, "a.txt"), "x");
    const call = [{ name: "bash", input: { command: "cat a.txt" } }];
    const at = (/** @type {any[]} */ rules) => createAgentPermits({ rules, modeNow: () => /** @type {any} */ ("ask"), learned: null });
    /** @type {any} */
    let plain = null;
    /** @type {any} */
    let reviewed = null;
    const bare = await resolvesIn(() => (plain = at([]).judge(call, root)));
    const ruledToo = await resolvesIn(() => (reviewed = at(REVIEW).judge(call, root)));
    assert.equal(plain.verdict, "run");
    assert.equal(reviewed.verdict, "run", "a command that only reads is the gate's, the review rule says");
    assert.ok(bare > 0, "the reader looks at the disk");
    assert.equal(ruledToo, bare, "the rule's question is answered by the gate's reading");
  } finally {
    await removeDirs(root);
  }
});

// (fails before: yes — the same: the loop's gate read the command, and the review rule read it again)
test("the loop reads a call's command once, whatever rules judge it", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-reads-once-loop-"));
  try {
    writeFileSync(join(root, "a.txt"), "x");
    const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
    /** @type {string[]} */
    const ran = [];
    /** @param {any[]} rules */
    const turn = (rules) => {
      let n = 0;
      return runAgentTurn(/** @type {any} */ ({
        model: "m",
        messages: [{ role: "user", content: "go" }],
        system: "s",
        tools: toolSetFor({ delegateRead: false }),
        modeNow: () => "ask",
        rules,
        root,
        readerModel: "",
        maxTokens: 100,
        call: async () => ({
          ok: true,
          status: 200,
          id: null,
          json: { usage: { input_tokens: 10, output_tokens: 5 }, content: ++n === 1 ? [{ type: "tool_use", id: "c1", name: "bash", input: { command: "cat a.txt" } }] : [{ type: "text", text: "Done." }] },
        }),
        costOf: () => 0,
        runHand: async (/** @type {string} */ name) => (ran.push(name), `${name} ran`),
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
    };
    const bare = await resolvesIn(() => turn([]));
    const ruledToo = await resolvesIn(() => turn(REVIEW));
    assert.deepEqual(ran, ["bash", "bash"], "it only reads: it runs unasked, ruled or not");
    assert.ok(bare > 0, "the reader looks at the disk");
    assert.equal(ruledToo, bare, "the rule's question is answered by the gate's reading");
  } finally {
    await removeDirs(root);
  }
});
