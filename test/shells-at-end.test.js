// @ts-check
// A sub-agent that would end its turn with commands it started in the background still running is told so, once per
// command (g3b, the friction of 11-09: a builder ended with its test run going, and nobody said so). Shaped as the
// sealed-envelope reminder: said as the turn would end, which commands still run and that their results come to it at
// its next step while it works, else to whoever launched it; the next end is its own. Against scripted replies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { SUBAGENT_OFF, loopToolArgs } from "../src/app/agent/tools.js";
import { runAgentTurn, shellsReminder } from "../src/app/agent/loop.js";

const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
const said = (/** @type {string} */ t) => [{ type: "text", text: t }];
/**
 * A sub-agent's run, its replies scripted, the background commands it started that still run given by `shells` (null:
 * a run that is offered none, as the main agent's is).
 * @param {any[][]} replies @param {((replies: number) => { id: string, command: string }[]) | null} shells
 */
const run = (replies, shells) => {
  let n = 0;
  /** @type {any[][]} */
  const seen = [];
  const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "THE BRIEF" }],
    system: "s",
    tools: loopToolArgs({ disabled: SUBAGENT_OFF }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async (/** @type {any} */ { body }) => {
      seen.push(structuredClone(body.messages));
      return { ok: true, status: 200, json: { content: replies[n++] || said("Out of words."), usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
    },
    costOf: () => 0,
    runHand: async () => {
      throw new Error("no hand runs here");
    },
    delegateRead: null,
    unattended: "subagent",
    mailbox: { read: () => [] },
    shellsRunning: shells ? () => shells(n) : null,
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
  }));
  return { out, seen };
};

// (fails before: yes — a sub-agent's run ended as its model ended it, its background commands unsaid)
test("a sub-agent ending with background commands still running is told which, once each; the next end is its own", async () => {
  const TESTS = { id: "bg_1a2b", command: "npm   test\n -- --runInBand" };
  const BUILD = { id: "bg_3c4d", command: "npm run build" };
  // Both run at its first end; at its second the build, said already, and a new one; at its third nothing new.
  const r = run([said("All done."), said("Waited."), said("Done now."), said("Really done.")], (n) => (n <= 1 ? [TESTS, BUILD] : [BUILD, { id: "bg_5e6f", command: "node serve.js" }]));
  const out = await r.out;
  assert.equal(out.status, "done");
  const reminder = shellsReminder([TESTS, BUILD]);
  assert.equal(
    reminder,
    "[Filament: commands you started in the background still run: bg_1a2b (npm test -- --runInBand), bg_3c4d (npm run build). Each one's result comes to you at your next step once it ends, while you work: wait for it with bash_output (its id, with until or wait), or stop it with bash_kill if you no longer need it. End your turn now and their results go to whoever launched you, unread by you.]",
  );
  assert.deepEqual(r.seen[1].at(-1), { role: "user", content: [{ type: "text", text: reminder }] }, "said as the turn would end");
  assert.deepEqual(r.seen[1].at(-2), { role: "assistant", content: said("All done.") }, "its words stay in the conversation");
  assert.deepEqual(r.seen[2].at(-1), { role: "user", content: [{ type: "text", text: shellsReminder([{ id: "bg_5e6f", command: "node serve.js" }]) }] }, "a command said once is not said again; a new one is");
  assert.equal(r.seen.length, 3, "its third end is its own");
  assert.deepEqual(out.final, said("Done now."));
  assert.equal(out.notes.filter((/** @type {string} */ x) => x.startsWith("agent: background commands still ran as the turn would end")).length, 2, out.notes.join("\n"));
});

test("a run with no background command running, or offered none, ends as its model ends it", async () => {
  for (const shells of [() => [], null]) {
    const r = run([said("All done.")], shells);
    const out = await r.out;
    assert.deepEqual([out.status, r.seen.length], ["done", 1]);
  }
});
