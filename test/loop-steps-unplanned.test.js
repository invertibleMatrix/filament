// @ts-check
// The owner's of 11-09: work that breaks into more than one step is planned before it starts — on the plan tool's
// checklist, or on the task graph where it branches. Where a turn's writes and edits change a second file and the agent
// keeps neither, Filament says so once, at the end of that call's result (loop.js `UNPLANNED_LINE`): never where the agent
// has no plan tool or no tasks tool, nor where a checklist or the graph's open tasks already hold the work. Driven
// directly with a scripted model call; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn, UNPLANNED_LINE } from "../src/app/agent/loop.js";
import { FORK_REFUSALS, SUBAGENT_OFF, toolSetFor } from "../src/app/agent/tools.js";

/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} content */
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
/** @param {string} id @param {string} path */
const write = (id, path) => toolUse(id, "write", { path, content: "x" });
/** @param {string} id @param {string} path */
const edit = (id, path) => toolUse(id, "edit", { path, old_string: "a", new_string: "b" });
/** @param {string} id @param {string[]} statuses */
const planCall = (id, statuses) => toolUse(id, "plan", { items: statuses.map((status, i) => ({ text: `step ${i + 1}`, status })) });

/** The session's own agent with its task graph on: plan, and tasks beside it. */
const MAIN = toolSetFor({ delegateRead: false, graph: true });
/**
 * The session's graph behind the tasks tool: what comes back of it after a summary — its open tasks' words, the ask of
 * one left open with all done, or null — and whether a task on it is open (`hasOpen`, as the runner reads it).
 * @param {string | null} [open] @param {boolean} [hasOpen]
 */
const graphOf = (open = null, hasOpen = open != null) => ({ apply: () => ({ ok: true, text: "Kept.", view: null, changed: false }), open: () => open, hasOpen: () => hasOpen });

/** Each tool result the turn's work holds, by its call's id, as the model read it. @param {any[]} work */
const resultsOf = (work) =>
  Object.fromEntries(work.flatMap((m) => (m.role === "user" && Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, String(b.content)]) : [])));
/** The calls whose result carries the line. @param {Record<string, string>} results */
const lined = (results) => Object.keys(results).filter((id) => results[id].includes(UNPLANNED_LINE));

/**
 * One turn on Filament's loop whose model makes `rounds`, one reply each, then ends; what its work's results read.
 * @param {any[][]} rounds @param {Record<string, any>} [over]
 */
const turn = async (rounds, over = {}) => {
  let n = 0;
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "rename a.txt, add a heading to it, and create c.txt" }],
      system: "s",
      tools: MAIN,
      modeNow: () => "auto",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async () => reply(rounds[n++] || [{ type: "text", text: "Done." }]),
      costOf: () => 0,
      runHand: async (/** @type {string} */ name) => `${name} ran`,
      delegateRead: null,
      mailbox: null,
      permissions: null,
      graph: graphOf(),
      tree: null,
      onEvent: () => {},
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
      ...over,
    }),
  );
  return { out, results: resultsOf(out.work) };
};

test("a second file changed with no checklist and no graph: the line ends that call's result, once", async () => {
  const { out, results } = await turn([[write("w1", "a.txt")], [edit("e2", "b.txt")], [{ type: "text", text: "Both done." }]]);
  assert.equal(out.status, "done");
  assert.equal(results.w1, "write ran", "the first file is one step: nothing is said");
  assert.equal(results.e2, `edit ran\n\n${UNPLANNED_LINE}`, "the line is the last of the second file's result");
  assert.ok(!UNPLANNED_LINE.includes("\n"), "it is one line");
  assert.ok(out.notes.some((n) => /changed a second file with neither a checklist nor a task graph/.test(n)), "the record says it");
});

test("two files written in one reply: the line rides the second call's result", async () => {
  const { results } = await turn([[write("w1", "a.txt"), write("w2", "b.txt")]]);
  assert.deepEqual(lined(results), ["w2"]);
  assert.ok(results.w2.endsWith(UNPLANNED_LINE));
});

test("a third file, and the first again, add no second line: once a turn", async () => {
  const { results } = await turn([[write("w1", "a.txt")], [write("w2", "b.txt")], [write("w3", "c.txt")], [edit("e4", "a.txt")], [write("w5", "d.txt")]]);
  assert.deepEqual(lined(results), ["w2"]);
});

test("one file only — written, then edited twice under another spelling — is one step: no line", async () => {
  const { results } = await turn([[write("w1", "a.txt")], [edit("e2", "a.txt")], [edit("e3", "./a.txt")]]);
  assert.deepEqual(lined(results), []);
});

// (fails before: yes — the turn's files were keyed by `resolve` alone, so on Windows one file in two cases, or named
// drive-relative on another drive than the root's, counted as two where the hands changed one)
test("one file as the hands resolve it — in another case on Windows, drive-relative on another drive — is one step: no line", { skip: process.platform !== "win32" && "case-insensitive paths and drive letters are Windows'" }, async () => {
  const cased = await turn([[write("w1", "src/App.js")], [edit("e2", "src/app.js")], [edit("e3", "SRC\\APP.JS")]]);
  assert.deepEqual(lined(cased.results), []);
  const other = tmpdir().slice(0, 1).toUpperCase() === "Q" ? "R" : "Q";
  const real = process.cwd;
  process.cwd = () => `${other}:\\filament`; // Filament runs from that drive: the hands read Q:x.txt from Q:\
  try {
    const drive = await turn([[write("w1", `${other}:x.txt`)], [edit("e2", `${other}:\\x.txt`)]]);
    assert.deepEqual(lined(drive.results), []);
  } finally {
    process.cwd = real;
  }
});

test("a write that failed changed nothing: the file after it is the second", async () => {
  const { results } = await turn([[write("w1", "a.txt")], [write("w2", "b.txt")], [write("w3", "c.txt")]], {
    runHand: async (/** @type {string} */ name, /** @type {any} */ input) => {
      if (input.path === "b.txt") throw new Error("EACCES");
      return `${name} ran`;
    },
  });
  assert.deepEqual(lined(results), ["w3"]);
});

test("a checklist kept first: no line — the turn's own, even once every item on it is done", async () => {
  const { results } = await turn([[planCall("p1", ["doing", "pending", "pending"])], [write("w2", "a.txt")], [write("w3", "b.txt")], [write("w4", "c.txt")]]);
  assert.deepEqual(lined(results), []);
  // The turn planned its work: a list it finished is its own to update, not Filament's to ask for again.
  const finished = await turn([[planCall("p1", ["done", "done"])], [write("w2", "a.txt")], [write("w3", "b.txt")]]);
  assert.deepEqual(lined(finished.results), []);
});

test("the task graph in force — open tasks on it: no line", async () => {
  const { results } = await turn([[write("w1", "a.txt")], [write("w2", "b.txt")]], { graph: graphOf("# Your task graph\n- t1 running: rename a.txt") });
  assert.deepEqual(lined(results), []);
});

// (fails before: yes — FabeleHelper's of 11-10: 0e809e1d3 had `open` say a graph left open with all done after a
// summary, and the line read "no open tasks" off `open`'s words: once an agent left a finished graph open, it went quiet)
test("a graph left open with all done holds no work: the line says it", async () => {
  const done = graphOf("[Filament: where you are — your task graph \"Fix the parser\": its one task is done, and it is still open. …]", false);
  const { results } = await turn([[write("w1", "a.txt")], [write("w2", "b.txt")]], { graph: done });
  assert.deepEqual(lined(results), ["w2"]);
});

test("an earlier turn's checklist still open in the conversation holds the work: no line; one it finished does not", async () => {
  /** @param {string[]} statuses */
  const earlier = (statuses) => [
    { role: "user", content: "start the rename" },
    { role: "assistant", content: [planCall("p0", statuses)] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "p0", content: "Plan recorded." }] },
    { role: "assistant", content: [{ type: "text", text: "On it." }] },
    { role: "user", content: "go on" },
  ];
  const open = await turn([[write("w1", "a.txt")], [write("w2", "b.txt")]], { messages: earlier(["done", "pending"]) });
  assert.deepEqual(lined(open.results), []);
  const finished = await turn([[write("w1", "a.txt")], [write("w2", "b.txt")]], { messages: earlier(["done", "done"]) });
  assert.deepEqual(lined(finished.results), ["w2"]);
});

test("a sub-agent has no plan tool: no line — nor a graph task's sub-agent, a fork, or a turn without the tasks tool", async () => {
  const rounds = [[write("w1", "a.txt")], [write("w2", "b.txt")], [write("w3", "c.txt")]];
  const subagent = await turn(rounds, { tools: toolSetFor({ delegateRead: false, disabled: [...SUBAGENT_OFF] }), graph: null, unattended: "subagent" });
  assert.deepEqual(lined(subagent.results), []);
  const taskAgent = await turn(rounds, { tools: toolSetFor({ delegateRead: false, disabled: [...SUBAGENT_OFF], report: true }), graph: null, unattended: "subagent" });
  assert.deepEqual(lined(taskAgent.results), []);
  // A fork carries the main agent's tools byte for byte, plan and tasks refused in words.
  const fork = await turn(rounds, { graph: null, unattended: "subagent", notCallable: { ...FORK_REFUSALS } });
  assert.deepEqual(lined(fork.results), []);
  const noGraph = await turn(rounds, { tools: toolSetFor({ delegateRead: false }), graph: null });
  assert.deepEqual(lined(noGraph.results), []);
});

test("a turn that pauses between its writes counts on from the files it changed before: the line comes on the second", async () => {
  // Ask mode asks before each write: the turn pauses on it, and the developer's Allow runs it as the turn resumes.
  const rounds = [[write("w1", "a.txt")], [write("w2", "b.txt")], [write("w3", "c.txt")]];
  let n = 0;
  const base = { modeNow: () => "ask", call: async () => reply(rounds[n++] || [{ type: "text", text: "Done." }]) };
  const first = await turn([], base);
  assert.equal(first.out.status, "paused");
  const second = await turn([], { ...base, resume: { paused: first.out.pause, answer: "", allow: true } });
  assert.equal(second.out.status, "paused");
  assert.deepEqual(lined(second.results), [], "a.txt ran: one file so far");
  const third = await turn([], { ...base, resume: { paused: second.out.pause, answer: "", allow: true } });
  assert.equal(third.out.status, "paused");
  assert.deepEqual(lined(third.results), ["w2"], "b.txt is the turn's second file, a pause between them");
  const fourth = await turn([], { ...base, resume: { paused: third.out.pause, answer: "", allow: true } });
  assert.deepEqual(lined(fourth.results), [], "said once a turn, a pause between");
});
