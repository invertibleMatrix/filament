// @ts-check
// What a coding agent's turn owes the end of Filament's next tool answer to it (tool-tail.js; checkpoint.js
// "tool-answer"): Cursor's CLI takes words only once a step ended, so what comes mid-turn rides the chat's own agent's
// next answer from Filament's tools — never a sub-agent's, nor another chat's — said once it went, kept where none came.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { createToolTails } from "../src/app/agent/tool-tail.js";

// (fails before: yes — the nudge map of 11-10, c-via: a reader whose words wait for a step's end heard nothing of what
// came mid-turn; the loop's own rides its next tool result)
test("owed words ride the end of the chat's own agent's next answer, once; a sub-agent's answer and another chat's carry none", async () => {
  const tails = createToolTails();
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => /** @type {any} */ ({ apply: () => ({ ok: true, text: "Added t1." }) }), turns: createAgentTurns(), subagents: () => null, membersOf: () => null, tails });
  const at = { chain: "c1", turn: null, graph: true, report: false, cwd: "/w", upstream: "cli" };
  const add = { action: "add", goal: "Ship it", tasks: [{ id: "t1" }] };
  /** @type {string[]} */
  const marks = [];
  /** @param {string} m */
  const mark = (m) => () => void marks.push(m);
  tails.owe("c1", { text: "[Filament: plan your steps.]", said: mark("said"), dropped: mark("dropped") });
  assert.equal((await tools.call("tasks", add, { ...at, chain: "c2" })).text, "Added t1.", "another chat's");
  assert.equal((await tools.call("tasks", add, { ...at, by: { id: "h1", exchange: 0, name: "helper" } })).text, "Added t1.", "a sub-agent's");
  assert.deepEqual(marks, []);
  assert.equal((await tools.call("tasks", add, at)).text, "Added t1.\n\n[Filament: plan your steps.]");
  assert.deepEqual(marks, ["said"]);
  assert.equal((await tools.call("tasks", add, at)).text, "Added t1.", "said once");
  // What no answer carried by the turn's end is let go, its owner told.
  tails.owe("c1", { text: "[Filament: memory says.]", said: mark("said"), dropped: mark("dropped") });
  tails.drop("c1");
  assert.deepEqual(marks, ["said", "dropped"]);
  assert.equal(tails.owes("c1"), false);
});

// (fails before: yes — the review of bcc37fbb7, sa_ea3782cd: owed words were fixed as they were owed, so an unplanned
// line rode the answer to the very call that planned; and a call given up took them, its answer reaching nobody)
test("owed words judged as the answer goes: what came to nothing is dropped, never said; a call given up takes none", async () => {
  const tails = createToolTails();
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => /** @type {any} */ ({ apply: () => ({ ok: true, text: "Added t1." }) }), turns: createAgentTurns(), subagents: () => null, membersOf: () => null, tails });
  const at = { chain: "c1", turn: null, graph: true, report: false, cwd: "/w", upstream: "cli" };
  const add = { action: "add", goal: "Ship it", tasks: [{ id: "t1" }] };
  /** @type {string[]} */
  const marks = [];
  /** @param {string} m */
  const mark = (m) => () => void marks.push(m);
  let planned = false;
  tails.owe("c1", { text: () => (planned ? "" : "[Filament: plan your steps.]"), said: mark("said"), dropped: mark("dropped") });
  const given = new AbortController();
  given.abort();
  assert.equal((await tools.call("tasks", add, { ...at, signal: given.signal })).text, "Added t1.", "a call given up");
  assert.deepEqual(marks, []);
  planned = true;
  assert.equal((await tools.call("tasks", add, at)).text, "Added t1.", "judged as it goes: planned since");
  assert.deepEqual(marks, ["dropped"]);
  assert.equal(tails.owes("c1"), false);
});

// (fails before: yes — the review of 11-11: the agent's own sub-agent — Cursor's task, Claude Code's Task — calls
// Filament over its agent's session, so its call stood where the agent's does, took the owed words, and the turn marked
// them said where the agent never heard them)
test("the agent's own sub-agent's call carries none: the run says whose call it came in, and the agent's own next one takes them", async () => {
  const tails = createToolTails();
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => /** @type {any} */ ({ apply: () => ({ ok: true, text: "Added t1." }) }), turns: createAgentTurns(), subagents: () => null, membersOf: () => null, tails });
  const run = createAgentRun({ publish: () => {}, sink: { breakBlock: () => 0 } });
  const at = { chain: "c1", turn: null, graph: true, report: false, cwd: "/w", upstream: "cli", callIsOwn: (/** @type {string} */ name) => run.callIsOwn(name) };
  const add = { action: "add", goal: "Ship it", tasks: [{ id: "t1" }] };
  /** @type {string[]} */
  const marks = [];
  tails.owe("c1", { text: "[Filament: plan your steps.]", said: () => void marks.push("said"), dropped: () => void marks.push("dropped") });
  // The agent's sub-agent at work, as Cursor nests its calls under its task's.
  run.take({ type: "tool", id: "a1", toolName: "task", title: "Explore the repo", kind: "think", status: "pending", rawInput: { _toolName: "task", description: "Explore the repo", prompt: "Look" } });
  run.take({ type: "tool", id: "a1", status: "in_progress" });
  run.take({ type: "tool", id: "s1", toolName: "mcp__filament__tasks", title: "tasks", kind: "other", status: "pending", parentToolCallId: "a1", rawInput: add });
  assert.equal((await tools.call("tasks", add, at)).text, "Added t1.", "the sub-agent's");
  // Its call over MCP before its word of it: the run waits to see whose it is.
  const early = tools.call("tasks", add, at);
  await new Promise((r) => setImmediate(r));
  run.take({ type: "tool", id: "s2", toolName: "mcp__filament__tasks", title: "tasks", kind: "other", status: "pending", parentToolCallId: "a1", rawInput: add });
  assert.equal((await early).text, "Added t1.", "the sub-agent's, said after its call came");
  assert.deepEqual(marks, []);
  for (const id of ["s1", "s2"]) run.take({ type: "tool", id, status: "completed", parentToolCallId: "a1" });
  run.take({ type: "tool", id: "a1", status: "completed", content: [{ type: "content", content: { type: "text", text: "All good." } }] });
  run.take({ type: "tool", id: "m1", toolName: "mcp__filament__tasks", title: "tasks", kind: "other", status: "pending", rawInput: add });
  assert.equal((await tools.call("tasks", add, at)).text, "Added t1.\n\n[Filament: plan your steps.]", "the agent's own");
  assert.deepEqual(marks, ["said"]);
  await run.close({ status: "done" });
});
