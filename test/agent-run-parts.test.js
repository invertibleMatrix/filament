// @ts-check
// HarnessV3-ACP AC1-3 on its own: a coding agent's events read into the run events the loop publishes
// (app/agent-run.js) — rounds, cards, a command's output, plans, sub-agents, snapshots, the turn's end and the
// archive's copy — and the updates those events are read from (adapters/agents/acp/updates.js). The agent events are
// shaped as claude-agent-acp 0.76.0 sends them (its dist/acp-agent.js, tools.js and native-subagents.js) and as an
// agent that names no model call does. Through the app and a fake agent, in acp-run.test.js.
// (fails before: yes — there was no translator: an agent's turn published no run event, so the page drew none of it)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { createAgentRun } from "../src/app/agent-run.js";
import { createUpdateReader } from "../src/adapters/agents/acp/updates.js";
import { fromCursorPlan, fromCursorQuestion, fromElicitation } from "../src/adapters/agents/asks.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { archivedStubs, roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const ROOT = resolve("/work/proj");
const IN_ROOT = join(ROOT, "src", "a.js");
const OUTSIDE = resolve("/elsewhere/b.js");

/**
 * A translator over a recording sink: the events it publishes, the blocks the reply holds when a round breaks it.
 * @param {Partial<Parameters<typeof createAgentRun>[0]>} [o]
 */
function make(o = {}) {
  /** @type {any[]} */
  const events = [];
  const reply = { blocks: 0 };
  let clock = 1000;
  const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => reply.blocks }, now: () => clock, ...o });
  return {
    run,
    events,
    reply,
    /** @param {number} ms */
    tick: (ms) => (clock += ms),
    /** The events as `type:round`, turn states left out. */
    seq: () => events.filter((e) => e.type !== "turn-state").map((e) => (e.round ? `${e.type}:${e.round}` : e.type)),
    /** @param {string} type */
    of: (type) => events.filter((e) => e.type === type),
  };
}
/**
 * A turn's tree that keeps what each round handed it, and answers as `answer` says.
 * @param {(r: number) => Partial<import("../src/app/turn-tree.js").Taken>} [answer]
 */
function treeOf(answer = () => ({})) {
  /** @type {{ round: number, own: string[], command: boolean, writes: any[] }[]} */
  const asked = [];
  /** @type {import("../src/app/turn-tree.js").TurnTree} */
  const tree = {
    begin: async () => {},
    before: async () => {},
    take: async (r, o = {}) => {
      asked.push({ round: r, own: o.own || [], command: !!o.command, writes: o.writes || [] });
      return { rows: [], snapshots: [], errors: [], ...answer(r) };
    },
    next: () => ({}),
    waiting: () => null,
  };
  return { tree, asked };
}
/** A round that changed the folder, as the tree answers it. @param {number} r @param {Partial<import("../src/services/memory/archive.js").RoundChange>} [row] */
const changed = (r, row = {}) => ({
  rows: [{ place: ROOT, round: r, agent: "", before: `b${r}`, after: `c${r}`, base: /** @type {const} */ ("last"), own: [], command: false, ...row }],
  snapshots: [{ place: ROOT, ref: `refs/filament/snapshots/c/1-${r}`, commit: `c${r}` }],
});
/** Claude's raw assistant message: one content block of a model call. @param {string} id @param {any[]} content @param {string | null} [parent] */
const assistant = (id, content, parent = null) => ({ type: "raw", message: { type: "assistant", parent_tool_use_id: parent, message: { id, role: "assistant", content } } });
/** Claude's estimate of what its model call has thought so far. @param {number} n */
const estimate = (n) => ({ type: "raw", message: { type: "system", subtype: "thinking_tokens", estimated_tokens: n, estimated_tokens_delta: 1 } });
/** Claude's raw tool result. @param {string} id @param {any} content @param {boolean} [isError] @param {string | null} [parent] */
const result = (id, content, isError = false, parent = null) => ({ type: "raw", message: { type: "user", parent_tool_use_id: parent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } } });
/** One of Claude's system messages. @param {string} subtype @param {Record<string, any>} [more] */
const system = (subtype, more = {}) => ({ type: "system", subtype, ...more });
/** What Claude's Agent call launched in the background said at once (claude-agent-acp 0.76.0, Claude Code 2.x). */
const LAUNCHED = "Async agent launched successfully. (This tool result is internal metadata; never quote it.)";
/**
 * Claude's sub-agent launched in the background, as the adapter sends it: the call (its own message names it), and the
 * result that came back at once, raw and as the call's end. @param {ReturnType<typeof make>} t
 */
const launchInBackground = (t) => {
  const launch = { description: "Find hello", prompt: "Find the files that say hello", subagent_type: "Explore" };
  t.run.take({ type: "text", text: "Launching.", messageId: "m1" });
  t.run.take({ type: "tool", id: "b_task", toolName: "Agent", title: "Task", kind: "think", status: "pending" });
  t.run.take(assistant("m1", [{ type: "tool_use", id: "b_task", name: "Agent", input: launch }]));
  const placeholder = [{ type: "text", text: LAUNCHED }];
  t.run.take({ type: "raw", message: { type: "user", parent_tool_use_id: null, tool_use_result: { isAsync: true, status: "async_launched", agentId: "a1" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b_task", content: placeholder }] } } });
  t.run.take({ type: "tool", id: "b_task", status: "completed", content: [{ type: "content", content: placeholder[0] }] });
};

describe("an agent's questions (AC2-4)", () => {
  const setup = fromCursorQuestion(
    { toolCallId: "c_ask", title: "Setup", questions: [{ id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }, { id: "lite", label: "SQLite" }] }] },
    { agent: "Cursor" },
  );
  const link = fromElicitation({ mode: "url", sessionId: "s1", message: "Sign in to the docs server", url: "https://example.com/login", elicitationId: "el_1" }, { agent: "Claude" });

  test("a question on the card of the agent's call it belongs to; one that belongs to none on a card of its own, which ends with the answer", () => {
    const t = make();
    t.run.take({ type: "tool", id: "c_ask", toolName: "askQuestion", title: "Setup", kind: "other", status: "pending", rawInput: { _toolName: "askQuestion", title: "Setup" } });
    t.run.take({ type: "ask", id: "q1", form: setup, waits: true });
    t.run.take({ type: "ask", id: "q1", form: setup, waits: true });
    t.run.take({ type: "ask-end", id: "q1", outcome: "answered", words: ["Which database? Postgres"] });
    t.run.take({ type: "ask", id: "q2", form: link, waits: true });
    t.tick(1500);
    t.run.take({ type: "ask-end", id: "q2", outcome: "accepted", words: ["Opened"] });
    t.run.take({ type: "ask", id: "q3", form: fromCursorPlan({ name: "Add auth" }), waits: false });
    assert.deepEqual(
      t.of("ask").map((e) => [e.id, e.round, e.kind, e.tool, e.question, e.waits, e.call ?? null]),
      [["q1", 1, "question", "askQuestion", "Setup", true, "c_ask"], ["q2", 1, "link", "ask", "Sign in to the docs server", true, null], ["q3", 1, "proposal", "ask", "Add auth", false, null]],
      "asked once, whatever the agent repeats",
    );
    assert.deepEqual(t.of("ask")[1].form, link, "the page draws the form from the event");
    assert.deepEqual(t.of("ask-end").map(({ type, ...e }) => e), [
      { round: 1, id: "q1", call: "c_ask", outcome: "answered", words: ["Which database? Postgres"] },
      { round: 1, id: "q2", outcome: "accepted", words: ["Opened"] },
    ]);
    const own = t.of("tool-start").filter((e) => e.name === "ask");
    assert.deepEqual(own.map((e) => [e.id, e.card, e.args]), [
      ["ask:q2", { kind: "ask", title: "Open a link", subject: "Sign in to the docs server" }, "Sign in to the docs server"],
      ["ask:q3", { kind: "proposal", title: "Propose a plan", subject: "Add auth" }, "Add auth"],
    ]);
    assert.deepEqual(t.of("tool-end").filter((e) => e.name === "ask").map(({ type, card, ...e }) => e), [{ round: 1, name: "ask", ok: true, ms: 1500, id: "ask:q2", chars: 6, preview: "Opened" }]);
  });

  // (fails before: no — a guard the mutation pass asked for: no question was on a sub-agent's call)
  test("a question on a sub-agent's call is on a card of its own in the round: the call is on the sub-agent's card", () => {
    const t = make();
    t.run.take({ type: "tool", id: "a1", toolName: "Task", title: "Explore the repo", kind: "think", status: "in_progress", rawInput: { description: "Explore the repo", prompt: "Look" } });
    t.run.take({ type: "tool", id: "c_ask", toolName: "askQuestion", title: "Setup", kind: "other", status: "pending", parentToolCallId: "a1", rawInput: { _toolName: "askQuestion", title: "Setup" } });
    t.run.take({ type: "ask", id: "q1", form: setup, waits: true });
    assert.deepEqual(t.of("ask").map((e) => [e.id, e.call ?? null]), [["q1", null]]);
    assert.deepEqual(t.of("tool-start").filter((e) => e.name === "ask").map((e) => e.id), ["ask:q1"]);
  });

  test("the turn's end cancels the questions still open; a paused turn's wait for the reply that continues it", async () => {
    const t = make();
    t.run.take({ type: "ask", id: "q1", form: fromCursorPlan({ name: "Add auth" }), waits: true });
    await t.run.close({ status: "stopped" });
    assert.deepEqual(t.of("ask-end").map(({ type, ...e }) => e), [{ round: 1, id: "q1", outcome: "cancelled", words: ["Cancelled"] }]);
    assert.deepEqual(t.of("tool-end").map((e) => [e.id, e.ok, e.stopped, e.preview]), [["ask:q1", false, true, "Cancelled"]]);
    const p = make();
    p.run.take({ type: "ask", id: "q1", form: link, waits: false });
    await p.run.close({ status: "paused" });
    assert.deepEqual([p.of("ask-end").length, p.of("tool-end").length], [0, 0]);
  });

  test("an answer to a question asked before the turn was continued is settled in the round running now", () => {
    const t = make();
    t.run.take({ type: "text", text: "Carrying on." });
    t.run.take({ type: "ask-end", id: "q7", outcome: "answered", words: ["Postgres"] });
    assert.deepEqual(t.of("ask-end").map(({ type, ...e }) => e), [{ round: 1, id: "q7", outcome: "answered", words: ["Postgres"] }]);
    assert.equal(t.of("tool-end").length, 0);
  });
});

describe("rounds (AC1-3)", () => {
  // (fails before: yes — HarnessV4_Tasks B12: only the agent's own writing calls made a round's snapshot, so a change
  // its team landed in the folder was in none)
  test("a round its team changed the folder in is snapshotted, as one a writing call ran in", async () => {
    const helper = { by: "sa_1", paths: [join(ROOT, "src", "w.js")] };
    const { tree, asked } = treeOf((r) => changed(r, { agent: "sa_1", own: ["src/w.js"] }));
    const t = make({ tree });
    t.run.take({ type: "text", text: "Applying its change." });
    t.run.take({ type: "tool", id: "m1", title: "worker", kind: "other", status: "pending" });
    t.run.take({ type: "tool", id: "m1", status: "completed" });
    t.run.wrote(helper);
    t.run.take({ type: "text", text: "Applied." });
    await t.run.close({ status: "done" });
    // (fails before: yes — HarnessV4_Git_Plan GWC-13: what the helper wrote reached the round's snapshot with no name)
    assert.deepEqual(asked, [{ round: 1, own: [], command: false, writes: [helper] }], "the helper's own files, by its name");
    assert.deepEqual(t.of("snapshot").map((e) => [e.round, e.agent, e.own, e.ref]), [[1, "sa_1", ["src/w.js"], "refs/filament/snapshots/c/1-1"]]);
    // No write, no snapshot: a round of reading alone.
    const quiet = treeOf();
    const q = make({ tree: quiet.tree });
    q.run.take({ type: "text", text: "Reading." });
    q.run.take({ type: "tool", id: "m2", title: "worker", kind: "other", status: "pending" });
    q.run.take({ type: "tool", id: "m2", status: "completed" });
    await q.run.close({ status: "done" });
    assert.deepEqual(quiet.asked, []);
  });

  // (fails before: yes — HarnessV4_Tasks B10: the reply never heard Claude's estimate, so the record's live thinking
  // count ignored it)
  test("Claude's estimate of its thinking reaches the reply as the turn's total, and never a sub-agent's", () => {
    /** @type {number[]} */
    const heard = [];
    const t = make({ rawMessages: true, sink: { breakBlock: () => 0, thought: (n) => heard.push(n) } });
    for (const n of [40, 900, 2000, 30, 120]) t.run.take(estimate(n));
    assert.deepEqual(heard, [40, 900, 2000, 2030, 2120], "a smaller estimate opens the next block: the finished one stays counted");
    t.run.take({ type: "text", text: "Reading.", messageId: "m1" });
    t.run.take({ type: "tool", id: "r1", toolName: "Read", title: "Read a.js", kind: "read", status: "pending" });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: IN_ROOT } }]));
    t.run.take(estimate(777));
    assert.equal(heard.length, 5, "while a call runs the estimate is its sub-agent's");
  });

  test("a round is one model call: Claude names it on every chunk, and the round's words go out whole when it closes", async () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "thought", text: "Let me ", messageId: "m1" });
    t.run.take({ type: "thought", text: "look.", messageId: "m1" });
    t.run.take({ type: "text", text: "Reading the file.", messageId: "m1" });
    t.run.take({ type: "tool", id: "t1", toolName: "Read", title: "Read File", kind: "read", status: "pending", rawInput: {} });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: IN_ROOT } }]));
    t.run.take(result("t1", "hello"));
    t.run.take({ type: "tool", id: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "```\nhello\n```" } }] });
    t.reply.blocks = 2;
    t.run.take({ type: "text", text: "It says hello.", messageId: "m2" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.seq(), ["round-start:1", "tool-start:1", "tool-end:1", "round-thinking:1", "round-text:1", "round-start:2", "round-text:2"]);
    const [r1, r2] = t.of("round-start");
    assert.equal(r1.blocksBefore, 0);
    assert.equal(r2.blocksBefore, 2, "the second round's cards land after the blocks the reply had said by then");
    assert.deepEqual(t.of("round-thinking")[0], { type: "round-thinking", round: 1, thinking: "Let me look." });
    assert.deepEqual(t.of("round-text").map((e) => [e.round, e.text, e.block]), [[1, "Reading the file.", 0], [2, "It says hello.", 1]]);
    assert.deepEqual(t.events.filter((e) => e.type === "turn-state").map((e) => e.to), ["planning", "acting", "observing", "planning", "done"]);
    // (fails before: no — a guard the mutation pass asked for: the model's copy and the agent's were never told apart)
    assert.equal(t.of("tool-end")[0].preview, "hello", "the result the model read, not the copy the agent showed");
  });

  test("an agent that names no model call starts a round where its words follow tool calls", async () => {
    const t = make();
    t.run.take({ type: "text", text: "a" });
    t.run.take({ type: "tool", id: "t1", title: "Read src/a.js", kind: "read", status: "pending" });
    t.run.take({ type: "tool", id: "t1", status: "completed" });
    t.run.take({ type: "text", text: "b" });
    t.run.take({ type: "thought", text: "hm" });
    t.run.take({ type: "text", text: "c" });
    t.run.take({ type: "tool", id: "t2", title: "git status", kind: "execute", status: "pending" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.round]), [["t1", 1], ["t2", 2]]);
    assert.deepEqual(t.of("round-text").map((e) => [e.round, e.text]), [[1, "a"], [2, "bc"]]);
    assert.deepEqual(t.of("round-thinking").map((e) => [e.round, e.thinking]), [[2, "hm"]]);
  });

  // (fails before: no — a guard the mutation pass asked for: Claude's chunks always named their model call here)
  test("an agent that names its model calls starts no round on words that name none", async () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Reading.", messageId: "m1" });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: IN_ROOT } }]));
    t.run.take({ type: "tool", id: "t1", toolName: "Read", title: "Read File", kind: "read", status: "completed" });
    t.run.take({ type: "text", text: " Then more." });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("round-start").map((e) => e.round), [1]);
    assert.deepEqual(t.of("round-text").map((e) => [e.round, e.text]), [[1, "Reading. Then more."]]);
  });

  test("Filament's own words are not the agent's: they open no round and join no round's text", async () => {
    const t = make();
    t.run.take({ type: "text", text: "_filament: a note_", own: true });
    assert.equal(t.events.length, 0);
    t.run.take({ type: "text", text: "hi" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("round-text").map((e) => e.text), ["hi"]);
  });
});

describe("tool cards (AC1-3)", () => {
  test("Claude's call is drawn once its own message names it: the whole input, the model call's round", async () => {
    const t = make({ rawMessages: true, root: ROOT });
    t.run.take({ type: "text", text: "First.", messageId: "m1" });
    // The streamed call: the title already names the file, but the round it belongs to is not known yet.
    t.run.take({ type: "tool", id: "e1", toolName: "Edit", title: `Edit ${IN_ROOT}`, kind: "edit", status: "pending", rawInput: { file_path: IN_ROOT } });
    assert.equal(t.of("tool-start").length, 0, "no card before the call's own message");
    t.run.take(assistant("m2", [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: IN_ROOT, old_string: "a", new_string: "b" } }]));
    const [start] = t.of("tool-start");
    assert.equal(start.round, 2, "a call from a new model call opens its round");
    assert.equal(start.name, "Edit");
    assert.deepEqual(start.card, { kind: "edit", title: "Edit", subject: "src/a.js" }, "the file as the snapshots name it");
    assert.equal(start.args, "src/a.js");
    await t.run.close({ status: "done" });
  });

  // (fails before: no — a guard the mutation pass asked for: the agent's own tool of Filament's tool's name claimed, a
  // claimed call's round lost, and one call claimed twice passed every test)
  test("a call over MCP finds the agent's own call of Filament's tool it came in: the oldest not yet claimed, in its model call's round — never the agent's own tool of that name", async () => {
    const t = make({ rawMessages: true, root: ROOT });
    t.run.take({ type: "text", text: "First.", messageId: "m1" });
    for (const [id, name] of [["own1", "worker"], ["l1", "mcp__filament__worker"], ["l2", "mcp__filament__worker"]]) {
      t.run.take({ type: "tool", id, toolName: name, title: name, kind: "other", status: "pending", rawInput: {} });
      t.run.take(assistant("m2", [{ type: "tool_use", id, name, input: { agent_id: "sa_1", prompt: "go on" } }]));
    }
    assert.deepEqual(await t.run.callFor("worker"), { id: "l1", round: 2 });
    assert.deepEqual(await t.run.callFor("worker"), { id: "l2", round: 2 }, "each call is claimed once");
    await t.run.close({ status: "done" });
  });

  test("a card names the call in the loop's words: the tool's own name and input, a path outside the folder whole", () => {
    const t = make({ rawMessages: true, root: ROOT });
    t.run.take(assistant("m1", [
      { type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test", description: "run the tests" } },
      { type: "tool_use", id: "r1", name: "Read", input: { file_path: OUTSIDE } },
      { type: "tool_use", id: "m1c", name: "mcp__filament__Grep", input: { pattern: "TODO" } },
    ]));
    for (const [id, name] of [["b1", "Bash"], ["r1", "Read"], ["m1c", "mcp__filament__Grep"]])
      t.run.take({ type: "tool", id, toolName: name, title: name, kind: "other", status: "pending" });
    const cards = Object.fromEntries(t.of("tool-start").map((e) => [e.id, [e.name, e.card]]));
    assert.deepEqual(cards.b1, ["Bash", cardOf("Bash", { command: "npm test" })]);
    assert.deepEqual(cards.r1, ["Read", { kind: "read", title: "Read", subject: OUTSIDE }]);
    assert.deepEqual(cards.m1c, ["Grep", cardOf("Grep", { pattern: "TODO" })], "Filament's toolset reads as the tool itself");
  });

  // (fails before: yes — the card read the whole line, its shell included, and the args were the card's subject)
  test("a command's card reads it without its shell; its args are the line it ran, as the loop's are (AC1-6)", () => {
    const t = make({ rawMessages: true, root: ROOT });
    const line = "bash -lc 'cd /work/proj && npm test'";
    t.run.take(assistant("m1", [{ type: "tool_use", id: "b1", name: "Bash", input: { command: line } }]));
    t.run.take({ type: "tool", id: "b1", toolName: "Bash", title: line, kind: "execute", status: "pending" });
    const [start] = t.of("tool-start");
    assert.deepEqual([start.card.subject, start.args], ["npm test", line]);
  });

  test("another agent's call is drawn when its title names a target or it leaves pending; its card from kind, place, title", () => {
    const t = make({ root: ROOT });
    t.run.take({ type: "tool", id: "r1", title: "Read File", kind: "read", status: "pending" });
    assert.equal(t.of("tool-start").length, 0, "a generic title waits");
    t.run.take({ type: "tool", id: "r1", title: "Read a.js", locations: [{ path: IN_ROOT }] });
    t.run.take({ type: "tool", id: "x1", title: "Thinking it over", kind: "think", status: "in_progress" });
    const cards = Object.fromEntries(t.of("tool-start").map((e) => [e.id, [e.name, e.card]]));
    assert.deepEqual(cards.r1, ["read", { kind: "read", title: "Read", subject: "src/a.js" }]);
    // (fails before: yes — a call the agent names no tool for, of a kind the vocabulary has no word for, read as the
    // kind's bare word, its title the subject)
    assert.deepEqual(cards.x1, ["think", { kind: "other", title: "Thinking it over", subject: "" }]);
  });

  // (fails before: yes — a path was cut at 90 characters on the card, so a long one inside the folder read as a clipped
  // absolute path)
  test("a file's card names it whole: a long path inside the folder reads relative, from its input or its location", () => {
    const parts = [...Array(20).fill("deep"), "file.js"];
    const deep = join(ROOT, ...parts);
    const claude = make({ rawMessages: true, root: ROOT });
    claude.run.take({ type: "tool", id: "r1", toolName: "Read", title: "Read File", kind: "read", status: "pending" });
    claude.run.take(assistant("m1", [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: deep } }]));
    const other = make({ root: ROOT });
    other.run.take({ type: "tool", id: "r2", title: `Read ${deep}`, kind: "read", status: "completed", locations: [{ path: deep }] });
    assert.deepEqual([claude.of("tool-start")[0].card.subject, other.of("tool-start")[0].card.subject], [parts.join("/"), parts.join("/")]);
  });

  // (fails before: yes — a call Claude's adapter keeps to itself was never on the run: the live turn counted fewer
  // calls than the same turn reloaded, whose archive has them)
  test("a call Claude's adapter never announces (its task tools) is drawn when its result comes, in its model call's round", async () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Planning.", messageId: "m1" });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "Read the file", description: "Read README.md" } }]));
    t.run.take({ type: "plan", entries: [{ content: "Read the file", status: "pending" }] });
    t.run.take(result("tc1", "Task #1 created successfully: Read the file"));
    t.run.take(assistant("m2", [{ type: "tool_use", id: "tu1", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }]));
    t.run.take(result("tu1", "Updated task #1 status"));
    // A sub-agent's own: a call on its card.
    t.run.take({ type: "tool", id: "s_task", toolName: "Agent", title: "Task", kind: "think", status: "pending" });
    t.run.take(assistant("m2", [{ type: "tool_use", id: "s_task", name: "Agent", input: { description: "Look", prompt: "Look around" } }]));
    t.run.take(assistant("c1", [{ type: "tool_use", id: "td1", name: "TodoWrite", input: { todos: [{ content: "Look", status: "in_progress", activeForm: "Looking" }] } }], "s_task"));
    t.run.take(result("td1", "Todos have been modified successfully", false, "s_task"));
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.round, e.card]), [
      ["tc1", 1, { kind: "todo", title: "Plan", subject: "Read the file" }],
      ["tu1", 2, { kind: "todo", title: "Plan", subject: "task 1: done" }],
      ["s_task", 2, { kind: "subagent", title: "Agent", subject: "Look" }],
    ]);
    assert.deepEqual(t.of("tool-end").slice(0, 2).map((e) => [e.id, e.ok, e.preview]), [["tc1", true, "Task #1 created successfully: Read the file"], ["tu1", true, "Updated task #1 status"]]);
    assert.deepEqual(t.of("subagent-tool-start").map((e) => [e.parent, e.id, e.card.subject]), [["s_task", "td1", "1 item"]]);
    assert.deepEqual(t.of("subagent-tool-end").map((e) => [e.id, e.ok]), [["td1", true]]);
    assert.equal(t.run.counts().tools, 3);
  });

  test("tool-end: the result the model read, clipped; a raw error fails the call; the exit code; the time", async () => {
    const t = make({ rawMessages: true, previewChars: 12 });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "g1", name: "Grep", input: { pattern: "x" } }, { type: "tool_use", id: "b1", name: "Bash", input: { command: "false" } }]));
    t.run.take({ type: "tool", id: "g1", toolName: "Grep", status: "pending" });
    t.run.take({ type: "tool", id: "b1", toolName: "Bash", status: "pending" });
    t.tick(1500);
    t.run.take(result("g1", [{ type: "text", text: "one match in a very long line" }]));
    t.run.take({ type: "tool", id: "g1", status: "completed" });
    t.run.take(result("b1", "Exit code 1", true));
    t.run.take({ type: "tool", id: "b1", status: "completed", exitCode: 1 });
    const ends = Object.fromEntries(t.of("tool-end").map((e) => [e.id, e]));
    assert.deepEqual([ends.g1.ok, ends.g1.preview, ends.g1.chars, ends.g1.ms], [true, "one match i…", 29, 1500]);
    assert.deepEqual([ends.b1.ok, ends.b1.exitCode, ends.b1.preview], [false, 1, "Exit code 1"], "the model was told it failed");
    await t.run.close({ status: "done" });
  });

  test("a command's output goes out as it runs, at most every 250 ms, a 4k tail; the rest before its end", async () => {
    const t = make();
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "pending" });
    t.run.take({ type: "tool", id: "x1", terminalOutput: { output: "line1\n" } });
    t.run.take({ type: "tool", id: "x1", terminalOutput: { output: "line2\n" } });
    assert.equal(t.of("tool-output").length, 0, "held for the pace");
    await until(() => t.of("tool-output").length === 1, "the paced output");
    assert.equal(t.of("tool-output")[0].text, "line1\nline2\n");
    t.run.take({ type: "tool", id: "x1", terminalOutput: { output: "x".repeat(9000) } });
    t.run.take({ type: "tool", id: "x1", status: "failed", exitCode: 2 });
    const outs = t.of("tool-output");
    assert.equal(outs.length, 2, "flushed before its end, not after");
    assert.equal(outs[1].text, "x".repeat(4000));
    assert.deepEqual(t.seq().slice(-2), ["tool-output:1", "tool-end:1"]);
    const [end] = t.of("tool-end");
    assert.deepEqual([end.ok, end.exitCode, end.chars], [false, 2, 9012]);
    await t.run.close({ status: "done" });
  });

  test("an update's content replaces the call's: a result said twice is said once", () => {
    const t = make();
    const said = { type: "content", content: { type: "text", text: "3 files" } };
    t.run.take({ type: "tool", id: "s1", title: "Search *.js", kind: "search", status: "pending", content: [said] });
    t.run.take({ type: "tool", id: "s1", status: "completed", content: [said, { type: "diff", path: IN_ROOT, oldText: "a", newText: "b" }] });
    assert.equal(t.of("tool-end")[0].preview, "3 files");
  });

  // (fails before: no — a guard the mutation pass asked for: no call here gave its result only as its raw output)
  test("a result the agent gives only raw is the call's: as it is, or as JSON; words it showed come first", () => {
    const t = make();
    t.run.take({ type: "tool", id: "f1", title: "Fetch https://example.com", kind: "fetch", status: "completed", rawOutput: "Example Domain" });
    t.run.take({ type: "tool", id: "f2", title: "Fetch https://example.org", kind: "fetch", status: "completed", rawOutput: { status: 200 } });
    const shown = [{ type: "content", content: { type: "text", text: "shown" } }];
    t.run.take({ type: "tool", id: "s1", title: "Search *.js", kind: "search", status: "completed", rawOutput: "raw", content: shown });
    assert.deepEqual(t.of("tool-end").map((e) => [e.id, e.preview]), [["f1", "Example Domain"], ["f2", '{"status":200}'], ["s1", "shown"]]);
  });
});

describe("plans (AC1-3)", () => {
  test("the agent's plan becomes the loop's checklist, whole, on each change; a sub-agent's is its own", () => {
    const t = make();
    const entries = [{ content: "Read  the\nfile", status: "completed", priority: "high" }, { content: "Fix it", status: "in_progress" }, { content: "Test", status: "pending" }];
    t.run.take({ type: "plan", entries });
    t.run.take({ type: "plan", entries });
    t.run.take({ type: "plan", entries: [{ content: "Elsewhere", status: "pending" }], subagent: "S1" });
    assert.deepEqual(t.of("plan"), [{ type: "plan", round: 1, items: [{ text: "Read the file", status: "done" }, { text: "Fix it", status: "doing" }, { text: "Test", status: "pending" }] }]);
    assert.equal(t.of("round-start").length, 1, "a plan before any words opens the first round");
  });
});

describe("a sub-agent's own plan (HarnessV3-ACP AC3-4)", () => {
  /** A plan's entries as an agent sends them. @param {[string, string][]} steps */
  const entries = (...steps) => steps.map(([content, status]) => ({ content, status }));
  /** A turn whose sub-agent S1 has started, with its own sub-agent S2. */
  const launched = () => {
    const t = make();
    t.run.take({ type: "text", text: "Delegating.", messageId: "m1" });
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Explore", description: "Look around" });
    t.run.take({ type: "subagent", state: "spawned", id: "S2", name: "Inner", description: "Read", subagent: "S1" });
    return t;
  };

  test("on its card, whole on each change; never the turn's; a sub-agent's own sub-agent and an unknown one draw none", () => {
    const t = launched();
    const first = entries(["Search  src", "in_progress"], ["Report", "pending"]);
    t.run.take({ type: "plan", entries: first, subagent: "S1" });
    t.run.take({ type: "plan", entries: first, subagent: "S1" });
    t.run.take({ type: "plan", entries: entries(["Search src", "completed"], ["Report", "in_progress"]), subagent: "S1" });
    t.run.take({ type: "plan", entries: entries(["Read it", "pending"]), subagent: "S2" });
    t.run.take({ type: "plan", entries: entries(["Elsewhere", "pending"]), subagent: "S9" });
    t.run.take({ type: "plan", entries: [], subagent: "S1" });
    assert.deepEqual(t.of("subagent-plan").map((e) => [e.round, e.parent, e.items.map((/** @type {any} */ i) => `${i.status}:${i.text}`)]), [
      [1, "sa:S1", ["doing:Search src", "pending:Report"]],
      [1, "sa:S1", ["done:Search src", "doing:Report"]],
    ]);
    assert.deepEqual(t.of("plan"), [], "the turn's checklist stays the main agent's");
  });

  describe("drawn", () => {
    /** @type {ReturnType<typeof stubDocument>} */
    let doc;
    before(() => {
      doc = stubDocument();
    });
    after(() => doc.restore());
    /** The sub-agent's card as the page draws the run's events. @param {any[]} events */
    const card = (events) => roundRows(alignEvents(events).byRound.get(1))[0];

    test("its card says how far it is while it runs, and opened, its plan under the prompt", () => {
      const t = launched();
      t.run.take({ type: "plan", entries: entries(["Search src", "completed"], ["Report", "in_progress"]), subagent: "S1" });
      const running = card(t.events);
      assert.equal(running.querySelector(".tool-secondary")?.textContent, "Agent Inner · 1 of 2 done", "the call it makes now, then how far");
      const labels = /** @type {any} */ (running).querySelectorAll(".sub-label").map((/** @type {any} */ l) => l.textContent);
      assert.deepEqual(labels.slice(0, 2), ["Prompt", "Plan · 1 of 2 done"]);
      assert.ok(running.querySelector(".plan-item.done") && running.querySelector(".plan-item.doing"), "each step marked");
      t.run.take({ type: "subagent", state: "completed", id: "S1" });
      const done = card(t.events);
      assert.doesNotMatch(done.querySelector(".tool-secondary")?.textContent || "", /done/, "ended, its line is its uses and time");
      assert.match(done.textContent, /Plan · 1 of 2 done/, "the plan as it last stood");
    });
  });
});

describe("sub-agents (AC1-3)", () => {
  test("Claude's own sub-agent: a card of its own, its calls on it, its last message as its report, no viewer", async () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Delegating.", messageId: "m1" });
    // The Task call itself never reaches the client as a tool call (native mode suppresses it): its session does.
    t.run.take(assistant("m1", [{ type: "tool_use", id: "toolu_task", name: "Task", input: { description: "Explore", prompt: "Look around", subagent_type: "Explore" } }]));
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Explore", description: "Look around" });
    t.run.take(assistant("c1", [{ type: "tool_use", id: "ct1", name: "Read", input: { file_path: "a.js" } }], "toolu_task"));
    t.run.take({ type: "tool", id: "ct1", toolName: "Read", title: "Read File", kind: "read", status: "pending", subagent: "S1" });
    t.run.take({ type: "text", text: "Looking.", messageId: "c1", subagent: "S1" });
    t.run.take(result("ct1", "contents", false, "toolu_task"));
    t.run.take({ type: "tool", id: "ct1", status: "completed", subagent: "S1" });
    t.run.take({ type: "text", text: "Found ", messageId: "c2", subagent: "S1" });
    t.run.take({ type: "text", text: "it.", messageId: "c2", subagent: "S1" });
    t.run.take({ type: "subagent", state: "completed", id: "S1" });
    t.run.take(result("toolu_task", "Found it."));
    await t.run.close({ status: "done" });
    // Its words too, a message at a time (E15 step 5, AG-154): "Looking.", then "Found it."
    assert.deepEqual(t.seq(), ["round-start:1", "tool-start:1", "subagent-start:1", "subagent-tool-start:1", "subagent-tool-end:1", "subagent-words:1", "subagent-words:1", "subagent-end:1", "tool-end:1", "round-text:1"]);
    const [start] = t.of("tool-start");
    assert.deepEqual([start.id, start.name, start.card], ["sa:S1", "agent", { kind: "subagent", title: "Agent", subject: "Explore" }]);
    const [sa] = t.of("subagent-start");
    assert.deepEqual(sa, { type: "subagent-start", round: 1, parent: "sa:S1", description: "Explore", prompt: "Look around" }, "no agentId: Filament's viewer cannot open an agent's own session");
    assert.equal(t.of("subagent-tool-start")[0].parent, "sa:S1");
    const [end] = t.of("subagent-end");
    assert.deepEqual([end.parent, end.status, end.ok, end.toolCalls, end.report, "agentId" in end], ["sa:S1", "done", true, 1, "Found it.", false]);
    assert.deepEqual(t.of("tool-end").map((e) => [e.id, e.ok, e.preview]), [["sa:S1", true, "Found it."]]);
    assert.deepEqual(t.of("round-text").map((e) => e.text), ["Delegating."], "the sub-agent's words are its report, not the reply's");
    assert.deepEqual(t.run.counts(), { rounds: 1, tools: 0, subagents: 1, snapshots: 0, raw: { assistant: 2, user: 2 } });
  });

  test("Claude's sub-agent launched by a new model call lands in that call's round", async () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Let me delegate.", messageId: "m1" });
    t.run.take(assistant("m2", [{ type: "tool_use", id: "toolu_task", name: "Task", input: { description: "Explore", prompt: "Look" } }]));
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Explore", description: "Look" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.round]), [["sa:S1", 2]]);
    assert.deepEqual(t.of("round-start").map((e) => e.round), [1, 2]);
  });

  // (fails before: yes — a sub-agent launched in the background ended its card when its call came back, the launch's
  // placeholder its report, and the calls it made after that hung off an ended card)
  test("Claude's sub-agent launched in the background: its card runs on with its calls, and its task's end ends it", async () => {
    const t = make({ rawMessages: true });
    launchInBackground(t);
    t.run.take({ type: "text", text: "It runs in the background.", messageId: "m2" });
    assert.equal(t.of("tool-end").length, 0, "the card runs on past its call");
    t.run.take({ type: "tool", id: "b_g1", toolName: "Grep", title: "grep", kind: "search", status: "pending", parentToolCallId: "b_task" });
    t.run.take(assistant("c1", [{ type: "tool_use", id: "b_g1", name: "Grep", input: { pattern: "hello" } }], "b_task"));
    t.run.take(result("b_g1", "README.md", false, "b_task"));
    t.run.take({ type: "tool", id: "b_g1", status: "completed", parentToolCallId: "b_task" });
    t.run.take(assistant("c2", [{ type: "text", text: "README.md says hello." }], "b_task"));
    t.tick(2000);
    t.run.take({ type: "raw", message: system("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "completed", summary: "README.md says hello." }) });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.events.filter((e) => /^(tool|subagent)-/.test(e.type)).map((e) => [e.type, e.id ?? e.parent]), [
      ["tool-start", "b_task"],
      ["subagent-start", "b_task"],
      ["subagent-tool-start", "b_g1"],
      ["subagent-tool-end", "b_g1"],
      ["subagent-words", "b_task"],
      ["subagent-end", "b_task"],
      ["tool-end", "b_task"],
    ]);
    const [end] = t.of("subagent-end");
    assert.deepEqual([end.status, end.report, end.toolCalls], ["done", "README.md says hello.", 1]);
    const [card] = t.of("tool-end");
    assert.deepEqual([card.ok, card.preview, card.ms], [true, "README.md says hello.", 2000]);
    assert.ok(!JSON.stringify(t.events).includes("internal metadata"), "the launch's placeholder is never drawn");
  });

  // (fails before: yes — there was no reading of a background task's end)
  test("a background sub-agent's task stopped: its card stops, and what it last said is its report", () => {
    const t = make({ rawMessages: true });
    launchInBackground(t);
    t.run.take(assistant("c1", [{ type: "text", text: "Halfway there." }], "b_task"));
    t.run.take({ type: "raw", message: system("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "stopped", summary: "" }) });
    const [end] = t.of("subagent-end");
    assert.deepEqual([end.status, end.ok, end.report], ["stopped", false, "Halfway there."]);
    const [card] = t.of("tool-end");
    assert.deepEqual([card.id, card.ok, card.stopped, card.preview], ["b_task", false, true, "Halfway there."]);
  });

  // (fails before: no — a guard the mutation pass asked for: a task here only ever ended completed or stopped, its
  // summary the sub-agent's last words, so an end in another word read as done and a summary of its own went unsaid)
  test("a background task's end in a word the translator does not know reads failed; a summary of its own is the report", () => {
    const t = make({ rawMessages: true });
    launchInBackground(t);
    t.run.take(assistant("c1", [{ type: "text", text: "Halfway there." }], "b_task"));
    t.run.take({ type: "raw", message: system("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "lost", summary: "Its session went away." }) });
    const [end] = t.of("subagent-end");
    assert.deepEqual([end.status, end.ok, end.report], ["failed", false, "Its session went away."]);
  });

  test("a sub-agent's own sub-agent is a call on its card, and so are its calls", () => {
    const t = make();
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Outer" });
    t.run.take({ type: "subagent", state: "spawned", id: "S2", name: "Inner", subagent: "S1" });
    t.run.take({ type: "tool", id: "c2", title: "Search TODO in src/", kind: "search", status: "completed", subagent: "S2" });
    t.run.take({ type: "subagent", state: "completed", id: "S2", subagent: "S1" });
    assert.deepEqual(t.events.filter((e) => e.type.startsWith("subagent-tool")).map((e) => [e.type, e.parent, e.id]), [
      ["subagent-tool-start", "sa:S1", "sa:S2"],
      ["subagent-tool-start", "sa:S1", "c2"],
      ["subagent-tool-end", "sa:S1", "c2"],
      ["subagent-tool-end", "sa:S1", "sa:S2"],
    ]);
    assert.equal(t.of("subagent-start").length, 1, "one card: the outer sub-agent's");
  });

  test("a sub-agent another agent nests its calls under: the call is its card, its result the report", () => {
    const t = make();
    t.run.take({ type: "tool", id: "a1", toolName: "Task", title: "Explore the repo", kind: "think", status: "pending", rawInput: { description: "Explore the repo", prompt: "Look" } });
    t.run.take({ type: "tool", id: "a1", status: "in_progress" });
    t.run.take({ type: "tool", id: "c1", title: "Read src/a.js", kind: "read", status: "completed", parentToolCallId: "a1" });
    t.run.take({ type: "tool", id: "a1", status: "completed", content: [{ type: "content", content: { type: "text", text: "All good." } }] });
    assert.deepEqual(t.seq(), ["round-start:1", "tool-start:1", "subagent-start:1", "subagent-tool-start:1", "subagent-tool-end:1", "subagent-end:1", "tool-end:1"]);
    assert.deepEqual(t.of("subagent-start")[0], { type: "subagent-start", round: 1, parent: "a1", description: "Explore the repo", prompt: "Look" });
    assert.deepEqual([t.of("subagent-end")[0].report, t.of("subagent-end")[0].toolCalls], ["All good.", 1]);
  });

  // (fails before: no — a guard the mutation pass asked for: no sub-agent's call named a target while pending)
  test("a sub-agent's call is drawn once it leaves pending, its prompt whole, though its title could be drawn before", () => {
    const t = make();
    t.run.take({ type: "tool", id: "a2", toolName: "Task", title: "Task: explore the repo", kind: "think", status: "pending" });
    assert.deepEqual(t.of("subagent-start"), [], "not while pending");
    t.run.take({ type: "tool", id: "a2", status: "in_progress", rawInput: { description: "explore the repo", prompt: "Look at src" } });
    assert.deepEqual(t.of("subagent-start"), [{ type: "subagent-start", round: 1, parent: "a2", description: "explore the repo", prompt: "Look at src" }]);
  });

  // (fails before: yes — Cursor's task was drawn twice: the sub-agent's card, and an `other` card for the call itself)
  test("a sub-agent that is a call (Cursor's task) is one card, the call's; the call ends it; the archive's agent call", async () => {
    const t = make();
    t.run.take({ type: "subagent", state: "spawned", id: "c5", call: true, name: "explorer", description: "explore the repo" });
    t.run.take({ type: "tool", id: "c5", title: "Agent: explore the repo", kind: "other", status: "in_progress" });
    t.run.take({ type: "tool", id: "c6", title: "Read src/index.js", kind: "read", status: "in_progress", parentToolCallId: "c5" });
    t.run.take({ type: "tool", id: "c6", status: "completed", parentToolCallId: "c5" });
    t.run.take({ type: "text", text: "Found it.", subagent: "c5" });
    t.run.take({ type: "subagent", state: "completed", id: "c5" });
    t.run.take({ type: "tool", id: "c5", status: "completed" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.events.filter((e) => /^(tool|subagent)-/.test(e.type)).map((e) => [e.type, e.parent ?? null, e.id ?? null]), [
      ["tool-start", null, "c5"],
      ["subagent-start", "c5", null],
      ["subagent-tool-start", "c5", "c6"],
      ["subagent-tool-end", "c5", "c6"],
      ["subagent-words", "c5", null],
      ["subagent-end", "c5", null],
      ["tool-end", null, "c5"],
    ]);
    assert.deepEqual([t.of("tool-end")[0].name, t.of("tool-end")[0].preview, t.run.counts().tools, t.run.counts().subagents], ["agent", "Found it.", 1, 1]);
    assert.deepEqual(t.run.archive().work, [
      { role: "assistant", content: [{ type: "tool_use", id: "c5", name: "agent", input: { description: "explorer", prompt: "explore the repo" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c5", content: "Found it." }] },
    ]);
  });
});

describe("snapshots (AC1-3)", () => {
  test("a round in which a call that may write ran is snapshotted when the next begins, the last before the end", async () => {
    /** @type {string[]} */
    const notes = [];
    // (fails before: no — a guard the mutation pass asked for: every tree asked for here had changed)
    // Round 3's did not: the tree answers no row and no snapshot.
    const { tree, asked } = treeOf((r) => (r === 3 ? {} : changed(r)));
    const t = make({ root: ROOT, note: (n) => notes.push(n), tree });
    t.run.take({ type: "text", text: "a" });
    t.run.take({ type: "tool", id: "e1", title: "Edit src/a.js", kind: "edit", status: "completed", locations: [{ path: IN_ROOT }] });
    t.run.take({ type: "tool", id: "e2", title: "Write b.js", kind: "edit", status: "completed", file: "src/b.js" });
    t.run.take({ type: "text", text: "b" });
    t.run.take({ type: "tool", id: "r1", title: "Read src/a.js", kind: "read", status: "completed", locations: [{ path: IN_ROOT }] });
    t.run.take({ type: "text", text: "c" });
    t.run.take({ type: "tool", id: "x1", title: "npm run build", kind: "execute", status: "failed" });
    t.run.take({ type: "text", text: "d" });
    t.run.take({ type: "tool", id: "x2", title: "npm test", kind: "execute", status: "completed" });
    await t.run.close({ status: "done" });
    // (fails before: yes — HarnessV4_Git_Plan GWC-9: a round's record named no file: the coding agent's own were the
    // whole folder's diff, a command's with them)
    assert.deepEqual(
      asked.map((a) => [a.round, a.own, a.command]),
      [
        [1, [IN_ROOT, join(ROOT, "src", "b.js")], false],
        [3, [], true],
        [4, [], true],
      ],
      "not after the reading round; a failed command may have written; a call's own files, where it names them",
    );
    assert.deepEqual(t.of("snapshot").map((e) => [e.round, e.place, e.ref, e.after]), [[1, ROOT, "refs/filament/snapshots/c/1-1", "c1"], [4, ROOT, "refs/filament/snapshots/c/1-4", "c4"]], "none for a round that changed nothing");
    assert.equal(t.run.counts().snapshots, 2);
    assert.equal(notes.length, 2);
    assert.ok(t.seq().indexOf("snapshot:4") < t.seq().length, "the last one is published before close resolves");
  });

  // (fails before: no — a guard the mutation pass asked for: no edit kept from running was in a round)
  test("an edit its permission kept from running wrote nothing: its round takes no snapshot", async () => {
    const { tree, asked } = treeOf(changed);
    const t = make({ tree });
    t.run.take({ type: "text", text: "a" });
    t.run.take({ type: "tool", id: "e1", title: "Edit src/a.js", kind: "edit", status: "pending" });
    t.run.take({ type: "tool", id: "e1", status: "failed", notRun: "declined" });
    await t.run.close({ status: "done" });
    assert.deepEqual(asked, []);
  });

  test("a place that takes no snapshot is said once", async () => {
    /** @type {string[]} */
    const notes = [];
    const { tree, asked } = treeOf(() => ({ errors: [{ place: ROOT, error: "not a git repository" }] }));
    const t = make({ note: (n) => notes.push(n), tree });
    for (const id of ["e1", "e2"]) {
      t.run.take({ type: "text", text: id });
      t.run.take({ type: "tool", id, title: `Edit src/${id}.js`, kind: "edit", status: "completed" });
    }
    await t.run.close({ status: "done" });
    assert.equal(asked.length, 2, "the tree itself tries a broken place no more");
    assert.deepEqual(notes, [`acp: no working-tree snapshot of ${ROOT} (not a git repository)`]);
    assert.equal(t.of("snapshot").length, 0);
  });

  // (fails before: yes — the review of 10-31: a place said once a turn was said no more when its snapshot then ran past
  // its time, which leaves it for the rest of the turn)
  test("a place's snapshot that then runs past its time is said apart, once too", async () => {
    /** @type {string[]} */
    const notes = [];
    const said = [{ error: "short read" }, { error: "short read" }, { error: "timed out", timedOut: true }, { error: "timed out", timedOut: true }];
    const { tree } = treeOf((r) => ({ errors: [{ place: ROOT, ...said[r - 1] }] }));
    const t = make({ note: (n) => notes.push(n), tree });
    for (const id of ["e1", "e2", "e3", "e4"]) {
      t.run.take({ type: "text", text: id });
      t.run.take({ type: "tool", id, title: `Edit src/${id}.js`, kind: "edit", status: "completed" });
    }
    await t.run.close({ status: "done" });
    assert.deepEqual(notes, [`acp: no working-tree snapshot of ${ROOT} (short read)`, `acp: no working-tree snapshot of ${ROOT} (timed out)`]);
  });
});

describe("the turn's end (AC1-3)", () => {
  test("a stop: what runs is cut, not failed; the sub-agents stop with it; the state", async () => {
    const t = make();
    t.run.take({ type: "text", text: "a" });
    t.run.take({ type: "tool", id: "r1", title: "Read src/a.js", kind: "read", status: "completed" });
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "pending" });
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Helper" });
    await t.run.close({ status: "stopped" });
    const ends = Object.fromEntries(t.of("tool-end").map((e) => [e.id, e]));
    assert.deepEqual([ends.x1.ok, ends.x1.stopped], [false, true]);
    assert.deepEqual([t.of("subagent-end")[0].status, ends["sa:S1"].stopped], ["stopped", true]);
    assert.equal(t.events.at(-1).to, "stopped");
  });

  test("a paused turn's calls run on, for the reply that continues it; a done turn's end as the agent left them", async () => {
    const paused = make();
    paused.run.take({ type: "tool", id: "e1", title: "Edit src/a.js", kind: "edit", status: "in_progress" });
    await paused.run.close({ status: "paused" });
    assert.deepEqual([paused.of("tool-end").length, paused.events.at(-1).to], [0, "paused"]);
    const done = make();
    done.run.take({ type: "tool", id: "e1", title: "Edit src/a.js", kind: "edit", status: "in_progress" });
    done.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Helper" });
    await done.run.close({ status: "done" });
    const ends = Object.fromEntries(done.of("tool-end").map((e) => [e.id, e]));
    assert.deepEqual([ends.e1.ok, "stopped" in ends.e1, done.of("subagent-end")[0].status], [true, false, "done"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no done turn here left a call running with output of its
  // own)
  test("a done turn's call the agent left running is answered by what it showed, not cut", async () => {
    const t = make();
    t.run.take({ type: "tool", id: "x1", title: "npm run dev", kind: "execute", status: "in_progress", terminalOutput: { output: "listening on 3000\n" } });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.run.archive().work[1].content, [{ type: "tool_result", tool_use_id: "x1", content: "listening on 3000\n" }]);
  });

  test("the turn ends once: a second end is the first, and what the agent sends after it is no one's to see", async () => {
    const t = make();
    t.run.take({ type: "text", text: "a" });
    const first = t.run.close({ status: "stopped", forced: true });
    assert.equal(t.run.close({ status: "done" }), first);
    await first;
    const seen = t.events.length;
    t.run.take({ type: "text", text: "late", messageId: "m9" });
    t.run.take({ type: "tool", id: "x9", title: "npm test", kind: "execute", status: "in_progress" });
    assert.deepEqual([t.events.length, t.events.at(-1).to], [seen, "stopped"]);
  });

  test("a failed turn fails what was still running", async () => {
    const t = make();
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "pending" });
    await t.run.close({ status: "failed" });
    const [end] = t.of("tool-end");
    assert.deepEqual([end.ok, "stopped" in end], [false, false]);
  });
});

describe("the updates the run is read from (AC1-2)", () => {
  // (fails before: no — a guard the mutation pass asked for: the fake agent named each call in both of Claude's places,
  // gave no result only raw, and the harness has no task list a sub-agent's plan could reach)
  test("a call's own name and raw output go on; a sub-agent's plan is marked its own and never the client's", () => {
    /** @type {any[]} */
    const events = [];
    /** @type {any[]} */
    const bridged = [];
    const turn = { bridgePlan: (/** @type {any} */ entries) => (bridged.push(entries), true) };
    const read = createUpdateReader({ out: { tools: [] }, conv: {}, turn, onEvent: (/** @type {any} */ e) => events.push(e), notes: [] });
    const meta = { claudeCode: { toolName: "WebFetch" } };
    read({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Fetch https://example.com", kind: "fetch", status: "completed", rawOutput: { status: 200 }, _meta: meta });
    const entries = [{ content: "Search src", priority: "high", status: "completed" }];
    read({ sessionUpdate: "plan", entries }, { subagent: "task_1" });
    read({ sessionUpdate: "plan", entries });
    assert.deepEqual([events[0].toolName, events[0].rawOutput], ["WebFetch", { status: 200 }]);
    assert.deepEqual(events.slice(1).map((e) => [e.subagent ?? null, e.bridged ?? null]), [["task_1", null], [null, true]]);
    assert.equal(bridged.length, 1, "the client's task list is the turn's own");
  });

  // (fails before: yes — Claude's adapter names no sub-agent on a plan, so a sub-agent's own to-do list became the
  // turn's plan, and the client's task list)
  test("a plan Claude sends right after a sub-agent's message is the sub-agent's own", () => {
    /** @type {any[]} */
    const events = [];
    /** @type {any[]} */
    const bridged = [];
    const turn = { bridgePlan: (/** @type {any} */ entries) => (bridged.push(entries), true) };
    const read = createUpdateReader({ out: { tools: [] }, conv: {}, turn, onEvent: (/** @type {any} */ e) => events.push(e), notes: [] });
    const entries = [{ content: "Search src", status: "pending" }];
    read.raw({ type: "assistant", parent_tool_use_id: "toolu_task", message: { id: "c1", role: "assistant", content: [{ type: "tool_use", id: "td1", name: "TodoWrite", input: { todos: [] } }] } });
    read({ sessionUpdate: "plan", entries });
    read.raw({ type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tc1", content: "Task #1 created" }] } });
    read({ sessionUpdate: "plan", entries });
    assert.deepEqual(events.filter((e) => e.type === "plan").map((e) => [e.subagent ?? null, e.bridged ?? null]), [["toolu_task", null], [null, true]]);
    assert.equal(bridged.length, 1, "the client's task list is the turn's own");
  });

  // (fails before: yes — the turn ended with its prompt, so Claude's answer to a background task that ended during the
  // turn's last model call came after it, to no one)
  test("the rest of the turn: Claude's answer to a task that ended after the turn's last model call began", async (tt) => {
    tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const reader = () => createUpdateReader({ out: { tools: [] }, conv: {}, turn: {}, onEvent: () => {}, notes: [] });
    /** Whether a promise has settled yet: its value, or "pending". @param {Promise<string>} p */
    const now = (p) => Promise.race([p, Promise.resolve("pending")]);
    const ended = system("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "completed", summary: "done" });
    const requesting = system("status", { status: "requesting" });
    const turnResult = { type: "result", subtype: "success", origin: { kind: "human" } };
    const answer = { type: "result", subtype: "success", origin: { kind: "task-notification" } };
    // Read in the turn: a model call after the task's end reads it, and nothing is owed.
    const read1 = reader();
    for (const m of [requesting, ended, requesting, turnResult]) read1.raw(m);
    assert.equal(await read1.followup(), "answered");
    // A housekeeping task is no one's to answer.
    const read2 = reader();
    for (const m of [requesting, { ...ended, skip_transcript: true }, { ...ended, ambient: true }, turnResult]) read2.raw(m);
    assert.equal(await read2.followup(), "answered");
    // Ended during the turn's last call: the turn waits for the cycle that answers it, past the turn's idle and while
    // Claude works.
    const read3 = reader();
    for (const m of [system("session_state_changed", { state: "running" }), requesting, ended, turnResult, system("session_state_changed", { state: "idle" })]) read3.raw(m);
    const p3 = read3.followup();
    tt.mock.timers.tick(2000);
    read3.raw(system("session_state_changed", { state: "running" }));
    read3.raw(requesting);
    tt.mock.timers.tick(600_000);
    assert.equal(await now(p3), "pending", "while Claude works, the turn's silence watchdog bounds it");
    read3.raw(answer);
    assert.equal(await p3, "answered");
    // A task that ended during the answer's own last call is answered by the next cycle.
    const read4 = reader();
    for (const m of [requesting, ended, turnResult]) read4.raw(m);
    const p4 = read4.followup();
    for (const m of [system("session_state_changed", { state: "running" }), requesting, ended, answer]) read4.raw(m);
    assert.equal(await now(p4), "pending");
    read4.raw(requesting);
    read4.raw(answer);
    assert.equal(await p4, "answered");
    // Idle (or never saying) without the answer: it is not coming.
    const read5 = reader();
    for (const m of [requesting, ended, turnResult]) read5.raw(m);
    const p5 = read5.followup();
    tt.mock.timers.tick(2999);
    assert.equal(await now(p5), "pending");
    tt.mock.timers.tick(1);
    assert.equal(await p5, "idle");
    // A stop ends the wait.
    const read6 = reader();
    for (const m of [requesting, ended, turnResult]) read6.raw(m);
    const stop = new AbortController();
    const p6 = read6.followup(stop.signal);
    stop.abort();
    assert.equal(await p6, "stopped");
    assert.equal(await read6.followup(stop.signal), "stopped", "stopped before it began");
    // (fails before: no — a guard the mutation pass asked for: Claude never asked the person anything here while the
    // turn waited, so a wait that idled while it asked went unseen)
    const read7 = reader();
    for (const m of [requesting, ended, turnResult]) read7.raw(m);
    const p7 = read7.followup();
    for (const m of [system("session_state_changed", { state: "running" }), requesting, system("session_state_changed", { state: "requires_action" })]) read7.raw(m);
    tt.mock.timers.tick(600_000);
    assert.equal(await now(p7), "pending", "while Claude asks, the turn's silence watchdog bounds it");
    read7.raw(answer);
    assert.equal(await p7, "answered");
    // (fails before: yes — the review of D3's follow-up: words queued at the agent after the turn's answer ran as a cycle
    // of their own whose model call read a task's end, and their result names their origin, not the task's — the turn
    // waited out Claude's idle for an answer that had come, and said it never did)
    const read8 = reader();
    for (const m of [requesting, turnResult, ended, requesting, turnResult]) read8.raw(m);
    assert.equal(await now(read8.followup()), "answered");
  });

  // (fails before: no — a guard the mutation pass asked for: the fake's cycle always said the context's size and went
  // idle right after its result)
  test("a turn of the agent's own ends after its cycle's result: with the context's size, Claude idle, or a moment later", async (tt) => {
    tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const own = () => createUpdateReader({ out: { tools: [] }, conv: {}, turn: {}, onEvent: () => {}, notes: [], own: true, state: "running" });
    /** Whether a promise has settled yet: its value, or "pending". @param {Promise<string>} p */
    const now = (p) => Promise.race([p, Promise.resolve("pending")]);
    const result = { type: "result", subtype: "success", origin: { kind: "task-notification" } };
    const sized = own();
    const p1 = sized.ownEnd();
    sized.raw(result);
    assert.equal(await now(p1), "pending", "what the adapter says after the result is still to come");
    sized({ sessionUpdate: "usage_update", used: 4001, size: 200000 });
    assert.equal(await now(p1), "answered");
    const idle = own();
    const p2 = idle.ownEnd();
    idle.raw(result);
    idle.raw(system("session_state_changed", { state: "idle" }));
    assert.equal(await now(p2), "answered");
    const quiet = own();
    const p3 = quiet.ownEnd();
    quiet.raw(result);
    tt.mock.timers.tick(1999);
    assert.equal(await now(p3), "pending");
    tt.mock.timers.tick(1);
    assert.equal(await now(p3), "answered");
  });
});

describe("the archive's copy (AC1-8's source)", () => {
  test("Claude's: the model's own messages, a model call's blocks as one, results together, thinking left out", () => {
    const t = make({ rawMessages: true });
    t.run.take(assistant("m1", [{ type: "thinking", thinking: "hm", signature: "s" }]));
    t.run.take(assistant("m1", [{ type: "text", text: "Reading." }]));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "b" } }]));
    t.run.take(result("t1", "A"));
    t.run.take(result("t2", "B"));
    t.run.take(assistant("c1", [{ type: "text", text: "a sub-agent's" }], "t9"));
    t.run.take(assistant("m2", [{ type: "text", text: "Done." }]));
    t.run.take({ type: "raw", message: { type: "result", subtype: "success" } });
    const { work, final } = t.run.archive();
    assert.deepEqual(work, [
      { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }, { type: "tool_use", id: "t2", name: "Read", input: { file_path: "b" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "A" }, { type: "tool_result", tool_use_id: "t2", content: "B" }] },
    ]);
    assert.deepEqual(final, [{ type: "text", text: "Done." }]);
    assert.deepEqual(t.run.counts().raw, { assistant: 6, user: 2, "result/success": 1 });
  });

  // (fails before: yes — a model call's block after a result began a message of its own, so the archive split one model
  // call in two around its first call's result)
  test("Claude's: a model call is one message though a call's result came between its blocks", () => {
    const t = make({ rawMessages: true });
    t.run.take(assistant("m1", [{ type: "text", text: "Reading both." }]));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]));
    t.run.take(result("t1", "A"));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "b" } }]));
    t.run.take(result("t2", "B"));
    t.run.take(assistant("m2", [{ type: "text", text: "Both read." }]));
    const { work, final } = t.run.archive();
    assert.deepEqual(work, [
      { role: "assistant", content: [{ type: "text", text: "Reading both." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }, { type: "tool_use", id: "t2", name: "Read", input: { file_path: "b" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "A" }, { type: "tool_result", tool_use_id: "t2", content: "B" }] },
    ]);
    assert.deepEqual(final, [{ type: "text", text: "Both read." }]);
  });

  // (fails before: yes — HarnessV4_Tasks B2: a call whose agent named no input was kept with none, so nothing said
  // what it ran)
  test("another agent's: rebuilt from its rounds, each call answered by what it showed, and kept by the target its card showed where the agent named no input", async () => {
    const t = make();
    t.run.take({ type: "text", text: "Checking." });
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" } });
    t.run.take({ type: "tool", id: "x1", terminalOutput: { output: "ok" }, status: "completed" });
    t.run.take({ type: "tool", id: "x2", title: "npm run lint", kind: "execute", status: "failed" });
    t.run.take({ type: "text", text: "All good." });
    await t.run.close({ status: "done" });
    const { work, final } = t.run.archive();
    assert.deepEqual(work, [
      { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "x1", name: "bash", input: { command: "npm test" } }, { type: "tool_use", id: "x2", name: "bash", input: { input: "npm run lint" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x1", content: "ok" }, { type: "tool_result", tool_use_id: "x2", content: "", is_error: true }] },
    ]);
    assert.deepEqual(final, [{ type: "text", text: "All good." }]);
  });

  test("every call is answered: a cut one in the loop's words, whatever the agent said of its interruption", async () => {
    const t = make({ rawMessages: true });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } }]));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t3", name: "Task", input: { prompt: "look" } }]));
    t.run.take({ type: "tool", id: "t1", toolName: "Read", kind: "read", status: "completed", content: [{ type: "content", content: { type: "text", text: "A" } }] });
    t.run.take({ type: "tool", id: "t2", toolName: "Bash", kind: "execute", status: "in_progress" });
    t.run.take(result("t2", "[Request interrupted by user for tool use]", true));
    await t.run.close({ status: "stopped" });
    const { work, final } = t.run.archive();
    assert.deepEqual(work[1], { role: "user", content: [
      { type: "tool_result", tool_use_id: "t1", content: "A" },
      { type: "tool_result", tool_use_id: "t2", content: "Stopped: the developer stopped the turn while this call ran; its result was not kept.", is_error: true },
      { type: "tool_result", tool_use_id: "t3", content: "Stopped: the developer stopped the turn while this call ran; its result was not kept.", is_error: true },
    ] });
    assert.deepEqual([work.length, final], [2, []]);
  });

  // (fails before: no — a guard the mutation pass asked for: a Force stop's cut was only ever read as a stop)
  test("a call a Force stop cut is answered in the force's words", async () => {
    const t = make({ rawMessages: true });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }]));
    t.run.take({ type: "tool", id: "t1", toolName: "Bash", kind: "execute", status: "in_progress" });
    await t.run.close({ status: "stopped", forced: true });
    const words = "Stopped: the developer force-stopped the turn while this call ran; its result was not kept.";
    assert.deepEqual(t.run.archive().work[1].content, [{ type: "tool_result", tool_use_id: "t1", content: words, is_error: true }]);
  });

  test("a cut call reads as Stopped after a reload, as the loop's do; a failed turn's as failed", async () => {
    // (fails before: yes — the page read a stop's and a hang-up's words as a failure)
    /** @param {"stopped" | "aborted" | "failed"} status @param {boolean} [forced] */
    const reloaded = async (status, forced = false) => {
      const t = make({ rawMessages: true });
      t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }]));
      t.run.take({ type: "tool", id: "t1", toolName: "Bash", kind: "execute", status: "in_progress" });
      await t.run.close({ status, forced });
      const r = t.run.archive().work[1].content[0];
      return archivedStubs([{ name: "Bash", isError: r.is_error === true, result: r.content }])[0].state;
    };
    assert.deepEqual(
      [await reloaded("stopped"), await reloaded("stopped", true), await reloaded("aborted"), await reloaded("failed")],
      ["stopped", "stopped", "stopped", "failed"],
    );
  });
});

describe("the person's words the agent took into its running turn (HarnessV3-ACP AC3-1)", () => {
  /** A message's words, its text blocks joined, or its calls and results by id. @param {any} m */
  const said = (m) =>
    `${m.role}:${m.content.map((/** @type {any} */ b) => (b.type === "text" ? b.text : b.type === "tool_use" ? `[${b.id}]` : b.type === "tool_result" ? `=${b.tool_use_id}` : b.type)).join("|")}`;

  test("an agent that names no model call: the message it was saying stays in its round; its first new output answers, in one of its own", async () => {
    const t = make();
    t.run.take({ type: "text", text: "Working ", itemId: "i1" });
    t.run.steered("use the notes file");
    t.run.take({ type: "text", text: "on it.", itemId: "i1" });
    t.run.take({ type: "text", text: "Using the notes file.", itemId: "i2" });
    t.run.steered("then a test");
    t.run.take({ type: "tool", id: "c1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" } });
    t.run.take({ type: "tool", id: "c1", terminalOutput: { output: "ok" }, status: "completed" });
    t.run.take({ type: "text", text: "Tests pass.", itemId: "i3" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("round-text").map((e) => [e.round, e.text]), [[1, "Working on it."], [2, "Using the notes file."], [4, "Tests pass."]]);
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.round]), [["c1", 3]], "a call it starts after them answers them");
    const { work, final } = t.run.archive();
    assert.deepEqual(work.map(said), ["assistant:Working on it.", "user:use the notes file", "assistant:Using the notes file.", "user:then a test", "assistant:[c1]", "user:=c1"]);
    assert.deepEqual(final, [{ type: "text", text: "Tests pass." }]);
  });

  test("taken before the agent said anything, they come first; after a round's calls, with their results", async () => {
    const t = make();
    t.run.steered("short answers please");
    t.run.take({ type: "text", text: "Checking." });
    t.run.take({ type: "tool", id: "c1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" } });
    t.run.take({ type: "tool", id: "c1", terminalOutput: { output: "ok" }, status: "completed" });
    t.run.steered("and lint");
    t.run.steered("then stop");
    t.run.take({ type: "text", text: "Done." });
    await t.run.close({ status: "done" });
    const { work, final } = t.run.archive();
    assert.deepEqual(work.map(said), ["user:short answers please", "assistant:Checking.|[c1]", "user:=c1|and lint|then stop"]);
    assert.deepEqual(final, [{ type: "text", text: "Done." }]);
  });

  test("Claude's own conversation: after the messages it had sent when it took them — with the results its calls were waiting on", async () => {
    const t = make({ rawMessages: true });
    t.run.take(assistant("m1", [{ type: "text", text: "Reading." }]));
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]));
    t.run.steered("the b file too");
    t.run.take(result("t1", "A"));
    t.run.take(assistant("m2", [{ type: "text", text: "Reading b." }]));
    t.run.steered("and stop there");
    t.run.take(assistant("m3", [{ type: "text", text: "Stopping." }]));
    const { work, final } = t.run.archive();
    assert.deepEqual(work.map(said), ["assistant:Reading.|[t1]", "user:=t1|the b file too", "assistant:Reading b.", "user:and stop there"]);
    assert.deepEqual(final, [{ type: "text", text: "Stopping." }]);
  });

  // (fails before: no — a guard the mutation pass asked for: no agent that names neither its calls nor its items
  // started a call after the person's words)
  test("an agent that names neither its calls nor its items: a call it starts after them answers them, in a round of its own", async () => {
    const t = make();
    t.run.take({ type: "text", text: "Looking." });
    t.run.steered("check b too");
    t.run.take({ type: "tool", id: "c1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" } });
    t.run.take({ type: "tool", id: "c1", terminalOutput: { output: "ok" }, status: "completed" });
    await t.run.close({ status: "done" });
    assert.deepEqual(t.of("tool-start").map((e) => [e.id, e.round]), [["c1", 2]]);
    assert.deepEqual(t.run.archive().work.map(said), ["assistant:Looking.", "user:check b too", "assistant:[c1]", "user:=c1"]);
  });

  // (fails before: no — a guard the mutation pass asked for: no two messages were taken at one place in Claude's own
  // conversation)
  test("Claude's own conversation: two messages taken at one place both stay, in the order sent", async () => {
    const t = make({ rawMessages: true });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]));
    t.run.steered("the b file too");
    t.run.steered("and c");
    t.run.take(result("t1", "A"));
    t.run.take(assistant("m2", [{ type: "text", text: "Reading b and c." }]));
    const { work, final } = t.run.archive();
    assert.deepEqual(work.map(said), ["assistant:[t1]", "user:=t1|the b file too|and c"]);
    assert.deepEqual(final, [{ type: "text", text: "Reading b and c." }]);
  });

  test("taken once the turn's end has begun: nobody's", async () => {
    const t = make();
    t.run.take({ type: "text", text: "Done." });
    const closing = t.run.close({ status: "done" });
    t.run.steered("one more thing");
    await closing;
    assert.deepEqual(t.run.archive(), { work: [], final: [{ type: "text", text: "Done." }], compacted: null, left: null });
  });
});

describe("a coding agent's task graph (HarnessV3-ACP AC4-5)", () => {
  test("a tasks call's graph goes on the run in the round it was made in, one opened when none is", () => {
    const t = make();
    t.run.take({ type: "graph", graph: { goal: "ship", tasks: [] } });
    const [g] = t.of("graph");
    assert.deepEqual([g.graph, g.round, t.of("round-start").length], [{ goal: "ship", tasks: [] }, t.of("round-start")[0].round, 1]);
  });
});

// (fails before: yes — HarnessV4_Tasks U4 left coding agents out: their words' block ended only where their next model
// call began, so the page's caret blinked on the words for as long as the call they went on to ran; seen live, 10-11)
describe("the reply's block ends where the agent goes on to a call (HarnessV4_Tasks U4, V4-D137)", () => {
  /**
   * A translator whose reply says where it is broken, in one trail with the events (turn states left out).
   * @param {Partial<Parameters<typeof createAgentRun>[0]>} [o]
   */
  const traced = (o = {}) => {
    /** @type {string[]} */
    const trail = [];
    const run = createAgentRun({
      publish: (e) => e.type !== "turn-state" && trail.push(e.round ? `${e.type}:${e.round}` : e.type),
      sink: { breakBlock: () => (trail.push("break"), 0) },
      now: () => 1000,
      ...o,
    });
    return { run, trail };
  };

  test("Claude's words, then a call of the same model call: the block ends as the call starts, while it runs", () => {
    const t = traced({ rawMessages: true });
    t.run.take({ type: "text", text: "Running the tests now.", messageId: "m1" });
    t.run.take({ type: "tool", id: "b1", toolName: "Bash", title: "Terminal", kind: "execute", status: "pending" });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test" } }]));
    assert.deepEqual(t.trail, ["break", "round-start:1", "break", "tool-start:1"], "the call runs: its model call's words are over");
    t.run.take(result("b1", "ok"));
    t.run.take({ type: "tool", id: "b1", status: "completed", content: [{ type: "content", content: { type: "text", text: "ok" } }] });
    t.run.take({ type: "text", text: "All passed.", messageId: "m2" });
    assert.deepEqual(t.trail.slice(4), ["tool-end:1", "round-text:1", "break", "round-start:2"], "the next model call opens its own, as it did");
  });

  test("an agent that names no model call: the same", () => {
    const t = traced();
    t.run.take({ type: "text", text: "Checking." });
    t.run.take({ type: "tool", id: "c1", title: "ls -la", kind: "execute", status: "in_progress" });
    assert.deepEqual(t.trail, ["break", "round-start:1", "break", "tool-start:1"]);
  });

  test("a sub-agent's launch and a question on a card of its own end it too; a sub-agent's own call never does", () => {
    const t = traced();
    t.run.take({ type: "text", text: "Delegating." });
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Explore", description: "Look around" });
    assert.deepEqual(t.trail, ["break", "round-start:1", "break", "tool-start:1", "subagent-start:1"]);
    t.run.take({ type: "text", text: "Meanwhile, the plan." });
    // The main thread's words may still be coming: its sub-agent's calls are its card's, never the reply's.
    t.run.take({ type: "tool", id: "ct1", toolName: "Read", title: "Read src/a.js", kind: "read", status: "in_progress", subagent: "S1" });
    assert.deepEqual(t.trail.slice(5), ["round-text:1", "break", "round-start:2", "subagent-tool-start:1"]);
    const link = fromElicitation({ mode: "url", sessionId: "s1", message: "Sign in to the docs server", url: "https://example.com/login", elicitationId: "el_1" }, { agent: "Claude" });
    t.run.take({ type: "ask", id: "q1", form: link, waits: true });
    assert.deepEqual(t.trail.slice(9), ["break", "tool-start:2", "ask:2"], "it waits for the person now");
  });
});

describe("a sub-agent's words as it writes them (HarnessV4_Tasks E15 step 5, AG-154)", () => {
  /** A turn whose sub-agent S1 has started. */
  const launched = () => {
    const t = make();
    t.run.take({ type: "text", text: "Delegating.", messageId: "m1" });
    t.run.take({ type: "subagent", state: "spawned", id: "S1", name: "Explore", description: "Look around" });
    return t;
  };
  /** @param {ReturnType<typeof make>} t */
  const words = (t) => t.of("subagent-words").map((e) => [e.parent, e.msg, e.thinking === true, e.text]);

  // (fails before: yes — a sub-agent's words reached the run once, at its end, as its report: its card and its thread
  // stood still for as long as it wrote)
  test("a message's words join the run as pieces — what it gained since the last — before the call that follows them and before its end", async () => {
    const t = launched();
    t.run.take({ type: "text", text: "Reading ", messageId: "c1", subagent: "S1" });
    t.run.take({ type: "text", text: "the file.", messageId: "c1", subagent: "S1" });
    assert.deepEqual(words(t), [], "not with every word: at most twice a second");
    t.run.take({ type: "tool", id: "ct1", toolName: "Read", title: "Read src/a.js", kind: "read", status: "in_progress", subagent: "S1" });
    assert.deepEqual(t.seq().slice(-2), ["subagent-words:1", "subagent-tool-start:1"], "what it wrote before a call is on the run before the call");
    t.run.take({ type: "tool", id: "ct1", status: "completed", subagent: "S1" });
    t.run.take({ type: "text", text: "Found ", messageId: "c2", subagent: "S1" });
    await until(() => t.of("subagent-words").length === 2, "the words' own timer");
    t.run.take({ type: "text", text: "it.", messageId: "c2", subagent: "S1" });
    t.run.take({ type: "subagent", state: "completed", id: "S1" });
    assert.deepEqual(words(t), [["sa:S1", "c1", false, "Reading the file."], ["sa:S1", "c2", false, "Found "], ["sa:S1", "c2", false, "it."]], "a piece is what the message gained; another message begins anew");
    assert.deepEqual(t.seq().slice(-3), ["subagent-words:1", "subagent-end:1", "tool-end:1"], "its last words are on the run before its end");
    assert.equal(t.of("subagent-end")[0].report, "Found it.", "its report is its last message, whole");
  });

  // (fails before: yes — its thinking was dropped; and a sub-agent's own sub-agent has no card to say words on)
  test("its thinking goes too, ahead of the same message's words; a message with no id is one message; its own sub-agent's words are not said", () => {
    const t = launched();
    t.run.take({ type: "subagent", state: "spawned", id: "S2", name: "Inner", description: "Read", subagent: "S1" });
    t.run.take({ type: "text", text: "inner words", messageId: "i1", subagent: "S2" });
    t.run.take({ type: "thought", text: "Let me think.", subagent: "S1" });
    t.run.take({ type: "text", text: "Now.", subagent: "S1" });
    t.run.take({ type: "text", text: " And more.", subagent: "S1" });
    t.run.take({ type: "subagent", state: "completed", id: "S2" });
    t.run.take({ type: "subagent", state: "completed", id: "S1" });
    assert.deepEqual(words(t), [["sa:S1", "", true, "Let me think."], ["sa:S1", "", false, "Now. And more."]]);
  });

  // (fails before: yes — Claude's own agent's messages were read for its report alone)
  test("Claude's own agent: each of its messages' thinking and words, under the call that began it", async () => {
    const t = make({ rawMessages: true });
    launchInBackground(t);
    t.run.take(assistant("c1", [{ type: "thinking", thinking: "Where to look?", signature: "s" }], "b_task"));
    t.run.take(assistant("c1", [{ type: "text", text: "Searching." }], "b_task"));
    t.run.take({ type: "tool", id: "b_g1", toolName: "Grep", title: "grep", kind: "search", status: "pending", parentToolCallId: "b_task" });
    t.run.take(assistant("c1", [{ type: "tool_use", id: "b_g1", name: "Grep", input: { pattern: "hello" } }], "b_task"));
    t.run.take(result("b_g1", "README.md", false, "b_task"));
    t.run.take({ type: "tool", id: "b_g1", status: "completed", parentToolCallId: "b_task" });
    t.run.take(assistant("c2", [{ type: "text", text: "README.md says hello." }], "b_task"));
    t.run.take({ type: "raw", message: system("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "completed", summary: "README.md says hello." }) });
    await t.run.close({ status: "done" });
    assert.deepEqual(words(t), [["b_task", "c1", true, "Where to look?"], ["b_task", "c1", false, "Searching."], ["b_task", "c2", false, "README.md says hello."]]);
    assert.deepEqual(t.events.filter((e) => /^subagent-/.test(e.type)).map((e) => e.type), ["subagent-start", "subagent-words", "subagent-words", "subagent-tool-start", "subagent-tool-end", "subagent-words", "subagent-end"]);
  });

  // (fails before: no — a guard: a turn that ends with words still waiting says them, and leaves no timer behind)
  test("the turn's end says the words still waiting, then ends the sub-agent", async () => {
    const t = launched();
    t.run.take({ type: "text", text: "Half a sentence", messageId: "c1", subagent: "S1" });
    await t.run.close({ status: "stopped" });
    assert.deepEqual(words(t), [["sa:S1", "c1", false, "Half a sentence"]]);
    const types = t.events.map((e) => e.type);
    assert.ok(types.indexOf("subagent-words") < types.indexOf("subagent-end"), types.join(" "));
    const before = t.events.length;
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(t.events.length, before, "nothing is said after the run closed");
  });
});

describe("Claude's sub-agent as claude-agent-acp 0.87.0 sends it: its call, its task and its session are one (HarnessV4_Tasks E15 step 5)", () => {
  const LAUNCH = { description: "Find hello", prompt: "Find the files that say hello", subagent_type: "Explore" };
  /** One of the sub-agent's raw messages: it names its model. @param {string} id @param {any[]} content @param {string} [parent] */
  const child = (id, content, parent = "b_task") => ({ type: "raw", message: { type: "assistant", parent_tool_use_id: parent, message: { id, role: "assistant", model: "claude-haiku-4-5", content } } });
  /**
   * The launch: the call in Claude's own message, the task that names the call, then the sub-agent's session — and no
   * update of the call's own until its result. One launched in the background has that result at once.
   * @param {{ background: boolean }} o
   */
  const launched = ({ background }) => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Launching.", messageId: "m1" });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "b_task", name: "Agent", input: LAUNCH }]));
    t.run.take({ type: "raw", message: system("task_started", { task_id: "a1", tool_use_id: "b_task", description: LAUNCH.description, subagent_type: "Explore", is_backgrounded: background, task_type: "local_agent", prompt: LAUNCH.prompt }) });
    t.run.take({ type: "subagent", state: "spawned", id: "a1", name: LAUNCH.description, description: LAUNCH.prompt });
    if (!background) return t;
    t.run.take({ type: "tool", id: "b_task", toolName: "Agent" });
    t.run.take({ type: "raw", message: { type: "user", parent_tool_use_id: null, tool_use_result: { isAsync: true, status: "async_launched", agentId: "a1" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b_task", content: [{ type: "text", text: LAUNCHED }] }] } } });
    return t;
  };
  /** Its work: each message raw, and again as its session's chunk; a call that names its session and the launch. @param {ReturnType<typeof make>} t */
  const works = (t) => {
    t.run.take(child("c1", [{ type: "thinking", thinking: "Where to look?", signature: "s" }]));
    t.run.take({ type: "thought", text: "Where to look?", messageId: "c1", subagent: "a1" });
    t.run.take(child("c1", [{ type: "text", text: "Searching." }]));
    t.run.take({ type: "text", text: "Searching.", messageId: "c1", subagent: "a1" });
    t.run.take(child("c1", [{ type: "tool_use", id: "b_g1", name: "Grep", input: { pattern: "hello" } }]));
    t.run.take({ type: "tool", id: "b_g1", toolName: "Grep", title: "grep", kind: "search", status: "pending", parentToolCallId: "b_task", subagent: "a1" });
    t.run.take(result("b_g1", "README.md", false, "b_task"));
    t.run.take({ type: "tool", id: "b_g1", status: "completed", parentToolCallId: "b_task", subagent: "a1" });
    t.run.take(child("c2", [{ type: "text", text: "README.md says hello." }]));
    t.run.take({ type: "text", text: "README.md says hello.", messageId: "c2", subagent: "a1" });
    t.run.take({ type: "subagent", state: "completed", id: "a1" });
    t.run.take({ type: "raw", message: system("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "completed", summary: "README.md says hello." }) });
  };
  /** @param {ReturnType<typeof make>} t */
  const words = (t) => t.of("subagent-words").map((e) => [e.parent, e.msg, e.thinking === true, e.text]);
  /** @param {ReturnType<typeof make>} t @param {string} type */
  const ids = (t, type) => t.of(type).map((e) => e.id ?? e.parent);

  // (fails before: yes — the session drew a second card, "sa:a1", beside the call's: two cards in the chat and two rows
  // in the Side tab for one agent, its calls on one and its words on both; the card named no kind; and the turn's end
  // ended the call's card again, with the words that said it was launched)
  test("launched in the background: one card, by its call; its kind; its words once; one end, with its report and its model", async () => {
    const t = launched({ background: true });
    works(t);
    assert.deepEqual(ids(t, "tool-start"), ["b_task"]);
    const [start] = t.of("subagent-start");
    assert.deepEqual([t.of("subagent-start").length, start.parent, start.description, start.agent, start.prompt], [1, "b_task", "Find hello", "Explore", LAUNCH.prompt]);
    assert.deepEqual(words(t), [["b_task", "c1", true, "Where to look?"], ["b_task", "c1", false, "Searching."], ["b_task", "c2", false, "README.md says hello."]]);
    assert.deepEqual(t.of("subagent-tool-start").map((e) => [e.parent, e.id]), [["b_task", "b_g1"]]);
    const [end] = t.of("subagent-end");
    assert.deepEqual([t.of("subagent-end").length, end.parent, end.status, end.toolCalls, end.model, end.report], [1, "b_task", "done", 1, "claude-haiku-4-5", "README.md says hello."]);
    await t.run.close({ status: "done" });
    const ends = t.of("tool-end");
    assert.deepEqual(ends.map((e) => [e.id, e.ok, e.preview]), [["b_task", true, "README.md says hello."]], "the turn's end ends the card no second time");
    assert.equal(t.run.counts().subagents, 1);
  });

  // (fails before: yes — what a sub-agent holds was never on the run: its row read it from the page's copy of Claude's
  // task list, which a turn begun in the harness does not hear while it runs)
  test("what it holds goes onto the run with each of its calls, where the figure moved, and never after its end", () => {
    const t = launched({ background: true });
    /** @param {number} n @param {string} [call] */
    const progress = (n, call = "b_task") => t.run.take({ type: "raw", message: system("task_progress", { task_id: "a1", tool_use_id: call, usage: { total_tokens: n, tool_uses: 1, duration_ms: 5 } }) });
    progress(13_434);
    progress(13_434);
    progress(13_463.4);
    progress(0);
    progress(500, "another_call");
    t.run.take({ type: "subagent", state: "completed", id: "a1" });
    progress(14_000);
    assert.deepEqual(t.of("subagent-held").map((e) => [e.parent, e.tokens, e.round]), [["b_task", 13_434, 1], ["b_task", 13_463, 1]]);
  });

  // (fails before: yes — two cards; and Claude's adapter says no end for an Agent call, so the call's card ran on until
  // the turn ended, long after its agent had answered)
  test("in the foreground: one card; the call's result is its end, as the model read it", async () => {
    const t = launched({ background: false });
    works(t);
    assert.deepEqual([ids(t, "tool-start"), ids(t, "subagent-start"), t.of("subagent-end").map((e) => e.status)], [["b_task"], ["b_task"], ["done"]]);
    assert.deepEqual(t.of("tool-end"), [], "its agent's end is no end of the call: the model has not read its result yet");
    t.run.take({ type: "tool", id: "b_task", toolName: "Agent" });
    t.run.take(result("b_task", "[Subagent hand-back]\n  README.md says hello."));
    assert.deepEqual(t.of("tool-end").map((e) => [e.id, e.ok, e.preview]), [["b_task", true, "[Subagent hand-back]\n  README.md says hello."]]);
    assert.equal(t.of("turn-state").at(-1).to, "observing", "and the main agent goes on from it");
    await t.run.close({ status: "done" });
    assert.equal(t.of("tool-end").length, 1);
    assert.equal(t.of("subagent-end").length, 1);
  });

  // (fails before: yes — the inner agent's session drew a row "agent" on its parent's card beside its call's own row)
  test("its own sub-agent is one row on its card: the call, ended once, by whichever comes first of its end and the call's", async () => {
    const t = launched({ background: true });
    const inner = { description: "Inner", prompt: "Read the file", subagent_type: "Explore" };
    t.run.take(child("c1", [{ type: "tool_use", id: "n_task", name: "Agent", input: inner }]));
    t.run.take({ type: "raw", message: system("task_started", { task_id: "a2", tool_use_id: "n_task", description: "Inner", subagent_type: "Explore", is_backgrounded: false, task_type: "local_agent" }) });
    t.run.take({ type: "subagent", state: "spawned", id: "a2", name: "Inner", description: "Read the file" });
    t.run.take(child("i1", [{ type: "text", text: "Reading." }], "n_task"));
    t.run.take({ type: "text", text: "Reading.", messageId: "i1", subagent: "a2" });
    t.run.take({ type: "tool", id: "n_g1", toolName: "Read", title: "Read a.js", kind: "read", status: "pending", parentToolCallId: "n_task", subagent: "a2" });
    t.run.take(child("i1", [{ type: "tool_use", id: "n_g1", name: "Read", input: { file_path: IN_ROOT } }], "n_task"));
    t.run.take(result("n_g1", "x", false, "n_task"));
    t.run.take({ type: "tool", id: "n_g1", status: "completed", parentToolCallId: "n_task", subagent: "a2" });
    t.run.take(child("i2", [{ type: "text", text: "It exports x." }], "n_task"));
    t.run.take({ type: "subagent", state: "completed", id: "a2" });
    t.run.take(result("n_task", "[Subagent hand-back]\n  It exports x.", false, "b_task"));
    assert.deepEqual([ids(t, "tool-start"), ids(t, "subagent-start")], [["b_task"], ["b_task"]], "no card of its own");
    assert.deepEqual(t.of("subagent-tool-start").map((e) => [e.parent, e.id, e.name]), [["b_task", "n_task", "Agent"], ["b_task", "n_g1", "Read"]]);
    assert.deepEqual(t.of("subagent-tool-end").map((e) => [e.parent, e.id, e.preview]), [["b_task", "n_g1", "x"], ["b_task", "n_task", "It exports x."]]);
    assert.deepEqual(words(t), [], "its words are its row's end, never its parent's words");
    t.run.take({ type: "subagent", state: "completed", id: "a1" });
    assert.equal(t.of("subagent-end")[0].toolCalls, 2);
    await t.run.close({ status: "done" });
    assert.equal(t.of("subagent-tool-end").length, 2);
  });

  // (fails before: no — a guard: a session no task ties to a call is a sub-agent of its own, as an agent that sends no
  // raw messages has them)
  test("a session that no task names a call for keeps a card of its own", () => {
    const t = make({ rawMessages: true });
    t.run.take({ type: "text", text: "Launching.", messageId: "m1" });
    t.run.take({ type: "subagent", state: "spawned", id: "a9", name: "Explore", description: "Look around" });
    t.run.take({ type: "text", text: "Looking.", messageId: "c1", subagent: "a9" });
    t.run.take({ type: "subagent", state: "completed", id: "a9" });
    assert.deepEqual([ids(t, "tool-start"), ids(t, "subagent-start"), words(t)], [["sa:a9"], ["sa:a9"], [["sa:a9", "c1", false, "Looking."]]]);
  });
});

// A call's `command` (services/runs.js): what the commit watch takes for a time of the chat's own
// (app/watchers/commits.js). Through the app and the fake agents, in watch-commit-own.test.js.
// (fails before: yes — no call's start said `command`)
describe("which calls say `command`, for the commit watch", () => {
  /** Each call's start, by its id: whether it said `command`. @param {ReturnType<typeof make>} t */
  const said = (t) => Object.fromEntries([...t.of("tool-start"), ...t.of("subagent-tool-start")].map((e) => [e.id, e.command === true]));

  test("Claude's: a command, an MCP server's tool, a press of Filament's space tool and a call through its mcp tool say it; what the gate reads as only reading, a file's read or edit and Filament's other tools do not", () => {
    /** What the gate was asked to read. @type {any[]} */
    const asked = [];
    const t = make({
      rawMessages: true,
      root: ROOT,
      reads: (tc) => {
        asked.push(tc);
        return /^git (log|status)\b/.test(String(tc.rawInput?.command ?? "")) || tc.name === "mcp__docs__search";
      },
    });
    /** @type {[string, string, any, string][]} */
    const calls = [
      ["b1", "Bash", { command: "git commit -m x" }, "execute"],
      ["b2", "Bash", { command: "git log -1" }, "execute"],
      ["m1", "mcp__github__create_issue", { title: "x" }, "other"],
      ["m2", "mcp__docs__search", { q: "x" }, "read"],
      ["s1", "mcp__filament__space", { action: "dashboard", name: "Builds", press: "Build", row: "main" }, "other"],
      ["s2", "mcp__filament__space", { action: "app", app: "Builds", do: "Build" }, "other"],
      ["s3", "mcp__filament__space", { action: "app", with: JSON.stringify({ app: "Builds", tool: "status" }) }, "other"],
      ["s4", "mcp__filament__space", { action: "dashboard", name: "Builds" }, "other"],
      ["d1", "mcp__filament__mcp", { action: "call", server: "github", tool: "create_issue", args: { title: "x" } }, "other"],
      ["f1", "mcp__filament__memory_search", { query: "x" }, "other"],
      ["f2", "mcp__filament__background_command", { command: "npm run dev" }, "other"],
      // Filament's own Bash hand (http/mcp.js), which an agent whose own shell is off runs its commands through.
      ["h1", "mcp__filament__Bash", { command: "git commit -m x" }, "other"],
      ["h2", "mcp__filament__Bash", { command: "git log -1" }, "other"],
      ["r1", "Read", { file_path: IN_ROOT }, "read"],
      ["e1", "Edit", { file_path: IN_ROOT, old_string: "a", new_string: "b" }, "edit"],
    ];
    t.run.take(assistant("m1", calls.map(([id, name, input]) => ({ type: "tool_use", id, name, input }))));
    for (const [id, name, , kind] of calls) t.run.take({ type: "tool", id, toolName: name, title: name, kind, status: "pending" });
    assert.deepEqual(said(t), { b1: true, b2: false, m1: true, m2: false, s1: true, s2: true, s3: true, s4: false, d1: true, f1: false, f2: false, h1: true, h2: false, r1: false, e1: false });
    assert.deepEqual(
      asked.map((tc) => [tc.name, tc.kind, tc.rawInput]),
      [
        ["Bash", "execute", { command: "git commit -m x" }],
        ["Bash", "execute", { command: "git log -1" }],
        ["mcp__github__create_issue", "other", { title: "x" }],
        ["mcp__docs__search", "read", { q: "x" }],
        ["Bash", "execute", { command: "git commit -m x" }],
        ["Bash", "execute", { command: "git log -1" }],
      ],
      "the gate is asked of a command — Filament's Bash hand as the agent's own — and of an MCP server's tool alone, by the tool's own name and its whole input",
    );
  });

  test("an agent whose message names no call is never read: each command of it says it, whatever the gate would say; with no gate, Claude's do too", () => {
    const plain = make({ root: ROOT, reads: () => true });
    plain.run.take({ type: "tool", id: "x1", title: "git log -1", kind: "execute", status: "in_progress", rawInput: { command: "git log -1" } });
    plain.run.take({ type: "tool", id: "r1", title: "Read a.js", kind: "read", status: "in_progress", locations: [{ path: IN_ROOT }] });
    assert.deepEqual(said(plain), { x1: true, r1: false });
    const ungated = make({ rawMessages: true, root: ROOT });
    ungated.run.take(assistant("m1", [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "git log -1" } }]));
    ungated.run.take({ type: "tool", id: "b1", toolName: "Bash", title: "git log -1", kind: "execute", status: "pending" });
    assert.deepEqual(said(ungated), { b1: true });
  });

  test("a call of the agent's own sub-agent says it on that sub-agent's card", () => {
    const t = make({ rawMessages: true, root: ROOT, reads: (tc) => String(tc.rawInput?.command ?? "") === "git status" });
    /** Claude's raw assistant message of a sub-agent's model call. @param {string} id @param {any[]} content */
    const child = (id, content) => ({ type: "raw", message: { type: "assistant", parent_tool_use_id: "task1", message: { id, role: "assistant", content } } });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "task1", name: "Agent", input: { description: "Commit it", prompt: "Commit.", subagent_type: "general-purpose" } }]));
    t.run.take({ type: "tool", id: "task1", toolName: "Agent", title: "Commit it", kind: "think", status: "pending" });
    for (const [id, command] of [["k1", "git commit -m x"], ["k2", "git status"]]) {
      t.run.take({ type: "tool", id, toolName: "Bash", title: command, kind: "execute", status: "pending", parentToolCallId: "task1" });
      t.run.take(child(`i-${id}`, [{ type: "tool_use", id, name: "Bash", input: { command } }]));
    }
    assert.deepEqual(t.of("subagent-tool-start").map((e) => [e.parent, e.id, e.command === true]), [["task1", "k1", true], ["task1", "k2", false]]);
  });
});

// A call's `edits` (services/runs.js): the files a file-writing call says it writes as it starts, which the keeper of a
// chat's own times keeps as that chat's writes (app/watchers/own-times.js), so a watcher of files is not woken by what
// the chat it wakes wrote.
// (fails before: yes — no call's start said `edits`)
describe("which calls say `edits`, and the files they name", () => {
  /** Each call's start, by its id: what it said it writes. @param {ReturnType<typeof make>} t */
  const said = (t) => Object.fromEntries([...t.of("tool-start"), ...t.of("subagent-tool-start")].map((e) => [e.id, e.edits]));

  test("Claude's: an Edit, a Write, a MultiEdit and a notebook's edit say their file, absolute — one named from its folder read from there; a read, a search, a command and an MCP server's tool say none", () => {
    const t = make({ rawMessages: true, root: ROOT });
    /** @type {[string, string, any, string, any[]][]} */
    const calls = [
      ["e1", "Edit", { file_path: IN_ROOT, old_string: "a", new_string: "b" }, "edit", [{ path: IN_ROOT }]],
      ["w1", "Write", { file_path: "docs/new.md", content: "x" }, "edit", []],
      ["m1", "MultiEdit", { file_path: OUTSIDE, edits: [{ old_string: "a", new_string: "b" }] }, "edit", [{ path: OUTSIDE }]],
      ["n1", "NotebookEdit", { notebook_path: join(ROOT, "nb.ipynb"), new_source: "x" }, "edit", []],
      ["f1", "mcp__filament__Write", { file_path: "made.txt", content: "x" }, "other", []],
      ["r1", "Read", { file_path: IN_ROOT }, "read", [{ path: IN_ROOT }]],
      ["g1", "Grep", { pattern: "x", path: ROOT }, "search", []],
      ["b1", "Bash", { command: "npm test" }, "execute", []],
      ["x1", "mcp__github__create_issue", { title: "x", path: "a.js" }, "other", []],
    ];
    t.run.take(assistant("m1", calls.map(([id, name, input]) => ({ type: "tool_use", id, name, input }))));
    for (const [id, name, , kind, locations] of calls) t.run.take({ type: "tool", id, toolName: name, title: name, kind, status: "pending", locations });
    assert.deepEqual(said(t), {
      e1: [IN_ROOT],
      w1: [join(ROOT, "docs", "new.md")],
      m1: [OUTSIDE],
      n1: [join(ROOT, "nb.ipynb")],
      f1: [join(ROOT, "made.txt")],
      r1: undefined,
      g1: undefined,
      b1: undefined,
      x1: undefined,
    });
    assert.deepEqual(Object.keys(t.of("tool-start").find((e) => e.id === "r1")).includes("edits"), false, "a call that writes no file carries no such field");
  });

  test("an agent that names no tool: a call of kind edit, delete or move says the files of its locations, each once; with none to read at its start, only that it writes", () => {
    const t = make({ root: ROOT });
    const moved = join(ROOT, "src", "b.js");
    t.run.take({ type: "tool", id: "e1", title: "Edit a.js", kind: "edit", status: "in_progress", locations: [{ path: IN_ROOT }, { path: IN_ROOT, line: 12 }] });
    t.run.take({ type: "tool", id: "d1", title: "Delete b.js", kind: "delete", status: "in_progress", locations: [{ path: "src/b.js" }] });
    t.run.take({ type: "tool", id: "v1", title: "Move a.js", kind: "move", status: "in_progress", locations: [{ path: IN_ROOT }, { path: moved }] });
    t.run.take({ type: "tool", id: "p1", title: "Apply a patch", kind: "edit", status: "in_progress" });
    t.run.take({ type: "tool", id: "r1", title: "Read a.js", kind: "read", status: "in_progress", locations: [{ path: IN_ROOT }] });
    t.run.take({ type: "tool", id: "x1", title: "npm test", kind: "execute", status: "in_progress", locations: [{ path: ROOT }] });
    assert.deepEqual(said(t), { e1: [IN_ROOT], d1: [moved], v1: [IN_ROOT, moved], p1: true, r1: undefined, x1: undefined });
    // With no folder the agent is known to work in, a file named from it cannot be said.
    const nowhere = make({});
    nowhere.run.take({ type: "tool", id: "e1", title: "Edit a.js", kind: "edit", status: "in_progress", locations: [{ path: "src/a.js" }] });
    nowhere.run.take({ type: "tool", id: "e2", title: "Edit a.js", kind: "edit", status: "in_progress", locations: [{ path: IN_ROOT }] });
    assert.deepEqual(said(nowhere), { e1: true, e2: [IN_ROOT] });
  });

  test("past 50 files, or a path past 400 characters, a call says only that it writes", () => {
    const t = make({ root: ROOT });
    const files = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ path: join(ROOT, `f${i}.txt`) }));
    t.run.take({ type: "tool", id: "e50", title: "Apply a patch", kind: "edit", status: "in_progress", locations: files(50) });
    t.run.take({ type: "tool", id: "e51", title: "Apply a patch", kind: "edit", status: "in_progress", locations: files(51) });
    const at400 = join(ROOT, "x".repeat(400 - ROOT.length - 1));
    t.run.take({ type: "tool", id: "l400", title: "Edit", kind: "edit", status: "in_progress", locations: [{ path: at400 }] });
    t.run.take({ type: "tool", id: "l401", title: "Edit", kind: "edit", status: "in_progress", locations: [{ path: `${at400}y` }] });
    const got = said(t);
    assert.deepEqual([got.e50.length, got.e51, got.l400, got.l401], [50, true, [at400], true]);
  });

  test("a call of the agent's own sub-agent says it on that sub-agent's card", () => {
    const t = make({ rawMessages: true, root: ROOT });
    /** Claude's raw assistant message of a sub-agent's model call. @param {string} id @param {any[]} content */
    const child = (id, content) => ({ type: "raw", message: { type: "assistant", parent_tool_use_id: "task1", message: { id, role: "assistant", content } } });
    t.run.take(assistant("m1", [{ type: "tool_use", id: "task1", name: "Agent", input: { description: "Fix it", prompt: "Fix.", subagent_type: "general-purpose" } }]));
    t.run.take({ type: "tool", id: "task1", toolName: "Agent", title: "Fix it", kind: "think", status: "pending" });
    t.run.take({ type: "tool", id: "k1", toolName: "Edit", title: "Edit a.js", kind: "edit", status: "pending", parentToolCallId: "task1", locations: [{ path: IN_ROOT }] });
    t.run.take(child("i-k1", [{ type: "tool_use", id: "k1", name: "Edit", input: { file_path: IN_ROOT, old_string: "a", new_string: "b" } }]));
    t.run.take({ type: "tool", id: "k2", toolName: "Read", title: "Read a.js", kind: "read", status: "pending", parentToolCallId: "task1" });
    t.run.take(child("i-k2", [{ type: "tool_use", id: "k2", name: "Read", input: { file_path: IN_ROOT } }]));
    assert.deepEqual(t.of("subagent-tool-start").map((e) => [e.parent, e.id, e.edits]), [["task1", "k1", [IN_ROOT]], ["task1", "k2", undefined]]);
  });
});
