// @ts-check
// A prompt its agent's adapter failed over calls left unanswered, though the agent had ended its turn, is answered as
// ended (HarnessV4_Tasks B15; adapters/agents/acp/open-end.js). Through the app, a coding agent's turn that failed
// after doing work is in test/agent-steps.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenEnd } from "../src/adapters/agents/acp/open-end.js";

/** The failure as Claude's adapter sends it. @param {string} ids @param {string} [kind] */
const failure = (ids, kind = "incomplete_tool_call") => Object.assign(new Error(`Internal error: Claude ended the turn without returning results for tool calls: ${ids}`), { code: -32603, data: { errorKind: kind } });
const call = (/** @type {string} */ id, extra = {}) => ({ type: "tool", id, status: "in_progress", ...extra });
const words = (/** @type {string} */ text, extra = {}) => ({ type: "text", text, ...extra });

// (fails before: yes — B15: nothing read such a failure: a turn Claude had answered ended as an error, its reply and
// work dropped)
test("a turn the adapter failed over unanswered calls is answered as ended where the agent's last word was its reply", () => {
  /** @type {string[]} */
  const notes = [];
  const t = createOpenEnd({ notes, who: "Claude Code" });
  t.heard(call("wf1"));
  t.heard(call("wf1", { status: "completed" }));
  t.heard(words("Launched the workflow; here is the summary."));
  // What the work left behind the turn does is its own: a sub-agent's calls and words, the adapter's failing of a call.
  t.heard(call("sub-read", { subagent: "sa1" }));
  t.heard(call("sub-edit", { parentToolCallId: "wf1" }));
  t.heard(words("still working", { subagent: "sa1" }));
  t.heard(call("wf1", { status: "failed" }));
  assert.deepEqual(t.answer(failure("toolu_a, toolu_b, toolu_c")), { stopReason: "end_turn" });
  assert.deepEqual(notes, [
    "acp: Claude Code's adapter failed this prompt after Claude Code had answered: 3 tool calls had no result when the turn ended, which is how it counts work left running behind a turn. The turn is kept as Claude Code ended it, with its reply and its work; those calls read as the adapter closed them, and the turn's token counts are Filament's estimate, the failed prompt having carried none",
  ]);
  assert.match(String(notes[0]), /^acp: /, "a note of the bridge's, as the record's changes read them");
  const one = createOpenEnd({ notes: [], who: "Claude Code" });
  one.heard(words("Done."));
  assert.deepEqual(one.answer(failure("toolu_a")), { stopReason: "end_turn" }, "words alone are a reply");
});

test("it stays a failure where the turn ended on a call, said nothing, or failed another way", () => {
  /** @param {(t: ReturnType<typeof createOpenEnd>) => void} said @param {any} e */
  const thrown = (said, e) => {
    /** @type {string[]} */
    const notes = [];
    const t = createOpenEnd({ notes, who: "Claude Code" });
    said(t);
    assert.throws(() => t.answer(e), (/** @type {any} */ got) => got === e, "the failure itself, thrown on");
    assert.deepEqual(notes, [], "and no note");
  };
  thrown(() => {}, failure("toolu_a"));
  thrown((t) => t.heard(call("c1")), failure("c1"));
  thrown((t) => (t.heard(words("Let me check.")), t.heard(call("c1"))), failure("c1"));
  thrown((t) => (t.heard(words("  \n")), t.heard(words("Filament: a note of its own", { own: true }))), failure("c1"));
  thrown((t) => t.heard(words("the agent's sub-agent said this", { subagent: "sa1" })), failure("c1"));
  thrown((t) => t.heard(words("An answer.")), failure("c1", "overloaded"));
  thrown((t) => t.heard(words("An answer.")), new Error("agent process exited (code 3)"));
  // A call's later updates are not a new call: the reply after it still stands.
  const t = createOpenEnd({ notes: [], who: "Claude Code" });
  t.heard(call("c1"));
  t.heard(words("An answer."));
  t.heard(call("c1", { status: "failed" }));
  assert.deepEqual(t.answer(failure("c1")), { stopReason: "end_turn" });
});
