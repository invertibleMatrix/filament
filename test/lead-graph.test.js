// @ts-check
// HarnessV3-TaskGraph-v2 §12 (V2-0c): the session's own agent reads along with the sub-agents of its task graph. With
// the graph on and `engine.supervise` on (a session's default), its graph's section says it is shown a look at a
// task's sub-agent, its tasks has `note` — a line to whoever works on a task now, read at that sub-agent's next step —
// and its show of one task ends with the change so far; such a sub-agent says its plan first and is told the agent
// that planned its task reads along. A team's lead reaches a task's worker with its worker tool and a coding agent's
// tasks are all its own: neither has note. Off, each is version 18's. First apart from the app — the words, the
// tools, the graph's refusals, a look's noun — then on the live app against a fake upstream that holds a sub-agent's
// reply until the agent has acted, so what each side had seen when it answered is fixed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerNote, workerWords } from "../src/app/agent-worker.js";
import { shippedCard } from "../src/services/agent-cards.js";
import { AGENT_HEAD } from "../src/app/agent/loop.js";
import { createLooks, lookGone, lookOf, lookStub, newMark, noted, tidyLooks, withoutLooks } from "../src/app/agent/looks.js";
import { PROMPT, TOOL_TEXT, readAlongReport, systemPromptFor } from "../src/app/agent/prompt.js";
import { unreadWords } from "../src/app/agent/subagents.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_READS_TOOL, TASKS_TOOL, WAIT_READS_TOOL, WAIT_TOOL, loopToolArgs } from "../src/app/agent/tools.js";
import { READS_ACTIONS, TASK_ACTIONS, TASK_CALLS, applyTasks, changeOf } from "../src/core/task-graph.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { TEAM } from "./helpers/team.js";
import { removeDirs } from "./helpers/wait.js";

const QUIET = { id: "t1", name: "Write the quiet note", by: "sub-agent", writes: ["note.txt"], goal: "note.txt greets the reader", steps: ["Read a.txt", "Write note.txt"], acceptance: "note.txt holds the greeting" };
const MAP = { id: "m1", name: "Map it", by: "explorer", goal: "Every file here is known", steps: ["List the files"], acceptance: "each file is named" };
const OWN = { id: "o1", name: "Read the notes" };
/** @param {any} g @param {any} input @param {any} [o] */
const apply = (g, input, o = {}) => applyTasks(g, input, { at: 1, crew: "agent", ...o });
/** The graph after these calls, each of which must go through. @param {any[]} calls @param {any} [o] */
const graphOf = (calls, o = {}) =>
  calls.reduce((/** @type {any} */ g, c) => {
    const r = apply(g, c, o);
    assert.ok(r.ok, r.ok ? "" : r.error);
    return r.graph;
  }, null);
/** A graph with its tasks set as Filament's runner would have them. @param {any} g @param {Record<string, any>} fields by task id */
const withTasks = (g, fields) => ({ ...g, tasks: g.tasks.map((/** @type {any} */ t) => ({ ...t, ...(fields[t.id] || {}) })) });

describe("the agent's words and tools (TG2-D20, D31)", () => {
  const base = { root: "/w", delegateRead: false };
  // (fails before: yes — the agent's graph section had no word of a look, and `supervise` moved nothing without a team)
  test("with the graph on, the agent's graph section says how it reads along; a team's lead's and a sub-agent's never do; off or without the graph it is version 18's", () => {
    const on = systemPromptFor({ ...base, graph: true, supervise: true });
    assert.equal(on, systemPromptFor({ ...base, graph: true }).replace(String(PROMPT.graphSubagents), () => `${PROMPT.graphSubagents}\n${PROMPT.graphLooks}`));
    assert.ok(on.includes(String(PROMPT.graphLooks)));
    assert.equal(systemPromptFor({ ...base, supervise: true }), systemPromptFor(base), "no graph, nothing to read along with");
    const lead = { name: "Architect", persona: "" };
    assert.ok(!systemPromptFor({ ...base, lead, graph: true, supervise: true }).includes(String(PROMPT.graphLooks)), "a lead reads along through its own lines");
    assert.ok(!systemPromptFor({ ...base, subagent: true, task: "work", supervise: true }).includes(String(PROMPT.graphLooks)));
  });

  // (fails before: yes — the agent's tasks had no note, and its wait said nothing of a look)
  test("its tasks has note and a show that names the change so far, and its wait says a look follows; a lead's and a coding agent's tasks are today's", () => {
    const on = loopToolArgs({ graph: true, supervise: true });
    const off = loopToolArgs({ graph: true });
    const named = (/** @type {any[]} */ set, /** @type {string} */ name) => set.find((t) => t.name === name);
    assert.equal(named(on, "tasks"), TASKS_READS_TOOL);
    assert.equal(TASKS_READS_TOOL.description, TOOL_TEXT.tasksReads);
    assert.deepEqual(TASKS_READS_TOOL.input_schema.properties.action.enum, [...READS_ACTIONS]);
    assert.deepEqual(READS_ACTIONS, [...TASK_ACTIONS, "note"]);
    assert.ok("note" in TASKS_READS_TOOL.input_schema.properties);
    assert.equal(named(on, "wait"), WAIT_READS_TOOL);
    assert.equal(WAIT_READS_TOOL.description, TOOL_TEXT.waitReads);
    assert.deepEqual(on.map((t) => t.name), off.map((t) => t.name), "the same tools, in the same order");
    assert.deepEqual([named(off, "tasks"), named(off, "wait")], [TASKS_TOOL, WAIT_TOOL]);
    assert.deepEqual(loopToolArgs({ supervise: true }), loopToolArgs({}), "without the graph the switch moves nothing");
    for (const t of [TASKS_TOOL, CODER_TASKS_TOOL, LEAD_TASKS_TOOL]) assert.ok(!t.input_schema.properties.action.enum.includes("note"), t.description.slice(0, 40));
    assert.ok(!CODER_TASKS_TOOL.description.includes("note —") && !TOOL_TEXT.tasks.includes("note —"));
  });

  // (fails before: yes — a graph task's sub-agent was told nobody could answer it, whoever planned its task)
  test("a graph task's sub-agent is told the agent that planned its task reads along, says its plan first and goes on; a reviewer the same; one without a task, and all of them with the switch off, are version 18's", () => {
    const sub = { ...base, subagent: true, task: /** @type {const} */ ("work") };
    const on = systemPromptFor({ ...sub, supervise: true });
    const off = systemPromptFor(sub);
    assert.ok(on.includes(String(PROMPT.taskReadAlong)) && on.includes(String(PROMPT.taskAmbiguity)) && on.includes(readAlongReport(PROMPT.taskReport)), on);
    assert.ok(!/nobody can answer a question from you mid-task/i.test(on), "the agent can");
    assert.ok(off.includes(PROMPT.taskReport) && off.includes(String(PROMPT.subagentAmbiguity)) && !off.includes(String(PROMPT.taskReadAlong)));
    assert.ok(systemPromptFor({ ...sub, task: "review", supervise: true }).includes(readAlongReport(PROMPT.reviewReport)));
    assert.equal(systemPromptFor({ ...base, subagent: true, readOnly: true, supervise: true }), systemPromptFor({ ...base, subagent: true, readOnly: true }), "launched with agent: nobody reads along");
    // A coding agent on such a task reads the same three lines in its part, and the agent's note under the agent's head.
    const host = { id: "sa_1", card: /** @type {any} */ (shippedCard("builder")), readOnly: false, asks: false, team: null, task: { id: "t1", review: false } };
    const words = workerWords({ ...host, supervise: true });
    assert.equal(words, workerWords(host).replace(String(PROMPT.subagentAmbiguity), () => `${PROMPT.taskReadAlong}\n${PROMPT.taskAmbiguity}`).replace("Nobody can answer a question from you mid-task.", () => String(PROMPT.workerGoOn)));
    assert.equal(workerWords({ ...host, task: null, supervise: true }), workerWords({ ...host, task: null }));
    assert.equal(workerNote({ text: "Lower case.", from: "agent" }), `${AGENT_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- Lower case.`);
    assert.equal(AGENT_HEAD, "Message from the main agent, relayed by Filament");
  });
});

describe("tasks note and show, against the graph (TG2-D20, D32, D33)", () => {
  const added = graphOf([{ action: "add", goal: "A quiet note", tasks: [QUIET, MAP, OWN] }]);
  const running = withTasks(added, { t1: { state: "running", agent: "sa_aaaaaaaa" } });
  const reads = { reads: true };

  // (fails before: yes — tasks knew no note: the action was refused by name)
  test("a note names whoever works on the task now, changes nothing in the graph, and keeps its words as written", () => {
    const long = `Lower case, never upper case.\n${"Because the reader is asleep. ".repeat(200)}`;
    const r = apply(running, { action: "note", id: "t1", note: `  ${long}  ` }, reads);
    assert.ok(r.ok);
    assert.deepEqual(r.note, { id: "t1", agent: "sa_aaaaaaaa", review: false, text: long.trim() });
    assert.equal(r.graph, running, "the graph as it was");
    assert.equal(r.changed, false);
    // A reviewer reading the task's change is who works on it then.
    const review = withTasks(added, { t1: { state: "review", step: "reading", agent: "sa_aaaaaaaa", reviewer: "sa_bbbbbbbb" } });
    const rv = apply(review, { action: "note", id: "t1", note: "Check the casing." }, reads);
    assert.ok(rv.ok);
    assert.deepEqual(rv.note, { id: "t1", agent: "sa_bbbbbbbb", review: true, text: "Check the casing." });
  });

  test("refused in words: no id or two, no words, no such task, and a task nobody works on now — each state with what to do instead", () => {
    /** @param {any} g @param {any} input */
    const why = (g, input) => {
      const r = apply(g, { action: "note", ...input }, reads);
      assert.equal(r.ok, false);
      return r.ok ? "" : r.error;
    };
    // A refusal of its shape ends with the call to copy, naming the task the call named (the Hunter on E40).
    const call = (/** @type {string} */ id) => `\nThe call: {"action":"note","id":"${id}","note":"what to do instead, and why"}`;
    assert.equal(why(running, { note: "x" }), `note needs id: the one task whose sub-agent reads your note${call("t2")}`);
    assert.equal(why(running, { ids: ["t1", "m1"], note: "x" }), `note needs id: the one task whose sub-agent reads your note${call("t1")}`);
    assert.equal(why(running, { id: "t1", note: "   " }), `note needs note: your line to the sub-agent working on the task — what to do instead, and why${call("t1")}`);
    assert.equal(why(running, { id: "zz", note: "x" }), "zz is no task in the graph");
    assert.equal(why(running, { id: "o1", note: "x" }), "nobody works on o1 now: it is your own task");
    assert.equal(why(running, { id: "m1", note: "x" }), "nobody works on m1 now: it has not started — put what you want into the task itself with tasks change, and its sub-agent starts with it");
    assert.equal(why(withTasks(added, { t1: { state: "waiting", stopped: true } }), { id: "t1", note: "x" }), "nobody works on t1 now: it was stopped — tasks start with its id and a note sends it on");
    assert.equal(why(withTasks(added, { t1: { state: "review", step: "asked", agent: "sa_aaaaaaaa" } }), { id: "t1", note: "x" }), "nobody works on t1 now: its review asked for changes, which go to its sub-agent next — send your note once it runs again");
    assert.equal(why(withTasks(added, { t1: { state: "merging", agent: "sa_aaaaaaaa" } }), { id: "t1", note: "x" }), "nobody works on t1 now: its sub-agent has ended, and its change is merging");
    assert.equal(why(withTasks(added, { t1: { state: "failed", agent: "sa_aaaaaaaa" } }), { id: "t1", note: "x" }), "nobody works on t1 now: it failed — send it back with a note: tasks start with its id and note");
    assert.equal(why(withTasks(added, { t1: { state: "done", agent: "sa_aaaaaaaa" } }), { id: "t1", note: "x" }), "nobody works on t1 now: it is done — plan what is missing as a new task");
  });

  // (fails before: no — a guard: who has no note is refused by the action's name, in today's words)
  test("an agent that does not read along, a coding agent and a team's lead have no note: the action is refused by name, in the words each had", () => {
    const note = { action: "note", id: "t1", note: "x" };
    for (const o of [{}, { reads: false }, { reads: true, solo: true }]) {
      const r = apply(running, note, o);
      assert.deepEqual([r.ok, !r.ok && r.error], [false, `action must be one of ${TASK_ACTIONS.join(", ")}\n${TASK_CALLS.show} reads the graph; ${TASK_CALLS.add} starts one.`], JSON.stringify(o));
    }
    const lead = apply(null, note, { crew: TEAM.members, reads: true });
    assert.ok(!lead.ok && lead.error.startsWith("action must be one of ") && !lead.error.includes("note"), lead.ok ? "" : lead.error);
  });

  // (fails before: yes — a show of one task said nothing of who works on it)
  test("a show of one task says who works on it now, to the agent that reads along alone; and the change a show reads is its sub-agent's while it runs or its change is read", () => {
    const shown = apply(running, { action: "show", id: "t1" }, reads);
    const plain = apply(running, { action: "show", id: "t1" });
    assert.ok(shown.ok && plain.ok);
    const [head, ...rest] = plain.text.split("\n");
    assert.equal(shown.text, [head, "At work now: sub-agent sa_aaaaaaaa — tasks note with this id reaches it at its next step", ...rest].join("\n"));
    const review = withTasks(added, { t1: { state: "review", step: "reading", agent: "sa_aaaaaaaa", reviewer: "sa_bbbbbbbb" } });
    const read = apply(review, { action: "show", id: "t1" }, reads);
    assert.ok(read.ok && read.text.split("\n")[1] === "At work now: its reviewer sa_bbbbbbbb — tasks note with this id reaches it at its next step", read.ok ? read.text : "");
    const whole = apply(running, { action: "show" }, reads);
    assert.deepEqual(whole.ok && whole.text, apply(running, { action: "show" }).ok && /** @type {any} */ (apply(running, { action: "show" })).text, "the whole graph reads as it did");
    assert.deepEqual([changeOf(running, "t1"), changeOf(running, "T1 "), changeOf(review, "t1")], ["sa_aaaaaaaa", "sa_aaaaaaaa", "sa_aaaaaaaa"]);
    assert.deepEqual([changeOf(running, "m1"), changeOf(running, "o1"), changeOf(running, "zz"), changeOf(null, "t1"), changeOf(withTasks(added, { t1: { state: "done", agent: "sa_aaaaaaaa" } }), "t1")], [null, null, null, null, null]);
  });

  test("a task's end names the note its sub-agent never read, to the agent that sent it", () => {
    assert.equal(unreadWords([]), "");
    assert.equal(unreadWords(undefined), "");
    assert.equal(unreadWords(["Lower case."]), "\n\nIt ended without reading your message, so neither its work nor this report takes it into account:\n- Lower case.");
    assert.equal(unreadWords(["a", "b"]), "\n\nIt ended without reading 2 messages of yours, so neither its work nor this report takes them into account:\n- a\n- b");
  });
});

describe("a look at the graph's sub-agents (TG2-D31, D33)", () => {
  /** A turn's looks over one sub-agent whose run log the test writes. @param {{ who?: any }} [o] */
  const bench = ({ who } = {}) => {
    /** @type {any[]} */
    const log = [];
    const w = { id: "sa_1", role: "sub-agent", description: "t1: Write the quiet note", task: "t1", run: "run-1", head: ["round 1"], mark: newMark() };
    const looks = createLooks({ now: () => 1_000_000, later: () => {}, seconds: () => 0, lean: false, ...(who ? { who } : {}), workers: () => [w], eventsOf: () => log, wake: () => {} });
    return {
      looks,
      /** @param {any} e */
      log(e) {
        const evt = { n: log.length + 1, ts: 1_000_000, ...e };
        log.push(evt);
        if (noted(w.mark, evt, null)) looks.ring();
      },
    };
  };
  const round1 = [
    { type: "round-start", round: 1 },
    { type: "round-text", round: 1, text: "PLAN: read a.txt, then write note.txt." },
    { type: "tool-start", round: 1, id: "c1", name: "read", args: "a.txt", card: { kind: "read", subject: "a.txt" } },
  ];

  // (fails before: yes — a look said "your workers" to an agent that has none, and named a task's id twice)
  test("it says sub-agents, names the task once, and counts the agent's note as the reader's own message", () => {
    const b = bench({ who: "sub-agents" });
    for (const e of round1) b.log(e);
    const first = b.looks.take();
    assert.ok(first);
    assert.ok(first.text.startsWith('[Filament: a look at your sub-agents. 1 is running.]\n\n## sub-agent sa_1 — task t1: "Write the quiet note"\n'), first.text);
    assert.equal(lookOf(first.text), "sub-agents");
    b.log({ type: "tool-end", round: 1, id: "c1", ok: true });
    b.log({ type: "steer", id: "m1", kind: "note", text: "Lower case.", from: "agent", at: 1 });
    b.log({ type: "steer-read", ids: ["m1"], kinds: ["note"] });
    b.log({ type: "round-start", round: 2 });
    b.log({ type: "round-text", round: 2, text: "Understood: lower case." });
    b.log({ type: "tool-start", round: 2, id: "c2", name: "write", args: "note.txt", card: { kind: "write", subject: "note.txt" } });
    const second = b.looks.take();
    assert.ok(second);
    assert.ok(second.text.startsWith("[Filament: a look at your sub-agents, in place of the one before. Since it: 1 moved, 0 did not.]"), second.text);
    assert.ok(second.text.includes('Read your message at the end of this round: "Lower case."'), second.text);
    // A team's lead's look still says workers.
    const lead = bench();
    for (const e of round1) lead.log(e);
    assert.ok(lead.looks.take()?.text.startsWith("[Filament: a look at your workers. 1 is running.]"));
  });

  // (fails before: yes — an older look at sub-agents stayed whole, and a patch a tasks show brought stayed for good)
  test("of the agent's looks the newest stays whole, in their noun; and of the change so far a tasks show brought, the newest — the task's own lines stay", () => {
    const look = (/** @type {string} */ body) => ({ type: "text", text: `[Filament: a look at your sub-agents. 1 is running.]\n\n${body}` });
    const patch = (/** @type {string} */ body) => `[Filament: the change so far of sa_1, against where it started: 1 file. It stays until you ask for it again.]\n\n${body}`;
    const shown = (/** @type {string} */ id, /** @type {string} */ body) => ({ type: "tool_result", tool_use_id: id, content: `t1 "Write the quiet note" · running\nAt work now: sub-agent sa_1\n\n${patch(body)}` });
    const asks = (/** @type {string} */ id, name = "tasks") => ({ role: "assistant", content: [{ type: "tool_use", id, name, input: { action: "show", id: "t1" } }] });
    const convo = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      asks("s1"),
      { role: "user", content: [shown("s1", "+HELLO"), look("round 1")] },
      asks("r1", "read"),
      // Another tool's result that happens to hold the same words is nobody's patch.
      { role: "user", content: [{ type: "tool_result", tool_use_id: "r1", content: `a file\n\n${patch("+quoted")}` }] },
      asks("s2"),
      { role: "user", content: [shown("s2", "+hello"), look("round 2")] },
    ];
    const before = structuredClone(convo);
    const kept = withoutLooks(convo);
    tidyLooks(convo, { from: 0, own: 1 });
    const stub = 't1 "Write the quiet note" · running\nAt work now: sub-agent sa_1\n\n[Filament: the change so far of sa_1 was here. A newer one replaces it.]';
    assert.deepEqual(convo[2].content, [{ type: "tool_result", tool_use_id: "s1", content: stub }, { type: "text", text: lookStub("sub-agents") }]);
    assert.deepEqual(convo[4], before[4], "a read's result is left as it is");
    assert.deepEqual(convo[6], before[6], "the newest show and the newest look whole");
    assert.equal(lookStub("sub-agents"), "[Filament: a look at your sub-agents was here. The newest one replaces it.]");
    // What the session keeps of the turn: a line where each was.
    const gone = stub.replace(". A newer one replaces it", ", while it ran");
    assert.deepEqual(kept[2].content, [{ type: "tool_result", tool_use_id: "s1", content: gone }, { type: "text", text: lookGone("sub-agents") }]);
    assert.deepEqual(kept[6].content, [{ type: "tool_result", tool_use_id: "s2", content: gone }, { type: "text", text: lookGone("sub-agents") }]);
    assert.deepEqual(kept[4], before[4]);
    assert.equal(lookGone("sub-agents"), "[Filament: a look at your sub-agents was here, while they ran. Their reports are what is kept.]");
  });
});

// ---- on the live app -------------------------------------------------------------------------------------------------

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;

/** What the note's sub-agent says before its first call: its plan, which the task's goal does not ask for. */
const PLAN = "PLAN: I will shout the greeting in upper case.";
const MAP_PLAN = "PLAN: I will list every file, then report.";
/** The agent's note to the sub-agent at work on its task, and the block that sub-agent's loop reads it in. */
const STEER = "Lower case, never upper case.";
const LATE = "Name the folders too.";
const blockOf = (/** @type {string} */ told) => `${AGENT_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${told}`;
const DONE = (/** @type {string} */ did, /** @type {string} */ evidence) => ({ status: "done", did, met: true, evidence });

/** A door the script holds a reply behind until the other side has acted. */
const gate = () => {
  /** @type {() => void} */
  let open = () => {};
  const passed = /** @type {Promise<void>} */ (new Promise((res) => (open = res)));
  return { open, passed };
};
/** @type {Record<string, ReturnType<typeof gate>>} */
let gates = {};
/** What the agent's script saw while a sub-agent's reply was held. @type {any} */
let seen = {};
let calls = 0;

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** Every text a request's messages hold, a tool result's included. @param {any} body */
const textsIn = (body) => {
  /** @type {string[]} */
  const out = [];
  for (const m of body?.messages || [])
    for (const b of Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }]) {
      if (b?.type === "text") out.push(String(b.text));
      else if (b?.type === "tool_result") out.push(textOf(b.content));
    }
  return out;
};
/** The task a graph sub-agent's request works on, from its brief; "" for the agent's own. @param {any} body */
const taskOf = (body) => /Your task: (\S+) — /.exec(textsIn({ messages: (body?.messages || []).slice(0, 1) }).join("\n"))?.[1] ?? "";
const isAgent = (/** @type {any} */ c) => !taskOf(c.body) && (c.body?.tools || []).some((/** @type {any} */ t) => t.name === "ask");
const isTask = (/** @type {any} */ c) => !!taskOf(c.body);
/** The looks a request shows whole. @param {any} body */
const looksIn = (body) => textsIn(body).filter((t) => lookOf(t) === "sub-agents" && !t.startsWith("[Filament: a look at your sub-agents was here"));
/** What a tool call answered in a request: the text of the tool_result for `id`, or null. @param {any} body @param {string} id */
const resultIn = (body, id) => {
  for (const m of body?.messages || [])
    for (const b of Array.isArray(m.content) ? m.content : []) if (b?.type === "tool_result" && b.tool_use_id === id) return textOf(b.content);
  return null;
};
/** @param {any} body @param {string} name */
const toolOf = (body, name) => (body.tools || []).find((/** @type {any} */ t) => t.name === name);
/** The end of a task as the graph tells it to the agent, where a request holds one. @param {any} body @param {string} id */
const toldIn = (body, id) => textsIn(body).find((t) => t.startsWith(`[Filament: task ${id} "`)) ?? null;
/**
 * The worker whose change the graph told ready in a request and whose apply the agent has not asked yet (the owner's of
 * 11-02): its id, or null. @param {any} body @param {string} id
 */
const readyIn = (body, id) => {
  const ready = textsIn(body).find((t) => t.startsWith(`[Filament: task ${id} "`) && t.includes(" is ready: "));
  const sa = ready ? /apply it when you choose — agent with agent_id "(sa_[0-9a-f]{8})" and apply_changes: true/.exec(ready)?.[1] : null;
  return sa && resultIn(body, `toolu_apply_${sa}`) == null ? sa : null;
};
/** Whether the graph told the task done in a request. @param {any} body @param {string} id */
const doneIn = (body, id) => textsIn(body).some((t) => t.startsWith(`[Filament: task ${id} "`) && / is done: /.test(t));

describe("the agent reads along with its graph's sub-agents, on the live app", () => {
  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-lead-graph-"));
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(folder, "a.txt"), "one\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const all = JSON.stringify(b.messages || []);
      const model = String(b.model || "");
      const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
      const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
      const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
      const wait = () => use(`toolu_wait_${++calls}`, "wait", { seconds: 60 });
      const progress = async () => (await (await shim.api(`/api/sessions/${encodeURIComponent(seen.session)}/subagents`)).json()).subagents?.[0]?.progress?.lead;
      const task = taskOf(b);
      if (task === "t1") {
        // The note's sub-agent says its plan and reads; its second request is here before the agent sends its note, and
        // its reply is held until the note is sent, so the note is what its third request reads; its report is held
        // until the agent has asked for its change.
        if (resultIn(b, "toolu_w_report") != null) return say("Reported.");
        if (resultIn(b, "toolu_w_note") != null) {
          gates.wrote.open();
          await gates.shown.passed;
          return use("toolu_w_report", "report", DONE("note.txt written in lower case, as the agent said.", "note.txt holds hello"));
        }
        if (all.includes(STEER)) return blocks([{ type: "text", text: "Understood: lower case." }, { type: "tool_use", id: "toolu_w_note", name: "write", input: { path: "note.txt", content: "hello\n" } }], "tool_use");
        if (resultIn(b, "toolu_w_a") == null) return blocks([{ type: "text", text: PLAN }, { type: "tool_use", id: "toolu_w_a", name: "read", input: { path: "a.txt" } }], "tool_use");
        gates.asked.open();
        await gates.steered.passed;
        return use(`toolu_w_again_${++calls}`, "read", { path: "a.txt" });
      }
      if (task === "m1") {
        // The explorer under a note that comes late: its last reply is in flight when the agent sends it.
        if (all.includes(LATE)) return say("Heard: the folders too. There are none.");
        if (resultIn(b, "toolu_m_report") != null) {
          gates.last.open();
          await gates.noted.passed;
          return say("Reported.");
        }
        if (resultIn(b, "toolu_m_glob") != null) return use("toolu_m_report", "report", DONE("a.txt is the one file here.", "glob * lists a.txt"));
        return blocks([{ type: "text", text: MAP_PLAN }, { type: "tool_use", id: "toolu_m_glob", name: "glob", input: { pattern: "*" } }], "tool_use");
      }
      if (task === "p1") return resultIn(b, "toolu_p_report") != null ? say("Reported.") : use("toolu_p_report", "report", DONE("a.txt is the one file here.", "glob * lists a.txt"));
      if (!isAgent(call)) return say("MODEL ANSWER");
      // The agent that reads along: it plans one task for a sub-agent and waits; the look shows the plan, so it sends a
      // note; a later look shows the write, so it asks for the change so far; then the task's end — it tries one note
      // more, which nobody is there to read.
      if (all.includes("quiet note, please")) {
        if (all.includes("what happened?")) return say("AGENT ANSWER");
        // Its change ready, the agent applies it (the owner's of 11-02); once it is done, it tries one note more.
        const ready = readyIn(b, "t1");
        if (ready) return use(`toolu_apply_${ready}`, "agent", { agent_id: ready, apply_changes: true });
        if (doneIn(b, "t1")) return resultIn(b, "toolu_gone") != null ? say("AGENT DONE: note.txt is in, lower case.") : use("toolu_gone", "tasks", { action: "note", id: "t1", note: "One more thing." });
        if (toldIn(b, "t1")) return wait();
        if (resultIn(b, "toolu_add") == null) return use("toolu_add", "tasks", { action: "add", goal: "A quiet note", tasks: [QUIET] });
        if (resultIn(b, "toolu_show") != null) {
          gates.shown.open();
          return wait();
        }
        if (resultIn(b, "toolu_note") != null) {
          seen.sent ||= await progress();
          gates.steered.open();
          if (!looksIn(b).some((t) => t.includes("Called write"))) return wait();
          await gates.wrote.passed;
          seen.read = await progress();
          return use("toolu_show", "tasks", { action: "show", id: "t1" });
        }
        if (!all.includes(PLAN)) return wait();
        // Sent once the sub-agent's next request is out: one sent while its first round still ran would be read in that
        // request, and its progress would never show the note sent and not yet read.
        await gates.asked.passed;
        return use("toolu_note", "tasks", { action: "note", id: "t1", note: STEER });
      }
      // The note that comes late.
      if (all.includes("map it, please")) {
        if (toldIn(b, "m1")) return say("AGENT HEARD");
        if (resultIn(b, "toolu_madd") == null) return use("toolu_madd", "tasks", { action: "add", goal: "Know the folder", tasks: [MAP] });
        if (resultIn(b, "toolu_late") != null) {
          gates.noted.open();
          return wait();
        }
        if (!all.includes(MAP_PLAN)) return wait();
        await gates.last.passed;
        return use("toolu_late", "tasks", { action: "note", id: "m1", note: LATE });
      }
      // The agent whose session has the switch off: version 18's flow.
      if (toldIn(b, "p1")) return say("AGENT HEARD, UNWATCHED");
      if (resultIn(b, "toolu_padd") == null) return use("toolu_padd", "tasks", { action: "add", goal: "Know the folder", tasks: [{ ...MAP, id: "p1" }] });
      return say("Waiting for the graph.");
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(folder, shim.dataDir);
  });

  /** A harness session in the repository, the graph on: reading along is a session's default. @param {any} [engine] */
  const newSession = async (engine = {}) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "agent/brain-model", preset: "plain", settings: { engine: { lookSeconds: 0, ...engine }, subagents: { pool: [{ model: "", seats: 1 }] } } } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** One harness turn, answered whole. @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { stream: false, content } });
    assert.equal(r.status, 200, await r.clone().text());
    return { text: textOf((await r.json()).content), id: String(r.headers.get("x-filament-request-id")) };
  };
  /** A run's events so far, through the run's route. @param {string} runId */
  const runEvents = async (runId) => /** @type {any[]} */ ((await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=2000`)).json()).events || []);

  // (fails before: yes — the agent heard a task's end and nothing before it: the sub-agent wrote HELLO, as it had
  // planned, and the agent learned of it from the report)
  test("its wait ends on a look at the sub-agent's plan, its tasks note reaches the sub-agent before its first change, a show of the task ends with the change so far, and a note once the task is done is refused in words", async () => {
    gates = { asked: gate(), steered: gate(), wrote: gate(), shown: gate() };
    seen = {};
    const id = await newSession();
    seen.session = id;
    const mark = up.received.length;
    const t = await turn(id, "quiet note, please");
    assert.ok(t.text.endsWith("AGENT DONE: note.txt is in, lower case."), t.text);
    const reqs = up.received.slice(mark);
    const agent = reqs.filter(isAgent);
    const sub = reqs.filter(isTask);

    // The words and the tools: the agent's graph section says how it reads along; its tasks has note.
    assert.ok(sysOf(agent[0].body).includes(String(PROMPT.graphLooks)), sysOf(agent[0].body));
    assert.equal(toolOf(agent[0].body, "tasks").description, TOOL_TEXT.tasksReads);
    assert.ok(toolOf(agent[0].body, "tasks").input_schema.properties.action.enum.includes("note"));
    assert.equal(toolOf(agent[0].body, "wait").description, TOOL_TEXT.waitReads);
    const subSystem = sysOf(sub[0].body);
    assert.ok(subSystem.includes(String(PROMPT.taskReadAlong)) && subSystem.includes(String(PROMPT.taskAmbiguity)) && subSystem.includes(String(PROMPT.workerGoOn)), subSystem);
    assert.ok(!/nobody can answer a question from you mid-task/i.test(subSystem), "the agent can");

    // The first look: the wait ended on it, and it shows the plan in the sub-agent's own words, under its sign.
    const first = agent.find((c) => looksIn(c.body).some((l) => l.includes(PLAN)));
    assert.ok(first, "a look showed the plan");
    const [look] = looksIn(first.body);
    assert.ok(look.startsWith("[Filament: a look at your sub-agents. 1 is running.]"), look);
    assert.match(look, /\n## sub-agent sa_[0-9a-f]{8} — task t1: "Write the quiet note"\n/);
    assert.ok(look.includes("sign: said how it will go about its task") && look.includes(`Round 1\nSaid: ${PLAN}\nCalled read \`a.txt\``), look);
    assert.ok(textsIn(first.body).some((x) => /^Waited \d+ s: your sub-agents moved\. A look follows as a message\.$/.test(x)), textsIn(first.body).join("\n---\n"));

    // The note: sent at once, read at the sub-agent's next step, before its first change — it wrote lower case.
    const told = agent.find((c) => resultIn(c.body, "toolu_note") != null);
    assert.match(String(resultIn(told?.body, "toolu_note")), /^Sent to sub-agent sa_[0-9a-f]{8}, at work on t1: it reads your note at its next step\. Your next look shows whether it has\.$/);
    const wrote = sub.findIndex((c) => resultIn(c.body, "toolu_w_note") != null);
    const heard = sub.findIndex((c) => textsIn(c.body).some((x) => x.includes(blockOf(STEER))));
    assert.ok(heard > 0 && heard < wrote, `the note came before the write: ${heard} < ${wrote}`);
    assert.ok(!JSON.stringify(sub[heard].body.messages).includes("toolu_w_note"), "nothing was written when it read the note");
    assert.equal(readFileSync(join(folder, "note.txt"), "utf8"), "hello\n", "applied by the agent, merged as steered");
    assert.deepEqual([seen.sent, seen.read], [{ read: 0, unread: 1 }, { read: 1, unread: 0 }], "the sub-agent's progress says whether it has read the agent's note");
    assert.ok(agent.some((c) => looksIn(c.body).some((l) => l.includes(`Read your message at the end of this round: "${STEER}"`))), "a look showed the note read");

    // The later look, in place of the one before; and the show of the task: its own lines, who works on it, and the
    // change so far as a patch.
    const later = agent.find((c) => looksIn(c.body).some((l) => l.includes("Called write")));
    assert.ok(later, "a look showed the write");
    assert.equal(looksIn(later.body).length, 1, "one look whole");
    assert.ok(looksIn(later.body)[0].startsWith("[Filament: a look at your sub-agents, in place of the one before. Since it: 1 moved, 0 did not.]"), looksIn(later.body)[0]);
    assert.ok(textsIn(later.body).includes(lookStub("sub-agents")), "a line where the older look was");
    const shown = String(resultIn(agent.find((c) => resultIn(c.body, "toolu_show") != null)?.body, "toolu_show"));
    // Where its worker works, as its launch chose (11-09).
    assert.match(shown, /^t1 "Write the quiet note" — running on (sa_[0-9a-f]{8}), in a patch of its own · by sub-agent · writes note\.txt\nAt work now: sub-agent \1 — tasks note with this id reaches it at its next step\n/);
    assert.match(shown, /\nAcceptance: note\.txt holds the greeting\n\n\[Filament: the change so far of sa_[0-9a-f]{8}, against where it started: 1 file\. It stays until you ask for it again\.\]\n\n- note\.txt \(\+1 −0\)\n\n/);
    assert.ok(shown.includes("+hello"), shown);

    // The task's end, and the note nobody is there to read.
    const ended = agent.find((c) => resultIn(c.body, "toolu_gone") != null);
    assert.ok(doneIn(ended?.body, "t1"), "the graph told the task's end");
    assert.ok(String(resultIn(ended?.body, "toolu_gone")).includes("nobody works on t1 now: it is done — plan what is missing as a new task"), String(resultIn(ended?.body, "toolu_gone")));

    // The record and the run log.
    const rec = await shim.record(t.id);
    assert.equal(rec.agent?.supervise, true);
    assert.ok(rec.changes.includes("agent: the agent reads along with the sub-agents of its task graph (engine.supervise): Filament shows it a look at them at once on a sign, else whenever something is new (engine.lookSeconds), and its tasks note reaches the one at work on a task"), rec.changes.join("\n"));
    assert.ok((await runEvents(t.id)).filter((e) => e.type === "look").length >= 2, "each look is in the agent's run");
    // What it was shown is said of the agent and its sub-agents, never of a lead and its workers.
    assert.ok(rec.changes.some((c) => /^agent: the agent was shown \d+ looks? at its sub-agents; its conversation kept the newest whole while they ran/.test(c)), rec.changes.join("\n"));
    assert.ok(!rec.changes.some((c) => /the lead|its workers/.test(c)), rec.changes.join("\n"));

    // The next turn: a line where each look and the patch were, and no word of the sub-agent's trail.
    const from = up.received.length;
    assert.equal((await turn(id, "what happened?")).text, "AGENT ANSWER");
    const [next] = up.received.slice(from).filter(isAgent);
    const kept = textsIn(next.body);
    assert.ok(kept.includes(lookGone("sub-agents")) && kept.some((x) => /\n\n\[Filament: the change so far of sa_[0-9a-f]{8} was here, while it ran\.\]$/.test(x)), kept.join("\n---\n"));
    assert.ok(!kept.some((x) => x.includes(PLAN) || x.includes("Called write") || x.includes("+hello")), kept.join("\n---\n"));
    assert.deepEqual(looksIn(next.body), [], "no look whole");
  });

  // (fails before: no — a guard: a sub-agent's loop reads its mail before its run ends, so a note is lost to no race;
  // the end that names a note unread — a run that failed or was stopped over it — is the graph runner's own test)
  test("a note sent while the sub-agent's last reply is in flight still reaches it: its run reads its mail before it ends, and the task's end names no note unread", async () => {
    gates = { last: gate(), noted: gate() };
    const id = await newSession();
    const mark = up.received.length;
    const t = await turn(id, "map it, please");
    assert.ok(t.text.endsWith("AGENT HEARD"), t.text);
    const reqs = up.received.slice(mark);
    const agent = reqs.filter(isAgent);
    assert.match(String(resultIn(agent.find((c) => resultIn(c.body, "toolu_late") != null)?.body, "toolu_late")), /^Sent to sub-agent sa_[0-9a-f]{8}, at work on m1: /);
    const sub = reqs.filter(isTask);
    const heard = sub.find((c) => textsIn(c.body).some((x) => x.includes(blockOf(LATE))));
    assert.ok(heard && resultIn(heard.body, "toolu_m_report") != null, "it read the note after its report, before its run ended");
    const end = toldIn(agent.find((c) => toldIn(c.body, "m1"))?.body, "m1");
    assert.ok(end && !end.includes("It ended without reading"), String(end));
  });

  // (fails before: no — a guard: the switch off is version 18's agent)
  test("with engine.supervise off the agent is version 18's: no word of a look, tasks without note, a sub-agent nobody answers, and no look", async () => {
    const id = await newSession({ supervise: false });
    const mark = up.received.length;
    const t = await turn(id, "map it, unwatched");
    assert.ok(t.text.endsWith("AGENT HEARD, UNWATCHED"), t.text);
    const reqs = up.received.slice(mark);
    const agent = reqs.filter(isAgent);
    assert.ok(sysOf(agent[0].body).includes(String(PROMPT.graphSubagents)) && !sysOf(agent[0].body).includes(String(PROMPT.graphLooks)));
    assert.equal(toolOf(agent[0].body, "tasks").description, TOOL_TEXT.tasks);
    assert.ok(!toolOf(agent[0].body, "tasks").input_schema.properties.action.enum.includes("note"));
    assert.equal(toolOf(agent[0].body, "wait").description, TOOL_TEXT.wait);
    assert.ok(sysOf(reqs.filter(isTask)[0].body).includes(PROMPT.taskReport));
    for (const c of agent) assert.deepEqual(textsIn(c.body).filter((x) => lookOf(x) !== null), [], "no look");
    const rec = await shim.record(t.id);
    assert.ok(!rec.agent?.supervise && rec.changes.includes("agent: the agent does not read along with its graph's sub-agents (engine.supervise is off, or Filament keeps no run log here): it hears each task's end"), rec.changes.join("\n"));
    assert.deepEqual((await runEvents(t.id)).filter((e) => e.type === "look"), []);
  });
});
