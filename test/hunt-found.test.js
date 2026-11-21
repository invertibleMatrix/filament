// @ts-check
// What a Bug Hunter fired from a task found, kept as a task that hangs off that task (the owner's words of 11-02: "when
// it reports back to the main agent it should contain the information which node the bug hunter was fired from and if
// the findings hold and you decide to create a new task for those bug hunter then you should create a node out of that
// node where the bug hunter was fired from so that connection is logical"). The Hunter's report names the task it was
// fired from, by its id and name, and how a finding becomes a task; its record keeps that task across a restart;
// `found_by` on tasks add and change hangs the new task off it — refused in words where the id is no such hunt, or its
// task is gone; every reading of the graph says which hunt found a task; the Plan holds it in the box of the task its
// hunt was fired from (the redesign of 11-05), and its tooltip and its card say which hunt.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { applyTasks, graphView, showText, whereText } from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry, noSuchSubagent } from "../src/app/agent/subagents.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_READS_TOOL, TASKS_TOOL } from "../src/app/agent/tools.js";
import { drawGraph, huntBrief } from "../src/ui/harness/views/task-graph.js";
import { FOLD, lineLook } from "../src/ui/harness/lib/graph-lanes.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const T0 = 1_000_000;
/** @param {any} r */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @param {RegExp | string} want */
const no = (r, want) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  if (typeof want === "string") assert.equal(r.error, want);
  else assert.match(r.error, want);
};
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);

/** The registry's word, as the runner hands it: sa_1 a Hunter fired from t1 of the graph begun at T0; sa_9 a helper. @type {import("../src/core/task-graph.js").FoundOf} */
const foundOf = (agent) =>
  agent === "sa_1"
    ? { agent: "sa_1", name: "Hunter", task: "t1", graph: T0 }
    : agent === "sa_9"
      ? { error: 'sa_9 is Builder\'s run "Look around", sent from no task on the Plan — found_by names a bug hunt sent from one' }
      : { error: `no sub-agent ${agent} in this session` };
/** A tasks call with the registry's word. @param {any} graph @param {any} input @param {any} [o] @returns {any} */
const apply = (graph, input, o = {}) => applyTasks(graph, input, { at: T0 + 500_000, crew: "agent", foundOf, ...o });
/** The graph begun at T0: t1 done, t2 waiting on it. */
function hunted() {
  let g = ok(applyTasks(null, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer" }, { id: "t2", name: "Parser", needs: ["t1"] }] }, { at: T0, crew: "agent" })).graph;
  g = ok(applyTasks(g, { action: "start", ids: ["t1"] }, { at: T0 + 1000, crew: "agent" })).graph;
  return ok(applyTasks(g, { action: "done", id: "t1", summary: "Lexer with 40 tests" }, { at: T0 + 2000, crew: "agent" })).graph;
}

describe("found_by on the graph", () => {
  // (fails before: yes — found_by was no field of a task: the finding stood apart, its link only in the agent's words)
  test("add: the task needs the task its hunt was fired from — ready at once behind a done one — keeps what found it, and the answer says so", () => {
    const r = ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one", found_by: "sa_1" }] }));
    const t3 = task(r.graph, "t3");
    assert.deepEqual(t3.needs, ["t1"]);
    assert.deepEqual(t3.foundBy, { agent: "sa_1", name: "Hunter", task: "t1", added: true });
    assert.match(r.text, /^Added t3\. t3 takes up what Hunter sa_1 found on t1: it needs t1, and the Plan marks it as that hunt's finding\. /);
    assert.equal(/** @type {any} */ (graphView(r.graph)).tasks.find((/** @type {any} */ t) => t.id === "t3").ready, true, "t1 is done: t3 is ready at once");
    // Its own needs stay beside it, the hunted task once.
    const both = ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix it", needs: ["t2", "t1"], found_by: "sa_1" }] }));
    assert.deepEqual(task(both.graph, "t3").needs, ["t2", "t1"]);
    // Kept with the graph as plain JSON: a restart reads it back.
    assert.deepEqual(task(JSON.parse(JSON.stringify(r.graph)), "t3").foundBy, t3.foundBy);
    // A coding agent's tasks and a lead's take it too.
    assert.deepEqual(task(ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: "sa_1" }] }, { solo: true })).graph, "t3").needs, ["t1"]);
  });

  test("refused in words: no hunt, a hunt whose task is gone or of another graph, the wrong kind of value; the whole call refused", () => {
    const g = hunted();
    no(apply(g, { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: "sa_9" }] }), 't3: sa_9 is Builder\'s run "Look around", sent from no task on the Plan — found_by names a bug hunt sent from one');
    no(apply(g, { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: "sa_x" }] }), "t3: no sub-agent sa_x in this session");
    no(apply(g, { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: 5 }] }), "t3: found_by is the id of a bug hunt sent from a task on the Plan, as its report names it — like sa_4ff20533");
    // A graph begun after the hunt holds a t1 of its own: not the task it hunted.
    const closed = ok(apply(g, { action: "close", reason: "Shipped" })).graph;
    const again = ok(apply(closed, { action: "add", goal: "Next", tasks: [{ id: "t1", name: "Another lexer" }] })).graph;
    no(apply(again, { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: "sa_1" }] }), "t3: Hunter sa_1 was sent from task t1, which is gone from the graph — add the task without found_by, and say in it what was found");
    no(apply(closed, { action: "add", goal: "Fixes", tasks: [{ id: "t3", name: "Fix", found_by: "sa_1" }] }), /t3: Hunter sa_1 was sent from task t1, which is gone from the graph/);
    // One refused, the call is: nothing of it goes on.
    no(apply(g, { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: "sa_1" }, { id: "t4", name: "And", found_by: "sa_9" }] }), /^Nothing of this call changed: t4: sa_9 is Builder's run/);
    // With no registry to say, none is named.
    no(applyTasks(g, { action: "add", tasks: [{ id: "t3", name: "Fix", found_by: "sa_1" }] }, { at: T0, crew: "agent" }), "t3: Filament runs no bug hunts here, so found_by can name none");
  });

  test("change: a task takes a finding — and needs its task — while it waits; \"\" takes the mark away, its needs as they stand; a running one of the agent's own takes it too, and runs on", () => {
    const g = ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one" }] })).graph;
    const marked = ok(apply(g, { action: "change", tasks: [{ id: "t3", found_by: "sa_1" }] }));
    assert.deepEqual(task(marked.graph, "t3").needs, ["t1"]);
    assert.match(marked.text, /^Changed t3\. t3 takes up what Hunter sa_1 found on t1: it needs t1, and the Plan marks it as that hunt's finding\./);
    // Another field changed: the mark stays, and nothing of it is said again.
    const renamed = ok(apply(marked.graph, { action: "change", tasks: [{ id: "t3", name: "Fix it well" }] }));
    assert.deepEqual(task(renamed.graph, "t3").foundBy, { agent: "sa_1", name: "Hunter", task: "t1", added: true });
    assert.doesNotMatch(renamed.text, /takes up what/);
    const unmarked = ok(apply(marked.graph, { action: "change", tasks: [{ id: "t3", found_by: "" }] })).graph;
    assert.equal("foundBy" in task(unmarked, "t3"), false);
    assert.deepEqual(task(unmarked, "t3").needs, ["t1"]);
    // A running task's needs may change (g1, the owner's of 11-09): it comes to need t1, runs on, and the answer says so.
    const running = ok(apply(g, { action: "start", ids: ["t3"] })).graph;
    const took = ok(apply(running, { action: "change", tasks: [{ id: "t3", found_by: "sa_1" }] }));
    assert.deepEqual([task(took.graph, "t3").needs, task(took.graph, "t3").state], [["t1"], "running"]);
    assert.match(took.text, /^Changed t3\. t3 runs on, needing t1 now\. t3 takes up what Hunter sa_1 found on t1: it needs t1, and the Plan marks it as that hunt's finding\./);
  });

  // (fails before: yes — nothing the agent read of its graph said which hunt found a task)
  test("read back: its line in tasks show says which hunt found it, the task whole names the hunt and its task, and so does where you are", () => {
    const g = ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one", found_by: "sa_1" }] })).graph;
    assert.match(showText(g, "agent"), /\n- t3 "Fix the off-by-one" — ready · found by Hunter's hunt on t1 · needs t1\n/);
    const whole = ok(apply(g, { action: "show", id: "t3" })).text;
    assert.match(whole, /^t3 "Fix the off-by-one" — ready · found by Hunter's hunt on t1 · needs t1\n/);
    assert.match(whole, /\nFound by: Hunter's hunt on t1 "Lexer" — sa_1, whose report named what it found$/);
    assert.match(String(whereText(g, { crew: "agent" })), /\n- Ready next: t2 "Parser", t3 "Fix the off-by-one" \(found by Hunter's hunt on t1\)\n/);
    const started = ok(apply(g, { action: "start", ids: ["t3"] })).graph;
    assert.match(String(whereText(started, { crew: "agent" })), /\n- On it: t3 "Fix the off-by-one" — running, since [^\n]* · found by Hunter's hunt on t1\n/);
  });

  // (fails before: yes — the tasks tools had no found_by)
  test("every tasks tool takes found_by: the Hunter's id its report gives", () => {
    for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL]) {
      const p = /** @type {any} */ (tool.input_schema.properties.tasks.items.properties).found_by;
      assert.equal(p?.type, "string", tool.description.slice(0, 40));
      assert.match(p.description, /^The bug hunt whose finding this task takes up, by the id its report gives \(sa_4ff20533\): the task then needs the task the hunt was sent from, and the Plan page marks it as that hunt's finding\./);
    }
  });
});

describe("the hunt and the graph, wired", () => {
  /**
   * A session kept in memory, its graph's runner and the sub-agent registry over the real card store, each the other's
   * as the server wires them; `threads` holds what the session keeps of its sub-agents, as a restart finds it.
   * @param {Map<string, any[]>} threads @param {Map<string, any>} chains
   */
  function wired(threads, chains) {
    const cards = createAgentCardStore({ dataDir: null });
    let n = 0;
    /** @type {any} */
    let runner = null;
    const archive = {
      /** @param {string} id @param {readonly string[]} keys */
      metaOf: (id, keys) => {
        const c = chains.get(id);
        return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
      },
      /** @param {string} id @param {Record<string, any>} patch */
      mergeMeta: (id, patch) => {
        const c = chains.get(id);
        c.meta = structuredClone({ ...c.meta, ...patch });
        return c.meta;
      },
      openGraphs: () => [],
    };
    /** @type {ReturnType<typeof createSubagentRegistry>} */
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      context: {
        card: (tag) => cards.find(tag),
        settings: () => ({ subagents: { pool: [{ model: "m-sub", seats: 4 }], view: "none" }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: tmpdir(), model: "m", projectId: "p1" }),
        view: async () => ({ text: "User: ship it", turns: 1 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        saveThread: (/** @type {string} */ c, /** @type {any} */ t) => threads.set(c, [...(threads.get(c) || []).filter((x) => x.id !== t.id), structuredClone(t)]),
        loadThreads: (/** @type {string} */ c) => structuredClone(threads.get(c) || []),
        huntedTask: (chainId, id) => runner.huntedTask(chainId, id),
      },
      call: async ({ body, headers = {} }) => {
        const id = headers["x-filament-subagent"];
        const runId = `run-${++n}`;
        registry.attach(id, runId);
        const report = "Subject: One off-by-one in lex.js\n\nsrc/lex.js:12 reads one past the end.";
        registry.finish(id, { status: "done", error: null, report, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: report }] }], rounds: 1, toolCalls: 1, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: [runId] });
        return { ok: true, status: 200, json: { content: [{ type: "text", text: report }], usage: { input_tokens: 10, output_tokens: 5 } }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
      },
    });
    let at = T0;
    runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => (at += 1000) });
    return { registry, runner };
  }
  /** A Hunter fired from t1 as the Plan's Hunt bugs fires it. @param {any} registry @param {Record<string, any>} [more] */
  const fire = (registry, more = {}) =>
    /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: huntBrief({ id: "t1", name: "Lexer", summary: "Lexer with 40 tests" }).prompt, description: "Bug hunt: t1 · Lexer", as: "reviewer", deliver: true, model: "m-other", hunts: "t1", ...more }));

  // (fails before: yes — the report named its task only in the brief's words, and nothing of the task was kept with the hunt)
  test("the Hunter's report names the task it was fired from, by its id and name, and how a finding becomes a task; a task added so hangs off it, across a restart", async () => {
    /** @type {Map<string, any[]>} */
    const threads = new Map();
    /** @type {Map<string, any>} */
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    const { registry, runner } = wired(threads, chains);
    ok(runner.apply("c1", { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer" }, { id: "t2", name: "Parser", needs: ["t1"] }] }, { crew: "agent" }));
    ok(runner.apply("c1", { action: "start", ids: ["t1"] }, { crew: "agent" }));
    ok(runner.apply("c1", { action: "done", id: "t1", summary: "Lexer with 40 tests" }, { crew: "agent" }));
    const begun = chains.get("c1").meta.graph.startedAt;
    // A task the graph does not hold fires no Hunter.
    assert.deepEqual(fire(registry, { hunts: "t9" }), { ok: false, error: "hunts names t9, and this chat's task graph holds no task of that id" });
    // Nor one not done: the launch says why, in the runner's words.
    assert.deepEqual(fire(registry, { hunts: "t2" }), { ok: false, error: "hunts names t2, which is waiting — a bug hunt looks at what a done task did" });
    const r = fire(registry);
    assert.equal(r.ok, true, String(r.error || ""));
    await r.done;
    // The agent was stopped: the report waits whole for its next turn, the rest of its words as ever.
    const [q] = registry.peekQueued("c1");
    assert.match(q.text, new RegExp(`^\\[Filament: the developer ran sub-agent ${r.id} \\("Bug hunt: t1 · Lexer"\\) alongside you; it finished\\. The developer's task for it:\\nHunt for bugs in what task t1`));
    assert.ok(q.text.endsWith(`Weigh it against your own work and don't redo what it covered. To ask it more in the same context, call agent with agent_id "${r.id}".\n\nSent from task t1 "Lexer" of your task graph. A task for a finding that holds: tasks add with found_by "${r.id}" — it hangs off t1 on the Plan, marked as this hunt's finding.]`), q.text.slice(-400));
    assert.deepEqual(threads.get("c1")?.find((t) => t.id === r.id)?.hunted, { name: "Lexer", graph: begun }, "its record keeps the task");
    // The agent files the finding.
    const added = ok(runner.apply("c1", { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one in lex.js", found_by: r.id }] }, { crew: "agent" }));
    assert.match(added.text, new RegExp(`t3 takes up what Reviewer ${r.id} found on t1: it needs t1, and the Plan marks it as that hunt's finding\\.`));
    assert.deepEqual(task(chains.get("c1").meta.graph, "t3").foundBy, { agent: r.id, name: "Reviewer", task: "t1", added: true });
    // Anything else is no hunt: said what it is.
    const helper = /** @type {any} */ (registry.launch({ origin: "owner", chainId: "c1", prompt: "Look around", description: "Look around", deliver: true, model: "m-other" }));
    await helper.done;
    no(runner.apply("c1", { action: "add", tasks: [{ id: "t4", name: "Fix", found_by: helper.id }] }, { crew: "agent" }), `t4: ${helper.id} is Builder's run "Look around", sent from no task on the Plan — found_by names a bug hunt sent from one`);
    no(runner.apply("c1", { action: "add", tasks: [{ id: "t4", name: "Fix", found_by: "sa_00000000" }] }, { crew: "agent" }), `t4: ${noSuchSubagent("sa_00000000")} — found_by names a bug hunt sent from a task on the Plan, by the id its report gives`);
    // Filament restarts: the hunt's record and the graph are read back, and a second finding hangs off t1 as the first did.
    const after = wired(threads, chains);
    assert.match(ok(after.runner.apply("c1", { action: "show", id: "t3" }, { crew: "agent" })).text, new RegExp(`\\nFound by: Reviewer's hunt on t1 "Lexer" — ${r.id}, whose report named what it found`));
    ok(after.runner.apply("c1", { action: "add", tasks: [{ id: "t4", name: "Guard the empty input", found_by: r.id }] }, { crew: "agent" }));
    assert.deepEqual(task(chains.get("c1").meta.graph, "t4").needs, ["t1"]);
  });
});

describe("the Plan", () => {
  /** The graph drawn: t1 done, t2 waiting on it, t3 the finding of Hunter sa_1 on t1. @param {Record<string, any>} [o] */
  const drawn = (o = {}) => drawGraph(graphView(ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one", found_by: "sa_1" }] })).graph), { h: fakeH, now: T0 + 600_000, ...o }).el;
  /** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
  const all = (n, pred, out = []) => {
    if (n && typeof n === "object") {
      if (pred(n)) out.push(n);
      for (const k of n.kids || []) all(k, pred, out);
    }
    return out;
  };
  /** @param {any} n @param {string} cls */
  const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
  /** @param {any} n @param {string} id */
  const boxOf = (n, id) => all(n, (x) => x.attrs?.["data-id"] === id)[0];

  // (fails before: yes — a hunt's finding stood on the Plan as any task did; the Product agent's redesign of 11-05, the
  // owner's yes: it stands inside the box of the task it was fired from, where a gold bug on its own box and a dotted
  // line said so)
  test("a hunt's finding stands in the box of the task it was fired from, under its hunt's strip; its tooltip and its name say which hunt; no line of its own", () => {
    const el = drawn({ autoPick: false });
    const box = byClass(el, "tg-hunt-box")[0];
    assert.ok(box, "t1's hunt box");
    assert.deepEqual(all(box, (x) => !!x.attrs?.["data-id"]).map((x) => x.attrs["data-id"]), ["t1", "t3"], "t1's line, then its finding's");
    assert.equal(textOf(byClass(box, "tg-hunt-strip")[0]), "Hunter's hunt · 1 fix");
    assert.ok(boxOf(byClass(box, "tg-hunt-fixes")[0], "t3"), "under its hunt's strip");
    assert.match(boxOf(el, "t3").attrs.title, /\nFound by Hunter on Lexer \(t1\)(\n|$)/);
    assert.match(boxOf(el, "t3").attrs["aria-label"], /; found by Hunter on t1$/);
    assert.equal(byClass(el, "tg-hunt-box").length, 1, "a task no hunt found from has none");
    // The one line t1's box into t2; none to its finding, no dot, no key.
    const svg = byClass(el, "tg-edges").map((x) => String(x.attrs.html)).join("");
    assert.deepEqual([...svg.matchAll(/<path class="([^"]*)"[^>]*data-ids="([^"]*)"/g)].map((m) => [m[1], m[2]]), [["e done", "t1 t2"]]);
    assert.equal(byClass(el, "tg-key").length, 0);
  });

  // (fails before: yes)
  test("its card says which hunt found it on which task, and opens the hunt's thread", () => {
    /** @type {string[]} */
    const opened = [];
    const el = drawn({ chosen: "t3", onOpenAgent: (/** @type {string} */ id) => void opened.push(id) });
    const part = byClass(byClass(el, "tg-card")[0], "tg-found")[0];
    assert.ok(part, "the part");
    assert.equal(textOf(part), "Found by Hunter on Lexer (t1)| · |Open the hunt");
    buttonsOf(part).find((b) => textOf(b) === "Open the hunt")?.dispatch("click");
    assert.deepEqual(opened, ["sa_1"]);
    // Without a way to open threads, the words alone.
    assert.equal(textOf(byClass(drawn({ chosen: "t3" }), "tg-found")[0]), "Found by Hunter on Lexer (t1)");
  });

  // (fails before: yes — its line out of the folded steps' row was dotted, and a key said so; the redesign of 11-05: a
  // line means "needs" and nothing else)
  test("a finding that needs more than the task it was fired from stands on its own: its tooltip says which hunt, its lines as any line", () => {
    let g = ok(applyTasks(null, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer" }, { id: "t2", name: "Parser", needs: ["t1"] }, { id: "t3", name: "Printer", needs: ["t2"] }] }, { at: T0, crew: "agent" })).graph;
    for (const [n, id] of ["t1", "t2", "t3"].entries()) {
      g = ok(applyTasks(g, { action: "start", ids: [id] }, { at: T0 + 1000 + n * 2000, crew: "agent" })).graph;
      g = ok(applyTasks(g, { action: "done", id, summary: `${id} done` }, { at: T0 + 2000 + n * 2000, crew: "agent" })).graph;
    }
    g = ok(apply(g, { action: "add", tasks: [{ id: "t4", name: "Fix the off-by-one", needs: ["t3"], found_by: "sa_1" }] })).graph;
    const el = drawGraph(graphView(g), { h: fakeH, now: T0 + 600_000, autoPick: false }).el;
    assert.equal(boxOf(el, "t1"), undefined, "t1 and t2 are folded");
    assert.equal(boxOf(el, "t2"), undefined);
    assert.equal(byClass(el, "tg-hunt-box").length, 0, "it needs t3 too: no box holds it");
    assert.match(boxOf(el, "t4").attrs.title, /\nFound by Hunter on Lexer \(t1\)(\n|$)/);
    const looks = [...byClass(el, "tg-edges").map((x) => String(x.attrs.html)).join("").matchAll(/<path class="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(looks.length >= 2 && looks.every((cls) => cls === "e done"), looks.join(", "));
    // A line's look: out of the fold row as out of any finished work.
    const byId = new Map(/** @type {any} */ (graphView(g)).tasks.map((/** @type {any} */ t) => [t.id, t]));
    assert.deepEqual(lineLook({ from: FOLD, to: "t4", froms: ["t1"], tos: ["t4"] }, byId, null), { cls: "e done", p: 0 });
    assert.deepEqual(lineLook({ from: "t3", to: "t4", froms: ["t3"], tos: ["t4"] }, byId, "t4"), { cls: "e done on", p: 2 });
  });
});

describe("found_by, the Hunter's review of 11-02", () => {
  /** sa_1 fired from t1 and sa_2 from t2, of the graph begun at T0; sa_3 from t1 too. @type {import("../src/core/task-graph.js").FoundOf} */
  const twoHunts = (agent) =>
    agent === "sa_2" ? { agent, name: "Hunter", task: "t2", graph: T0 } : agent === "sa_3" ? { agent, name: "Hunter", task: "t1", graph: T0 } : foundOf(agent);
  /** t1 and t2 done, the graph begun at T0. */
  function bothDone() {
    let g = ok(applyTasks(null, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer" }, { id: "t2", name: "Parser", needs: ["t1"] }] }, { at: T0, crew: "agent" })).graph;
    for (const [n, id] of ["t1", "t2"].entries()) {
      g = ok(applyTasks(g, { action: "start", ids: [id] }, { at: T0 + 1000 + n * 2000, crew: "agent" })).graph;
      g = ok(applyTasks(g, { action: "done", id, summary: `${id} done` }, { at: T0 + 2000 + n * 2000, crew: "agent" })).graph;
    }
    return g;
  }
  /** @param {any} graph @param {any} input @param {any} [o] @returns {any} */
  const hunt = (graph, input, o = {}) => apply(graph, input, { foundOf: twoHunts, ...o });

  // (fails before: yes — another hunt's task was added to the needs, and the first hunt's stayed: t3 waited on both)
  test("change: another hunt in a finding's place takes the place of the need the first gave it, and the answer says so; needs the change names stand, and a running task's needs move as a waiting one's", () => {
    const g = ok(hunt(bothDone(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one", found_by: "sa_1" }] })).graph;
    const moved = ok(hunt(g, { action: "change", tasks: [{ id: "t3", found_by: "sa_2" }] }));
    assert.deepEqual(task(moved.graph, "t3").needs, ["t2"]);
    assert.deepEqual(task(moved.graph, "t3").foundBy, { agent: "sa_2", name: "Hunter", task: "t2", added: true });
    assert.match(moved.text, /^Changed t3\. t3 takes up what Hunter sa_2 found on t2: it needs t2 in place of t1, and the Plan marks it as that hunt's finding\./);
    // Its own needs beside the first hunt's stay; only the need that hunt gave goes.
    const both = ok(hunt(bothDone(), { action: "add", tasks: [{ id: "t3", name: "Fix it", needs: ["t2"], found_by: "sa_1" }] })).graph;
    assert.deepEqual(task(both, "t3").needs, ["t2", "t1"]);
    assert.deepEqual(task(ok(hunt(both, { action: "change", tasks: [{ id: "t3", found_by: "sa_2" }] })).graph, "t3").needs, ["t2"]);
    // A change that names the needs as well: those stand, with the new hunt's task.
    assert.deepEqual(task(ok(hunt(g, { action: "change", tasks: [{ id: "t3", found_by: "sa_2", needs: ["t1"] }] })).graph, "t3").needs, ["t1", "t2"]);
    // Another hunt fired from the same task: the need stays, said as it is.
    const same = ok(hunt(g, { action: "change", tasks: [{ id: "t3", found_by: "sa_3" }] }));
    assert.deepEqual(task(same.graph, "t3").needs, ["t1"]);
    assert.match(same.text, /t3 takes up what Hunter sa_3 found on t1: it needs t1, and the Plan/);
    // "" takes the mark off and leaves the needs as they stand.
    assert.deepEqual(task(ok(hunt(g, { action: "change", tasks: [{ id: "t3", found_by: "" }] })).graph, "t3").needs, ["t1"]);
    // A running task of the agent's own: its needs may change (g1, the owner's of 11-09), so the new hunt takes the need the
    // first gave, as a waiting one's does, and the answer says it runs on.
    const running = ok(hunt(both, { action: "start", ids: ["t3"] })).graph;
    const r = ok(hunt(running, { action: "change", tasks: [{ id: "t3", found_by: "sa_2" }] }));
    assert.deepEqual([task(r.graph, "t3").needs, task(r.graph, "t3").foundBy.agent], [["t2"], "sa_2"]);
    assert.match(r.text, /^Changed t3\. t3 runs on, needing t2 now\. t3 takes up what Hunter sa_2 found on t2: it needs t2 in place of t1/);
  });

  // (fails before: yes — the review of 11-03: the graph did not say whether the need was the hunt's, and a switch took
  // the planner's own need of the hunted task away with the hunt)
  test("change: another hunt takes the place only of a need the first hunt added — one the planner named itself stays, and the graph keeps which", () => {
    // The planner named t1 itself: the hunt from t1 added nothing.
    const named = ok(hunt(bothDone(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one", needs: ["t1"], found_by: "sa_1" }] })).graph;
    const moved = ok(hunt(named, { action: "change", tasks: [{ id: "t3", found_by: "sa_2" }] }));
    assert.deepEqual(task(moved.graph, "t3").needs, ["t1", "t2"]);
    assert.match(moved.text, /t3 takes up what Hunter sa_2 found on t2: it needs t2, and the Plan marks it/);
    assert.deepEqual([task(named, "t3").foundBy.added, task(moved.graph, "t3").foundBy.added], [false, true]);
    // The hunt added it, then the planner named it: it is the planner's now, and stays through a switch.
    const added = ok(hunt(bothDone(), { action: "add", tasks: [{ id: "t3", name: "Fix it", found_by: "sa_1" }] })).graph;
    assert.equal(task(added, "t3").foundBy.added, true);
    const kept = ok(hunt(added, { action: "change", tasks: [{ id: "t3", needs: ["t1"] }] })).graph;
    assert.deepEqual([task(kept, "t3").needs, task(kept, "t3").foundBy.added], [["t1"], false]);
    assert.deepEqual(task(ok(hunt(kept, { action: "change", tasks: [{ id: "t3", found_by: "sa_2" }] })).graph, "t3").needs, ["t1", "t2"]);
    // Needs the change names without the hunted task: the hunt adds it again, and it is the hunt's.
    const again = ok(hunt(kept, { action: "change", tasks: [{ id: "t3", needs: [] }] })).graph;
    assert.deepEqual([task(again, "t3").needs, task(again, "t3").foundBy.added], [["t1"], true]);
    // Another hunt from the same task keeps whose the need is.
    assert.equal(task(ok(hunt(added, { action: "change", tasks: [{ id: "t3", found_by: "sa_3" }] })).graph, "t3").foundBy.added, true);
    assert.equal(task(ok(hunt(named, { action: "change", tasks: [{ id: "t3", found_by: "sa_3" }] })).graph, "t3").foundBy.added, false);
    // A mark that does not say whose the need is takes no need away.
    const unsaid = structuredClone(added);
    delete task(unsaid, "t3").foundBy.added;
    assert.deepEqual(task(ok(hunt(unsaid, { action: "change", tasks: [{ id: "t3", found_by: "sa_2" }] })).graph, "t3").needs, ["t1", "t2"]);
  });

  // (fails before: yes — the registry's word alone was asked, and it had let the Hunter go: the second finding was refused)
  test("a hunt the graph keeps on a task already is read from there: a second finding hangs off its task though the registry has let that Hunter go", () => {
    const g = ok(apply(hunted(), { action: "add", tasks: [{ id: "t3", name: "Fix the off-by-one", found_by: "sa_1" }] })).graph;
    /** The registry has let every Hunter go: a session keeps its newest 30 threads, and the developer may delete one. @type {import("../src/core/task-graph.js").FoundOf} */
    const forgot = (agent) => ({ error: `no sub-agent ${agent} in this session` });
    const r = ok(apply(g, { action: "add", tasks: [{ id: "t4", name: "Guard the empty input", found_by: "sa_1" }] }, { foundOf: forgot }));
    assert.deepEqual([task(r.graph, "t4").needs, task(r.graph, "t4").foundBy], [["t1"], { agent: "sa_1", name: "Hunter", task: "t1", added: true }]);
    // And a change gives it to another task so too.
    assert.deepEqual(task(ok(apply(g, { action: "change", tasks: [{ id: "t2", found_by: "sa_1" }] }, { foundOf: forgot })).graph, "t2").foundBy, { agent: "sa_1", name: "Hunter", task: "t1", added: false }, "t2 named t1 itself: the need is its own");
    // A hunt no task keeps is still the registry's to say.
    no(apply(g, { action: "add", tasks: [{ id: "t4", name: "Fix", found_by: "sa_2" }] }, { foundOf: forgot }), "t4: no sub-agent sa_2 in this session");
  });
});

describe("a hunt fired from a task not done", () => {
  // (fails before: yes — the launch took any task of the graph: a Hunter hunted bugs in work never done, and its finding
  // waited on a task still to run, or on a dropped one)
  test("is refused in words: a Hunter hunts bugs in what a done task did, as the Plan offers it", () => {
    const chains = new Map([["c1", { id: "c1", meta: {} }]]);
    const archive = {
      /** @param {string} id @param {readonly string[]} keys */
      metaOf: (id, keys) => Object.fromEntries(keys.filter((k) => chains.get(id)?.meta?.[k] !== undefined).map((k) => [k, /** @type {any} */ (chains.get(id)).meta[k]])),
      /** @param {string} id @param {Record<string, any>} patch */
      mergeMeta: (id, patch) => (/** @type {any} */ (chains.get(id)).meta = { .../** @type {any} */ (chains.get(id)).meta, ...patch }),
      openGraphs: () => [],
    };
    const registry = { huntOf: foundOf, resumable: () => null, checkProblem: () => null, runProblem: () => null };
    let g = ok(applyTasks(null, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer" }, { id: "t2", name: "Parser", needs: ["t1"] }, { id: "t3", name: "Printer" }, { id: "t4", name: "Docs" }] }, { at: T0, crew: "agent" })).graph;
    g = ok(applyTasks(g, { action: "start", ids: ["t1", "t3"] }, { at: T0 + 1000, crew: "agent" })).graph;
    g = ok(applyTasks(g, { action: "done", id: "t1", summary: "Lexer with 40 tests" }, { at: T0 + 2000, crew: "agent" })).graph;
    g = ok(applyTasks(g, { action: "drop", ids: ["t4"], reason: "Not needed" }, { at: T0 + 3000, crew: "agent" })).graph;
    /** @type {any} */ (chains.get("c1")).meta.graph = g;
    const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => T0 + 10_000 });
    assert.deepEqual(runner.huntedTask("c1", "t1"), { name: "Lexer", graph: T0 });
    assert.deepEqual(runner.huntedTask("c1", "t2"), { error: "hunts names t2, which is waiting — a bug hunt looks at what a done task did" });
    assert.deepEqual(runner.huntedTask("c1", "t3"), { error: "hunts names t3, which is running — a bug hunt looks at what a done task did" });
    assert.deepEqual(runner.huntedTask("c1", "t4"), { error: "hunts names t4, which was dropped — a bug hunt looks at what a done task did" });
    assert.deepEqual(runner.huntedTask("c1", "t9"), { error: "hunts names t9, and this chat's task graph holds no task of that id" });
  });
});
