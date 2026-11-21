// @ts-check
// HarnessV4_TaskGraphPlus_Plan E41 P1, the owner's words of 10-25: "Make the graph the agent's working memory, for every
// agent. At each turn's start and after any compaction, give a short "where you are": the running task, its last
// checkpoint note, what's ready next, what's blocked. Coding agents included. This fits into E36 (checkpoints)". E36
// (HarnessV4_Checkpoints_Plan), the owner's words of 10-24: a running task paused with a checkpoint — where it stood,
// what was next — kept behind it, "so that next time when you come back to that node you have all the information
// ready for you"; and what lands mid-turn names the task it came during, and how to pause it first. Nothing pauses by
// itself, and nothing nudges mid-work (GX-D1): Filament only says where things stand where it already speaks.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRAPH_TOOL, givenTools, promptFor } from "../src/adapters/agents/context.js";
import { WHERE_BLOCK, whereBlock } from "../src/app/agent-context.js";
import { createAgentInbox } from "../src/app/agent-inbox.js";
import { createLaunchTurn } from "../src/app/agent-launch.js";
import { createGraphNotes } from "../src/app/agent/graph-notes.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { PROMPT, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_TOOL, toolSetFor } from "../src/app/agent/tools.js";
import { backAfterSummary } from "../src/app/sessions/reattach.js";
import { LEAD_ACTIONS, TASK_ACTIONS, TASK_CALLS, WHERE_ROOM, applyTasks, asMeant, endHeard, graphView, onTaskText, ownWorkText, turnBegun, whereText } from "../src/core/task-graph.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { createTaskNotes } from "../src/services/task-notes.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

const T0 = Date.UTC(2026, 9, 25, 9, 30);
/** A time as Filament's words give it: the hour and minute, on this machine's clock. @param {number} at */
const hhmm = (at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const ADD = { action: "add", goal: "Fix the parser", tasks: [{ id: "t1", name: "Find the bug" }, { id: "t2", name: "Fix it", needs: ["t1"] }, { id: "t3", name: "Write the docs" }, { id: "t4", name: "Ship it", needs: ["t2", "t3"] }] };
const WORDS = "Read parse.js to line 80: the tokenizer drops a quote.\nNext: the tokenizer's tests. Re-read test/parse.test.js first.";
const AGENT = { crew: /** @type {const} */ ("agent") };
/** @param {number} [at] */
const at = (at = T0) => ({ at, crew: /** @type {const} */ ("agent") });
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @returns {string} */
const no = (r) => (assert.ok(!r.ok, JSON.stringify(r)), r.error);
/** A graph walked through calls, each a minute after the last. @param {any[]} calls */
const walk = (calls) => calls.reduce((g, c, k) => ok(applyTasks(g, c, at(T0 + k * 60_000))).graph, /** @type {any} */ (null));
/** @param {any} g @param {string} id */
const taskOf = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);

/** @type {string[]} */
const made = [];
const tempDir = (/** @type {string} */ name) => {
  const d = mkdtempSync(join(tmpdir(), `filament-graph-memory-${name}-`));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("a task paused with its checkpoint, and started again (E36 cases 1–6, 8)", () => {
  // (fails before: yes — a task was waiting, running, done or dropped: nothing kept where it stood when it was left)
  test("a running task pauses with its checkpoint, kept behind it as a note; the graph says it is paused", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }]);
    const when = T0 + 5 * 60_000;
    const r = ok(applyTasks(g, { action: "pause", id: "t1", checkpoint: WORDS }, at(when)));
    const title = `Checkpoint 1 · ${hhmm(when)}`;
    assert.deepEqual([taskOf(r.graph, "t1").state, taskOf(r.graph, "t1").checkpoint, taskOf(r.graph, "t1").startedAt], ["paused", { n: 1, title, at: when }, T0 + 60_000]);
    assert.deepEqual(r.notes, { kind: "keep", task: "t1", graph: g.startedAt, title, text: WORDS, files: [], picture: "", forget: [], from: 0 }, "the runner keeps it behind the task");
    assert.ok(r.text.startsWith(`Paused t1 with its checkpoint 1, kept behind it as the note "${title}". Its needs and writes may change while it waits: the work that came in goes in as tasks it needs. tasks start with id t1 starts it again, its checkpoint with it.`), r.text);
    assert.equal(graphView(r.graph)?.counts.paused, 1);
    assert.ok(TASK_ACTIONS.includes("pause") && !LEAD_ACTIONS.includes("pause"), "a lead plans its workers' tasks: it pauses none of its own");
  });

  // (fails before: yes — there was no pause to refuse)
  test("refused in words: no checkpoint, one that is not running, one paused already, a sub-agent's, a command task, two at once", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }]);
    assert.equal(no(applyTasks(g, { action: "pause", id: "t1" }, at())), `pause needs checkpoint: where the task stands — what is done, what is next, what to re-read — so you can come back to it\nThe call: {"action":"pause","id":"t1","checkpoint":"where it stands: what is done, what is next, what to re-read"}`);
    assert.equal(no(applyTasks(g, { action: "pause", id: "t1", checkpoint: "  " }, at())).split("\n")[0], "pause needs checkpoint: where the task stands — what is done, what is next, what to re-read — so you can come back to it");
    assert.equal(no(applyTasks(g, { action: "pause", id: "t2", checkpoint: "x" }, at())), "t2 is waiting: only a running task is paused");
    assert.equal(no(applyTasks(g, { action: "pause", id: "t9", checkpoint: "x" }, at())), "t9 is no task in the graph");
    assert.match(no(applyTasks(g, { action: "pause", ids: ["t1", "t3"], checkpoint: "x" }, at())), /^pause takes one task at a time, each with its own checkpoint/);
    const paused = ok(applyTasks(g, { action: "pause", id: "t1", checkpoint: "x" }, at(T0))).graph;
    assert.equal(no(applyTasks(paused, { action: "pause", id: "t1", checkpoint: "y" }, at())), `t1 is paused already, with its checkpoint 1 (${hhmm(T0)}) — start it to go on, or keep more behind it (tasks keep)`);
    const sub = walk([{ action: "add", goal: "G", tasks: [{ id: "s1", name: "Map it", by: "explorer", goal: "A map", steps: ["Read"], acceptance: "A map" }, { id: "c1", name: "Mutants", by: "command", run: ["node -v"] }] }]);
    assert.match(no(applyTasks(sub, { action: "pause", id: "s1", checkpoint: "x" }, at())), /^s1 is an explorer's task: its report ends it/);
    assert.match(no(applyTasks(sub, { action: "pause", id: "c1", checkpoint: "x" }, at())), /^c1 is a command task: Filament's runs end it/);
    assert.match(no(applyTasks(g, { action: "pause", id: "t1", checkpoint: "x".repeat(200_001) }, at())), /^checkpoint is 200,001 characters: 200,000 at most/);
  });

  // (fails before: yes — a running task's needs never changed, so what came in could not go before it)
  test("while it is paused its needs change: the new work goes before it, and it starts again once that is done, from its checkpoint", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }, { action: "pause", id: "t1", checkpoint: WORDS }, { action: "add", tasks: [{ id: "h1", name: "Fix the Hunter's find" }] }, { action: "change", tasks: [{ id: "t1", needs: ["h1"] }] }]);
    assert.deepEqual(taskOf(g, "t1").needs, ["h1"]);
    assert.equal(no(applyTasks(g, { action: "start", ids: ["t1"] }, at())), "t1 can't start yet: it needs h1 (waiting) done first");
    const h1 = ok(applyTasks(g, { action: "start", ids: ["h1"] }, at(T0 + 10 * 60_000))).graph;
    const h = ok(applyTasks(h1, { action: "done", id: "h1", summary: "Fixed." }, at(T0 + 11 * 60_000))).graph;
    const back = ok(applyTasks(h, { action: "start", ids: ["t1"] }, at(T0 + 12 * 60_000)));
    assert.ok(back.text.startsWith(`Started t1 again, from its checkpoint 1 (${hhmm(T0 + 2 * 60_000)}).`), back.text);
    assert.deepEqual([taskOf(back.graph, "t1").state, taskOf(back.graph, "t1").startedAt], ["running", T0 + 60_000], "it keeps when it first started");
    const twice = ok(applyTasks(back.graph, { action: "pause", id: "t1", checkpoint: "Second stop." }, at(T0 + 13 * 60_000)));
    assert.deepEqual(taskOf(twice.graph, "t1").checkpoint, { n: 2, title: `Checkpoint 2 · ${hhmm(T0 + 13 * 60_000)}`, at: T0 + 13 * 60_000 }, "each pause writes the next");
  });

  // (fails before: yes — a paused task could not be done; there was none)
  test("a paused task is done from where it stands; a close drops it with the close's reason; given to a sub-agent it waits for one", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }, { action: "pause", id: "t1", checkpoint: WORDS }]);
    assert.equal(taskOf(ok(applyTasks(g, { action: "done", id: "t1", summary: "Found it." }, at())).graph, "t1").state, "done");
    const closed = ok(applyTasks(g, { action: "close", reason: "Moved to v2." }, at()));
    assert.deepEqual([taskOf(closed.graph, "t1").state, taskOf(closed.graph, "t1").why], ["dropped", "closed: Moved to v2."]);
    const given = ok(applyTasks(g, { action: "change", tasks: [{ id: "t1", by: "sub-agent", goal: "Find it", steps: ["Read"], acceptance: "Found", writes: ["src/parse.js"] }] }, at())).graph;
    assert.equal(taskOf(given, "t1").state, "waiting", "the pause was the planner's own");
  });

  // (fails before: yes — the words had no pause)
  test("said another way, it is a pause; its card says which task and where it stands; the tool's words and fields say it", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }]);
    /** A call as the runner reads it first (E40). @param {any} c */
    const read = (c) => asMeant(c, AGENT).input;
    for (const word of ["hold", "suspend", "park"]) assert.equal(taskOf(ok(applyTasks(g, read({ action: word, id: "t1", checkpoint: "x" }), at())).graph, "t1").state, "paused", word);
    assert.deepEqual(asMeant({ action: "pause", id: "t1", note: "x" }, AGENT), { input: { action: "pause", id: "t1", checkpoint: "x" }, said: ["note as checkpoint"] });
    const p = ok(applyTasks(g, { action: "pause", id: "t1", checkpoint: "x" }, at())).graph;
    for (const word of ["resume", "continue"]) assert.equal(taskOf(ok(applyTasks(p, read({ action: word, ids: ["t1"] }), at())).graph, "t1").state, "running", word);
    assert.deepEqual(cardOf("tasks", { action: "pause", id: "t1", checkpoint: "Line 80, the tokenizer next" }), { kind: "tasks", title: "Pause a task", subject: "t1: Line 80, the tokenizer next" });
    assert.equal(JSON.parse(TASK_CALLS.pause).action, "pause");
    for (const tool of [TASKS_TOOL, CODER_TASKS_TOOL]) {
      assert.ok(tool.input_schema.properties.action.enum.includes("pause"));
      assert.match(String(/** @type {any} */ (tool.input_schema.properties).checkpoint?.description), /^pause: where the task stands/);
    }
    assert.ok(TASKS_TOOL.description.includes("pause — id and checkpoint: a running task of yours left on purpose"));
    // A coding agent's in fewer words, said at its action field and its checkpoint (the owner's tool plan of 11-08).
    assert.ok(String(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.action).description).includes("pause: leave a running task with a checkpoint, handed back whole when you start it again."));
    assert.ok(String(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties).checkpoint.description).includes("(what is done, what is next, what to re-read on the way back), kept behind it and handed back whole when you start it again."));
    assert.equal(/** @type {any} */ (LEAD_TASKS_TOOL.input_schema.properties).checkpoint, undefined);
    assert.ok(!LEAD_TASKS_TOOL.description.includes("pause —"));
    assert.ok(String(PROMPT.graph).includes("pause the task with its checkpoint") && String(PROMPT.graph).includes("Filament says where you stand on the graph at each turn's start and after a compaction"));
    assert.ok(!String(PROMPT.leadGraph).includes("pause"));
  });
});

describe("where you are (cases 1–3)", () => {
  // (fails before: yes — nothing said where the agent stood but its own memory of it, which a summary could lose)
  test("the goal and how far; each task at work with its checkpoint, each paused one with what it waits on; ready next; what waits", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }, { action: "pause", id: "t1", checkpoint: WORDS }, { action: "start", ids: ["t3"] }]);
    const words = whereText(g, { crew: "agent", checkpoints: { t1: WORDS } });
    assert.equal(
      words,
      [
        `[Filament: where you are — your task graph "Fix the parser": 0 of 4 done.`,
        `- On it: t3 "Write the docs" — running, since ${hhmm(T0 + 3 * 60_000)}`,
        `- Paused: t1 "Find the bug" — checkpoint 1 (${hhmm(T0 + 2 * 60_000)})`,
        `  Its checkpoint 1 (${hhmm(T0 + 2 * 60_000)}):`,
        "    Read parse.js to line 80: the tokenizer drops a quote.",
        "    Next: the tokenizer's tests. Re-read test/parse.test.js first.",
        "- Waiting: t2 on t1; t4 on t2, t3",
        "tasks show reads the whole graph.]",
      ].join("\n"),
    );
    const fresh = walk([ADD]);
    assert.equal(whereText(fresh, { crew: "agent" }), `[Filament: where you are — your task graph "Fix the parser": 0 of 4 done.\n- Ready next: t1 "Find the bug", t3 "Write the docs"\n- Waiting: t2 on t1; t4 on t2, t3\n- Nothing is running: start what is ready, or re-plan.\ntasks show reads the whole graph.]`);
  });

  // (fails before: yes — there was no block to keep out)
  // (fails before: yes, for its all done — the owner's of 11-10: a graph left open with all done was said nothing of)
  test("none while nothing is open, the graph closed, or there is none (case 2); all done and left open, weighed once more", () => {
    assert.equal(whereText(null, { crew: "agent" }), null);
    assert.equal(whereText(walk([ADD, { action: "close", reason: "Done." }]), { crew: "agent" }), null);
    const all = walk([{ action: "add", goal: "G", tasks: [{ id: "a", name: "A" }] }, { action: "start", ids: ["a"] }, { action: "done", id: "a", summary: "s" }]);
    assert.match(String(whereText(all, { crew: "agent" })), /^\[Filament: where you are — your task graph "G": its one task is done, and it is still open\. Weigh /);
    assert.equal(whereText(/** @type {any} */ (endHeard(all)), { crew: "agent" }), null, "said once more, then not");
  });

  // (fails before: yes — nothing gave a checkpoint back)
  test("a turn's start gives a few lines of each checkpoint, a compaction's return more; past either the rest is named, to be read", () => {
    const long = "word ".repeat(2000).trim();
    const g = walk([ADD, { action: "start", ids: ["t1"] }, { action: "pause", id: "t1", checkpoint: long }]);
    const turn = /** @type {string} */ (whereText(g, { crew: "agent", checkpoints: { t1: long }, room: WHERE_ROOM.turn }));
    const back = /** @type {string} */ (whereText(g, { crew: "agent", checkpoints: { t1: long }, room: WHERE_ROOM.back }));
    assert.ok(turn.length < back.length && back.length < long.length + 1000, `${turn.length} < ${back.length}`);
    assert.ok(turn.includes(`(9,999 characters in all: tasks read with id t1 and title "Checkpoint 1 · ${hhmm(T0 + 2 * 60_000)}" reads it whole)`), turn);
    assert.ok(!/wor …|wo …|w …/.test(turn), "cut at a word");
  });

  // (fails before: yes — the graph came back after a summary without where the planner stood)
  test("after Filament's own compaction the graph comes back with where its planner stands (case 3)", () => {
    const g = walk([ADD, { action: "start", ids: ["t1"] }]);
    const back = (/** @type {any} */ where) => backAfterSummary({ doc: {}, turns: [], toTurn: 0, root: "", window: 200_000, graph: g, where }).text;
    assert.ok(back((/** @type {any} */ crew) => `WHERE for ${crew}`).endsWith("\n\nWHERE for agent\n</tasks>"), back(() => "x"));
    assert.ok(!back(null).includes("WHERE"));
  });
});

/**
 * A session's graph kept in memory, its notes in a folder of the test's, and the runner over them — its clock the
 * test's to move.
 */
function rig() {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  const store = createTaskNotes({ dir: join(tempDir("rig"), "task-notes"), now: () => clock.t });
  const notes = createGraphNotes({ notes: store });
  const registry = { slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, launch: () => ({ ok: false, error: "no launches here" }), guard: () => {} };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => {
      const c = chains.get(id);
      if (!c) return null;
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [],
  };
  const clock = { t: T0 };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => clock.t, notes });
  return { runner, clock, graph: () => chains.get("c1").meta.graph };
}

describe("through the runner: the checkpoint kept, handed back, and said", () => {
  // (fails before: yes — the resume's answer carried nothing of where the work stood)
  test("a pause keeps its checkpoint behind the task; the start hands it back whole; where and open carry it", () => {
    const r = rig();
    ok(r.runner.apply("c1", ADD, AGENT));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, AGENT));
    r.clock.t = T0 + 4 * 60_000;
    const paused = ok(r.runner.apply("c1", { action: "pause", id: "t1", checkpoint: WORDS }, AGENT));
    const title = `Checkpoint 1 · ${hhmm(T0 + 4 * 60_000)}`;
    assert.ok(paused.text.startsWith(`Paused t1 with its checkpoint 1, kept behind it as the note "${title}".`), paused.text);
    assert.deepEqual(paused.view.tasks[0].kept, { notes: 1, files: 0, bytes: WORDS.length, titles: [title] }, "the page marks what it keeps");
    assert.equal(ok(r.runner.apply("c1", { action: "read", id: "t1", title }, AGENT)).text.includes(WORDS), true);
    const where = String(r.runner.where("c1", "agent"));
    assert.ok(where.includes(`- Paused: t1 "Find the bug" — checkpoint 1 (${hhmm(T0 + 4 * 60_000)})\n  Its checkpoint 1 (${hhmm(T0 + 4 * 60_000)}):\n    Read parse.js to line 80`), where);
    assert.ok(String(r.runner.open("c1", "agent")).endsWith(String(r.runner.where("c1", "agent", { back: true }))), "the graph after a summary ends with it");
    r.clock.t = T0 + 9 * 60_000;
    const back = ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, AGENT));
    assert.ok(back.text.startsWith(`Started t1 again, from its checkpoint 1 (${hhmm(T0 + 4 * 60_000)}).`), back.text);
    assert.ok(back.text.endsWith(`\nt1's checkpoint "${title}", as you left it:\n${WORDS}`), back.text);
    assert.equal(r.runner.onTask("c1"), `[Filament: this came while you are on t1 "Find the bug". To take it up first, pause t1 with a checkpoint (tasks pause) and add it as a task — or do it inside t1 if it belongs there.]`);
  });

  // (fails before: yes — there was no pause to keep)
  test("a pause whose checkpoint finds no place is no pause: the task runs as it did", () => {
    const r = rig();
    ok(r.runner.apply("c1", ADD, AGENT));
    ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, AGENT));
    const bare = createGraphRunner({ archive: { metaOf: () => ({ graph: r.graph() }), mergeMeta: () => null, openGraphs: () => [] }, registry: /** @type {any} */ ({ slots: () => 4, guard: () => {} }), events: { publish: () => {} }, crew: () => "agent", log: () => {} });
    assert.match(no(bare.apply("c1", { action: "pause", id: "t1", checkpoint: WORDS }, AGENT)), /a checkpoint has nowhere to go: keep the task running — the task is as it was$/);
    assert.equal(taskOf(r.graph(), "t1").state, "running");
  });
});

/** A message's text blocks, in order. @param {any} m @returns {string[]} */
const texts = (m) => (typeof m?.content === "string" ? [m.content] : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text));
/**
 * One turn of Filament's loop, its replies scripted by `script(n)`, the rest of its arguments the test's.
 * @param {{ messages: any[], script: (n: number) => any[], graph?: any, mailbox?: any, shellNews?: any }} o
 */
async function loopTurn({ messages, script, graph = null, mailbox = null, shellNews = null }) {
  /** @type {any[]} */
  const calls = [];
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    thinking: null,
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    permissions: null,
    rules: [],
    hooks: null,
    mcpReadOnly: new Set(),
    previewChars: 200,
    messages,
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    mailbox,
    shellNews,
    graph,
    tree: null,
    onEvent: () => {},
    sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
    signal: null,
    resume: null,
    call: async (/** @type {any} */ { body }) => {
      calls.push(structuredClone(body));
      return { ok: true, status: 200, json: { content: script(calls.length), usage: { input_tokens: 10, output_tokens: 5 } }, id: null, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  }));
  return { out, calls };
}

describe("what lands while a task runs names it (case 7)", () => {
  // (fails before: yes — an envelope's line, a steer, a command's end said nothing of the task they cut into)
  test("one task of the planner's own, or several; none for a sub-agent's or with nothing running", () => {
    const g = walk([ADD, { action: "start", ids: ["t1", "t3"] }]);
    assert.equal(onTaskText(g), `[Filament: this came while you are on t1 "Find the bug", t3 "Write the docs". To take it up first, pause the task it cuts into with a checkpoint (tasks pause) and add it as a task — or do it inside one of them if it belongs there.]`);
    assert.equal(onTaskText(walk([ADD])), null);
    assert.equal(onTaskText(null), null);
    const sub = walk([{ action: "add", goal: "G", tasks: [{ id: "s1", name: "Map it", by: "explorer", goal: "A map", steps: ["Read"], acceptance: "A map" }] }]);
    assert.equal(onTaskText({ ...sub, tasks: sub.tasks.map((/** @type {any} */ t) => ({ ...t, state: "running" })) }), null, "its sub-agent's report ends it");
  });

  // (fails before: yes — FabeleHelper's of 11-10: a task a coding agent's helper works on was named as the planner's own
  // work, told "do it now", and counted turns with no checkpoint)
  test("a task a helper works on is not the planner's own work: not named, not told to do, no quiet turns counted", () => {
    const g = walk([ADD, { action: "start", ids: ["t1", "t3"] }]);
    const helped = { ...g, tasks: g.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, helper: { agent: "sa_1", model: "m", copy: true, at: T0 } } : t)) };
    assert.match(String(onTaskText(helped)), /^\[Filament: this came while you are on t3 "Write the docs"\. /);
    assert.match(String(ownWorkText(helped)), /^Your task graph's t3 "Write the docs" runs as your own work/);
    const counted = /** @type {any} */ (turnBegun(helped));
    assert.deepEqual(counted.tasks.filter((/** @type {any} */ t) => t.quiet).map((/** @type {any} */ t) => t.id), ["t3"]);
    const all = { ...helped, tasks: helped.tasks.map((/** @type {any} */ t) => (t.id === "t3" ? { ...t, helper: { agent: "sa_2", model: "m", copy: false, at: T0 } } : t)) };
    assert.deepEqual([onTaskText(all), ownWorkText(all), turnBegun(all)], [null, null, null], "every running task a helper's: nothing of the planner's runs");
    const loud = { ...all, tasks: all.tasks.map((/** @type {any} */ t) => (t.helper ? { ...t, quiet: 5 } : t)) };
    assert.doesNotMatch(String(whereText(loud, { crew: "agent" })), /turns with no checkpoint/, "a helper's quiet turns are not the planner's to keep");
    // (fails before: yes — the review of d81fdac5e: a task whose helper had ended stayed out of the planner's work for
    // good, its wait saying "Nothing to wait for") Its helper ended, it is the planner's again, said so.
    const ended = (/** @type {string} */ a) => a !== "sa_1";
    assert.match(String(onTaskText(all, ended)), /^\[Filament: this came while you are on t1 "Find the bug"\. /);
    assert.equal(ownWorkText(all, ended), `t1 "Find the bug" runs on, and its helper sa_1 has ended: weigh its report, apply its change where one waits, and mark t1 done — or do the rest yourself.`);
    assert.deepEqual(/** @type {any} */ (turnBegun(all, ended)).tasks.filter((/** @type {any} */ t) => t.quiet).map((/** @type {any} */ t) => t.id), ["t1"]);
    assert.match(String(whereText(loud, { crew: "agent", helping: ended })), /t1 has run 5 turns with no checkpoint/);
    assert.doesNotMatch(String(whereText(loud, { crew: "agent", helping: ended })), /t3 has run 5 turns/);
    // (fails before: yes — FabeleHelper's of 11-10: a done's Next and a start's at-once warning still took a task whose
    // helper had ended for the helper's, where the words above say it is the planner's to finish)
    const five = walk([{ ...ADD, tasks: [...ADD.tasks, { id: "t5", name: "Bench it" }] }, { action: "start", ids: ["t1", "t3"] }]);
    const helped5 = { ...five, tasks: five.tasks.map((/** @type {any} */ t) => (t.id === "t1" ? { ...t, helper: { agent: "sa_1", model: "m", copy: true, at: T0 } } : t)) };
    /** @param {any} helping */
    const doneAt = (helping) => ok(applyTasks(helped5, { action: "done", id: "t3", summary: "Docs written." }, { ...at(), helping }));
    assert.match(doneAt(undefined).text, /Next of yours: t5 "Bench it"/, "its helper at work does t1");
    assert.doesNotMatch(doneAt(ended).text, /Next of yours/, "t1 is the agent's again: Next waits for it");
    /** @param {any} helping */
    const startAt = (helping) => ok(applyTasks(doneAt(helping).graph, { action: "start", ids: ["t5"] }, { ...at(), helping }));
    assert.doesNotMatch(startAt(undefined).text, /read as at work now/);
    assert.match(startAt(ended).text, /t1 and t5 both read as at work now: one task of yours at a time/);
  });

  // (fails before: yes — the loop's landings said nothing of the running task; and, FabeleHelper's of 11-10, its own
  // background shell's exit alone was followed by the line, at every end)
  test("the loop: a message at a round's end is followed by the line, once a round; its own shell's exit alone is not; none with no task running", async () => {
    const LINE = "[Filament: ON t1]";
    /** @type {any[]} */
    const queue = [];
    let exits = /** @type {any[]} */ ([]);
    let on = /** @type {string | null} */ (LINE);
    const { out, calls } = await loopTurn({
      messages: [{ role: "user", content: "fix the parser" }],
      mailbox: {
        read: (/** @type {any} */ pick) => {
          const out = queue.filter((m) => !pick || pick(m));
          for (const m of out) queue.splice(queue.indexOf(m), 1);
          return out;
        },
      },
      shellNews: () => exits.splice(0),
      graph: { apply: () => ({ ok: false, error: "x" }), check: () => null, open: () => null, begin: () => "[Filament: WHERE]", where: () => "[Filament: WHERE]", onTask: () => on },
      script: (/** @type {number} */ n) => {
        if (n === 1) exits = [{ id: "sh1", command: "npm test", code: 0, text: "[Filament: background shell sh1 exited with code 0.]" }];
        if (n === 2) {
          queue.push({ id: "m1", kind: "note", text: "also the footer", from: "developer" });
          exits = [{ id: "sh2", command: "npm run lint", code: 0, text: "[Filament: background shell sh2 exited with code 0.]" }];
        }
        if (n === 3) {
          on = null;
          queue.push({ id: "m2", kind: "note", text: "and the header", from: "developer" });
        }
        return n <= 3 ? [{ type: "tool_use", id: `r${n}`, name: "read", input: { path: "a.js" } }] : [{ type: "text", text: "Done." }];
      },
    });
    assert.equal(out.status, "done", JSON.stringify(out.notes));
    assert.deepEqual(texts(calls[0].messages.at(-1)), ["fix the parser", "[Filament: WHERE]"], "the turn opens with where it stands, after the words (case 1)");
    const ended = texts(calls[1].messages.at(-1));
    assert.ok(ended.some((t) => t.includes("background shell sh1")), JSON.stringify(ended));
    assert.ok(!ended.includes(LINE), `its own command's end cuts into nothing: ${JSON.stringify(ended)}`);
    const second = texts(calls[2].messages.at(-1));
    assert.equal(second.filter((t) => t === LINE).length, 1, `once: ${JSON.stringify(second)}`);
    assert.equal(second.at(-1), LINE, "after what landed");
    assert.ok(second.some((t) => t.includes("also the footer")) && second.some((t) => t.includes("background shell sh2")));
    assert.ok(!texts(calls[3].messages.at(-1)).includes(LINE), "no task running: no line");
    assert.ok(out.notes.includes("agent: where the agent stands on its task graph, with the turn's first request"));
  });

  // (fails before: yes — the first turn after a summary heard where it stood twice: at the head, and with its words)
  test("the loop: a request whose summary's head brought where it stands back says it once", async () => {
    const graph = { apply: () => ({ ok: false, error: "x" }), check: () => null, open: () => null, begin: () => "[Filament: WHERE]", where: (/** @type {any} */ o) => (o?.back ? "[Filament: WHERE, whole]" : "[Filament: WHERE]"), onTask: () => null };
    const head = { role: "user", content: [{ type: "text", text: "THE SUMMARY" }, { type: "text", text: "<tasks>\nThe task graph\n\n[Filament: WHERE, whole]\n</tasks>" }] };
    const once = await loopTurn({ messages: [head, { role: "assistant", content: "On it." }, { role: "user", content: "after" }], graph, script: () => [{ type: "text", text: "Done." }] });
    assert.deepEqual(texts(once.calls[0].messages.at(-1)), ["after"]);
    assert.ok(once.out.notes.includes("agent: where the agent stands on its task graph came back with the summary at the head of this request — not said again with its first request"), once.out.notes.join("\n"));
    const moved = await loopTurn({ messages: [{ ...head, content: [head.content[0], { type: "text", text: "<tasks>\n[Filament: WHERE, as it stood]\n</tasks>" }] }, { role: "assistant", content: "On it." }, { role: "user", content: "after" }], graph, script: () => [{ type: "text", text: "Done." }] });
    assert.deepEqual(texts(moved.calls[0].messages.at(-1)), ["after", "[Filament: WHERE]"], "the graph moved since: said");
  });

  // (fails before: yes — the hunt of 11-11 on c-dupes, where-drift: the turn's start counted a turn on the running task
  // before where it stood was read back, its words no longer the summary's, and it was said twice)
  test("the loop: where it stands is matched against the summary's head as it stood before the turn's start counted a turn", async () => {
    let begun = false;
    const graph = {
      apply: () => ({ ok: false, error: "x" }),
      check: () => null,
      open: () => null,
      begin: () => ((begun = true), "[Filament: WHERE, t1 has gone quiet]"),
      where: (/** @type {any} */ o) => (o?.back ? (begun ? "[Filament: WHERE, whole, t1 has gone quiet]" : "[Filament: WHERE, whole]") : "[Filament: WHERE]"),
      onTask: () => null,
    };
    const head = { role: "user", content: [{ type: "text", text: "THE SUMMARY" }, { type: "text", text: "<tasks>\nThe task graph\n\n[Filament: WHERE, whole]\n</tasks>" }] };
    const once = await loopTurn({ messages: [head, { role: "assistant", content: "On it." }, { role: "user", content: "after" }], graph, script: () => [{ type: "text", text: "Done." }] });
    assert.ok(begun, "the turn's start was counted");
    assert.deepEqual(texts(once.calls[0].messages.at(-1)), ["after"], "said once, at the head");
  });
});

/**
 * A registry whose sub-agents report once their gate opens, and a coding agent's turn on it, its graph's line `onTask`.
 * @param {{ onTask?: (() => string | null) | null }} [o]
 */
function coder({ onTask = null } = {}) {
  /** @type {Map<string, { promise: Promise<void>, open: () => void }>} */
  const gates = new Map();
  /** @type {string[]} */
  const notes = [];
  let n = 0;
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    context: {
      settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none", ask: [] }, loop: { permissions: "edit" } }),
      session: () => ({ cwd: tmpdir(), model: "coder-1", projectId: "p1" }),
      view: async () => ({ text: "User: fix the parser", turns: 1 }),
      brief: async () => null,
      modelProblem: () => null,
      agentOf: () => null,
      mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
      modelList: async () => "",
    },
    call: async ({ body, headers = {} }) => {
      const id = headers["x-filament-subagent"];
      const runId = `run-${++n}`;
      registry.attach(id, runId);
      const name = /HOLD:(\w+)/.exec(JSON.stringify(body.messages))?.[1] || "quick";
      await gates.get(name)?.promise;
      const report = `Subject: ${name} findings\nThe report of ${name}.`;
      registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  const door = registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: tmpdir(), mode: null, model: "coder-1", thinking: null, fork: null, emit: () => {}, round: () => 1 });
  const turn = createLaunchTurn({ registry, door, chainId: "c1", emit: () => {}, note: (t) => notes.push(t), mailbox: () => null, signal: new AbortController().signal, stopSignal: new AbortController().signal, opens: () => true, onTask });
  /** A background launch whose report lands at once. @param {string} name */
  const landed = async (name) => {
    /** @type {() => void} */
    let open = () => {};
    gates.set(name, { promise: new Promise((r) => (open = () => r(undefined))), open: () => open() });
    const r = await turn.call("agent", { description: name, prompt: `HOLD:${name} look`, run_in_background: true });
    const id = String(/sa_[0-9a-f]{8}/.exec(String(r.text))?.[0] || "");
    gates.get(name)?.open();
    for (let k = 0; k < 200 && registry.get(id)?.status !== "done"; k++) await new Promise((res) => setTimeout(res, 10));
    return id;
  };
  return { registry, turn, notes, landed };
}

describe("coding agents (cases 1, 4, 7)", () => {
  // (fails before: yes — a coding agent heard nothing of its graph but the standing words)
  test("its first prompt carries where it stands, only where its session has the tasks tool", () => {
    const b = whereBlock("[Filament: where you are — x]");
    assert.deepEqual(b, { id: WHERE_BLOCK, text: "[Filament: where you are — x]", tool: GRAPH_TOOL });
    const context = { standing: [], prompt: [{ id: "recall", text: "R" }, b] };
    assert.deepEqual(promptFor(context, givenTools({ graph: true, launch: false })).map((x) => x.id), ["recall", "where"]);
    assert.deepEqual(promptFor(context, givenTools({ graph: false, launch: true })).map((x) => x.id), ["recall"], "no tool, no block");
  });

  // (fails before: yes — its envelope's line said nothing of the task it cut into; and, FabeleHelper's of 11-10, its own
  // background command's end was followed by the line, at every end)
  test("an envelope's line is followed by the line, once a take; its own background command's end is not; none with no task running", async () => {
    let on = /** @type {string | null} */ ("[Filament: ON t1]");
    const s = coder({ onTask: () => on });
    await s.landed("A");
    const got = s.turn.take({ seal: true });
    assert.equal(got.length, 2, JSON.stringify(got));
    assert.match(got[0], /^\[Filament: envelope 1, sealed/);
    assert.equal(got[1], "[Filament: ON t1]");
    s.turn.unheard();
    assert.deepEqual(s.turn.take({ seal: true }), got, "unheard, they go again together — one line, not two");
    assert.ok(s.registry.commandEnd("c1", { id: "bg_1", command: "npm test", code: 0, text: "[Filament: your background command bg_1 ended.]" }).ok);
    assert.deepEqual(s.turn.take({ seal: true }), ["[Filament: your background command bg_1 ended.]"], "its own command's end cuts into nothing");
    on = null;
    assert.ok(s.registry.commandEnd("c1", { id: "bg_2", command: "npm test", code: 1, text: "[Filament: your background command bg_2 ended.]" }).ok);
    assert.deepEqual(s.turn.take({ seal: true }), ["[Filament: your background command bg_2 ended.]"]);
    const plain = createAgentInbox({ door: { inbox: /** @type {any} */ ({ take: () => [{ kind: "report", text: "R", from: "sa_1", description: "d", spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false }], arrival: () => new Promise(() => {}), owed: () => null }), close: () => {} }, emit: () => {}, note: () => {}, mailbox: () => null, reach: () => null, signal: new AbortController().signal, reader: "the agent", onTask: () => "[Filament: ON]" });
    assert.deepEqual(plain.take(), ["R"], "a report it waited for is no interruption");
  });
});

describe("through the app, on a coding agent over the bridge", () => {
  // (fails before: yes — its next prompt said nothing of where it stood, and its resume nothing of its checkpoint)
  test("each prompt after the add says where it stands; a pause's checkpoint is in it, and its start hands it back whole", async () => {
    const folder = tempDir("app");
    const logs = tempDir("logs");
    writeFileSync(join(folder, "a.txt"), "one\n");
    const up = await fakeUpstream(async (call) => anthropicReply("", { model: String(call.body?.model || ""), stop: "end_turn", blocks: [{ type: "text", text: "MODEL" }], usage: { input_tokens: 5, output_tokens: 3 } }));
    const shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "coder", name: "coder", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } },
        ];
        cfg.routes = [{ match: "coder-*", upstream: "coder", upstreamModel: "{model}", enabled: true }, { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
      },
    });
    try {
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "coder-1", preset: "plain", settings: {} } });
      assert.equal(made.status, 200, await made.clone().text());
      const id = String((await made.json()).id);
      const say = async (/** @type {string} */ content) => {
        const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
        const json = await r.json();
        assert.equal(r.status, 200, JSON.stringify(json));
        return (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
      };
      const prompts = () => (existsSync(join(logs, "prompts.jsonl")) ? readFileSync(join(logs, "prompts.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => String(JSON.parse(l).text)) : []);
      const promptWith = (/** @type {string} */ marker) => prompts().find((p) => p.includes(marker)) || "";
      const added = await say(`~mcpcall tasks ${JSON.stringify(ADD)}`);
      assert.match(added, /mcp:Added t1, t2, t3, t4/);
      assert.ok(!promptWith("~mcpcall tasks").includes("where you are"), "nothing open before the add");
      await say(`~mcpcall tasks {"action":"start","ids":["t1"]}`);
      assert.ok(promptWith(`"ids":["t1"]`).includes(`[Filament: where you are — your task graph "Fix the parser": 0 of 4 done.\n- Ready next: t1 "Find the bug", t3 "Write the docs"`), promptWith(`"ids":["t1"]`));
      const paused = await say(`~mcpcall tasks ${JSON.stringify({ action: "pause", id: "t1", checkpoint: WORDS })}`);
      assert.match(paused, /mcp:Paused t1 with its checkpoint 1, kept behind it as the note "Checkpoint 1 · \d\d:\d\d"/);
      await say("and now?");
      assert.match(promptWith("and now?"), /- Paused: t1 "Find the bug" — checkpoint 1 \(\d\d:\d\d\)\n {2}Its checkpoint 1 \(\d\d:\d\d\):\n {4}Read parse\.js to line 80: the tokenizer drops a quote\.\n {4}Next: the tokenizer's tests\./);
      const resumed = await say(`~mcpcall tasks {"action":"start","ids":["t1"]}`);
      assert.match(resumed, /Started t1 again, from its checkpoint 1 \(\d\d:\d\d\)\./);
      assert.ok(resumed.includes(`as you left it:\n${WORDS}`), resumed);
    } finally {
      await shim.stop();
      await up.close();
      rmSync(shim.dataDir, { recursive: true, force: true });
    }
  });
});

test("the tool's words for both kinds of agent say pause, and what a resume hands back", () => {
  for (const words of [TOOL_TEXT.tasks, TOOL_TEXT.tasksReads]) assert.ok(words.includes("start it again to go on, and the answer hands the checkpoint back whole;"), words.slice(0, 100));
  // A coding agent's actions are said at its action field (the owner's tool plan of 11-08).
  assert.ok(String(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.action).description).includes("pause: leave a running task with a checkpoint, handed back whole when you start it again."));
  assert.ok(!TOOL_TEXT.leadTasks.includes("pause"));
});
