// @ts-check
// One plan (the owner's report of 11-11): "you are now working in checklist instead of that taskgraph you made". Mid-task
// on its graph, the agent kept its sequential steps on Filament's checklist, as its rule says — and the Plan page swapped
// the graph for that checklist, as it shows whichever the agent touched last; a coding agent's checklist never reached
// the graph at all, where the loop's did (V2-5). Now, while a task of the agent's own runs, a checklist naming none of
// the graph's tasks is that task's steps, on every engine: kept on the task, said on its box's line and in its card; the
// Plan page keeps the graph while the agent planned tasks of its own on it; and the agents' words say so.
// (fails before: yes — a checklist beside a running task became tasks of its own in the loop and nothing in a coding
// agent's chat, and the page showed the checklist in the graph's place)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tg from "../src/core/task-graph.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { PROMPT, PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { CODER_CHECKLIST_TOOL, PLAN_TOOL } from "../src/app/agent/tools.js";
import { pageOf, planCount } from "../src/ui/harness/views/plan.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";

const T1 = 1000;
/** @type {{ at: number, crew: import("../src/core/task-graph.js").Crew }} */
const AT = { at: T1, crew: "agent" };
/** @param {string} text @param {string} [status] */
const I = (text, status = "pending") => ({ text, status });
/** @param {any} graph @param {any} input @returns {any} */
const tasks = (graph, input) => {
  const r = tg.applyTasks(graph, input, AT);
  assert.ok(r.ok, JSON.stringify(r));
  return r.graph;
};
/** @param {any} graph @param {{ text: string, status: string }[]} items @param {number} [at] @returns {any} */
const plan = (graph, items, at = T1) => tg.applyPlan(graph, items, { at, crew: "agent" });
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);
/** A graph of the agent's own, its w1 running. */
const running = () => tasks(tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }, { id: "w2", name: "Events as triggers", needs: ["w1"] }] }), { action: "start", ids: ["w1"] });
const STEPS = [I("Read the runner", "done"), I("Write the tests", "doing"), I("Implement")];

test("a checklist naming none of the graph's tasks, while a task of the agent's own runs: that task's steps — no task of their own, said", () => {
  const g = running();
  const r = plan(g, STEPS);
  assert.equal(r.changed, true);
  assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => t.id), ["w1", "w2"], "no pN made of them");
  assert.deepEqual(task(r.graph, "w1").list, STEPS);
  assert.equal(task(r.graph, "w1").state, "running");
  assert.equal(r.text, "Your checklist is w1's steps: 1 of 3 done, said on its box. 0 of 2 done · running: w1.");
  // The same list again changes nothing; a step ticked does.
  assert.equal(plan(r.graph, STEPS).changed, false);
  const next = plan(r.graph, [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement", "doing")]);
  assert.deepEqual([next.changed, task(next.graph, "w1").list[2].status], [true, "doing"]);
  // Its steps stay with it once it is done, and the page reads them.
  const done = tasks(next.graph, { action: "done", id: "w1", summary: "Stored" });
  assert.equal(task(done, "w1").list.length, 3);
  assert.deepEqual(task(tg.graphView(done), "w1").list, task(done, "w1").list);
  // Past the cap, the first kept.
  const many = plan(g, Array.from({ length: 40 }, (_, i) => I(`Step ${i + 1}`)));
  assert.equal(task(many.graph, "w1").list.length, tg.STEPS_MAX);
});

test("as it was otherwise: an item naming a task ticks it; nothing of the agent's own running, the items are tasks; a checklist's own task running is the checklist's", () => {
  // Naming a task of the graph: V2-5, the item ticks it.
  const named = plan(running(), [I("Watchers in the store", "done"), I("Events as triggers", "doing")]);
  assert.deepEqual([task(named.graph, "w1").state, task(named.graph, "w2").state, task(named.graph, "w1").list], ["done", "running", undefined]);
  // Nothing running: the items are tasks of their own, p1 …
  const idle = tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] });
  assert.deepEqual(plan(idle, STEPS).graph.tasks.map((/** @type {any} */ t) => t.id), ["w1", "p1", "p2", "p3"]);
  // A task the checklist made, running: the next checklist is the checklist, as V2-5 has it.
  const own = plan(null, [I("Read", "done"), I("Fix", "doing")]).graph;
  assert.deepEqual(plan(own, [I("Read", "done"), I("Fix", "doing"), I("Test")]).graph.tasks.map((/** @type {any} */ t) => t.id), ["p1", "p2", "p3"]);
  // A sub-agent's running task is its worker's: the agent's checklist is not its steps.
  const given = tasks(null, { action: "add", goal: "G", tasks: [{ id: "s1", name: "Theirs", by: "sub-agent", writes: ["a.js"], goal: "x", steps: ["y"], acceptance: "z" }] });
  Object.assign(task(given, "s1"), { state: "running", startedAt: T1, agent: "sa_1" });
  assert.equal(task(plan(given, STEPS).graph, "s1").list, undefined);
  // Two of its own running: the one started last.
  const later = tg.applyTasks(tasks(running(), { action: "add", tasks: [{ id: "ck", name: "One plan" }] }), { action: "start", ids: ["ck"] }, { at: T1 + 1, crew: "agent" });
  assert.ok(later.ok);
  const two = later.graph;
  const late = tg.applyPlan(two, STEPS, { at: T1 + 1, crew: "agent" });
  assert.deepEqual([task(late.graph, "ck").list?.length, task(late.graph, "w1").list], [3, undefined]);
});

test("a coding agent's checklist reaches the graph as the loop's does: the runner's plan, the graph drawn, its words in the answer", async () => {
  /** @type {any[]} */
  const planned = [];
  const runner = {
    plan: (/** @type {string} */ chain, /** @type {any[]} */ items, /** @type {any} */ o) => {
      planned.push({ chain, items, o });
      return { text: "Your checklist is w1's steps: 1 of 3 done, said on its box.", view: { rev: 7 }, changed: true };
    },
  };
  const memory = { enabled: () => true, isOpen: () => true, cfg: () => ({}) };
  const tools = createAgentTools({ memory, memoryToolsOn: () => true, graphs: () => /** @type {any} */ (runner), turns: createAgentTurns(), subagents: () => null, membersOf: () => null });
  /** @type {any[]} */
  const told = [];
  const at = { cwd: "C:/p", upstream: "claude", chain: "ch_1", turn: "t_1", graph: true, emit: (/** @type {any} */ e) => told.push(e) };
  const r = await tools.call("checklist", { items: STEPS }, at);
  assert.equal(r.isError, undefined, r.text);
  // The runner judges it as the loop's (the nudge map of 11-10, c-mirror): a running task's steps, else tasks p1, … of its
  // own — said as a coding agent's (`solo`), whose tasks tool gives no task to a sub-agent (the re-read of 67038d835, F6).
  assert.deepEqual(planned, [{ chain: "ch_1", items: STEPS, o: { cwd: "C:/p", solo: true } }]);
  assert.deepEqual(told.map((e) => e.type), ["plan", "graph"], "the checklist drawn, then the graph it changed");
  assert.match(r.text, /Your checklist is w1's steps: 1 of 3 done, said on its box\.$/);
});

// (fails before: no — the review of the merge with c-mirror, sa_412aaa50: no test drove a coding agent's checklist through
// the real runner on the steps branch)
test("a coding agent's checklist through the real runner: its running task's steps, said and drawn; with none running, tasks p1 … of its own", async () => {
  /** @type {Map<string, any>} */
  const meta = new Map([["ch_1", {}]]);
  const archive = {
    metaOf: (/** @type {string} */ id, /** @type {readonly string[]} */ keys) => (meta.has(id) ? Object.fromEntries(keys.filter((k) => meta.get(id)[k] !== undefined).map((k) => [k, meta.get(id)[k]])) : null),
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => (meta.set(id, structuredClone({ ...meta.get(id), ...patch })), meta.get(id)),
    openGraphs: () => [],
  };
  const registry = { launch: () => ({ ok: false, error: "none" }), slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, checkProblem: () => null, runProblem: () => null, guard: () => {} };
  let t = T1;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => t++ });
  const memory = { enabled: () => true, isOpen: () => true, cfg: () => ({}) };
  const tools = createAgentTools({ memory, memoryToolsOn: () => true, graphs: () => /** @type {any} */ (runner), turns: createAgentTurns(), subagents: () => null, membersOf: () => null });
  /** @type {any[]} */
  const told = [];
  const at = { cwd: "C:/p", upstream: "claude", chain: "ch_1", turn: "t_1", graph: true, emit: (/** @type {any} */ e) => told.push(e) };
  assert.ok(runner.apply("ch_1", { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] }, { crew: "agent" }).ok);
  assert.ok(runner.apply("ch_1", { action: "start", ids: ["w1"] }, { crew: "agent" }).ok);
  const r = await tools.call("checklist", { items: STEPS }, at);
  assert.match(r.text, /Your checklist is w1's steps: 1 of 3 done, said on its box\./, r.text);
  assert.deepEqual(meta.get("ch_1").graph.tasks.map((/** @type {any} */ x) => [x.id, x.list?.length ?? 0]), [["w1", 3]]);
  assert.ok(told.some((e) => e.type === "graph"), "the graph drawn");
  assert.ok(runner.apply("ch_1", { action: "done", id: "w1", summary: "Stored" }, { crew: "agent" }).ok);
  const next = await tools.call("checklist", { items: [I("Draw the page", "doing"), I("Wire the route")] }, at);
  assert.match(next.text, /p1/, next.text);
  // (the re-read of 67038d835: this pinned "a new graph of its own, w1's closed" — a graph with a goal is its planner's
  // to close, never its checklist's)
  assert.deepEqual([meta.get("ch_1").graph.closed, meta.get("ch_1").graph.tasks.map((/** @type {any} */ x) => x.id)], [null, ["w1", "p1", "p2"]], "tasks of their own on w1's graph, which no checklist closes");
});

// (fails before: yes — the review of the merge with c-mirror, sa_412aaa50: the rule asked only what ran at the call)
test("a task's steps sent again once it stopped running are still its steps: no task of their own, and no graph closed under it", () => {
  const ALL = STEPS.map((s) => I(s.text, "done"));
  // Done, with another task still waiting: no p1 … beside it.
  const done = tasks(plan(running(), STEPS).graph, { action: "done", id: "w1", summary: "Stored" });
  const again = plan(done, ALL);
  assert.deepEqual(again.graph.tasks.map((/** @type {any} */ t) => t.id), ["w1", "w2"]);
  assert.deepEqual(task(again.graph, "w1").list, ALL);
  assert.match(again.text, /^Your checklist is w1's steps: 3 of 3 done, kept on its card though it is done\./);
  // Its graph's last task done: its steps close nothing.
  const one = tasks(tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] }), { action: "start", ids: ["w1"] });
  const last = plan(tasks(plan(one, STEPS).graph, { action: "done", id: "w1", summary: "Stored" }), ALL);
  assert.deepEqual([last.closed, last.graph.closed, last.graph.tasks.map((/** @type {any} */ t) => t.id)], [null, null, ["w1"]]);
  // Paused: its steps all the same.
  const paused = tasks(plan(running(), STEPS).graph, { action: "pause", id: "w1", checkpoint: "Waiting on the schema" });
  const ticked = plan(paused, [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement")]);
  assert.deepEqual(task(ticked.graph, "w1").list[1].status, "done");
  assert.match(ticked.text, /^Your checklist is w1's steps: 2 of 3 done, kept on its card though it is paused\./);
  // A new list that shares a step or so is new work: tasks of its own.
  const fresh = plan(done, [I("Read the runner"), I("Draw the page"), I("Wire the route")]);
  assert.deepEqual(fresh.graph.tasks.map((/** @type {any} */ t) => t.id), ["w1", "w2", "p1", "p2", "p3"]);
});

// (fails before: yes — the same review: a task whose helper had ended, or a step whose sub-tasks were all dropped, held
// no steps, though each is the agent's own work again)
test("a task whose helper ended, and a step whose sub-tasks were all dropped, take its checklist as their steps; one a helper works on does not", () => {
  const helped = running();
  Object.assign(task(helped, "w1"), { helper: { agent: "sa_9" } });
  assert.deepEqual(task(tg.applyPlan(helped, STEPS, { at: T1, crew: "agent", helping: () => false }).graph, "w1").list, STEPS);
  assert.equal(task(tg.applyPlan(helped, STEPS, { at: T1, crew: "agent", helping: () => true }).graph, "w1").list, undefined);
  const stepped = tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }, { id: "s1", name: "The store's table", under: "w1" }] });
  const alone = tasks(tasks(stepped, { action: "drop", ids: ["s1"], reason: "folded into w1" }), { action: "start", ids: ["w1"] });
  assert.deepEqual(task(plan(alone, STEPS).graph, "w1").list, STEPS);
});

// (fails before: yes — the review of sa_412aaa50's fix, sa_a5bfa260: a list sharing more than half a stopped task's steps
// took that task, the newest started of several, its steps replaced — a new task's steps worded as a done one's, a list
// with a step more, one step of many)
// (the re-read of 67038d835: which task a list belongs to is kept on the graph, `stepsOf`, and no longer worked out from
// the texts. Three rows here pinned the old reading and moved: a list with a step more closed a goal's graph; one step of
// a paused task's many made a task; and of two done tasks, each with steps, the list went to the one worded like it)
test("a stopped task takes a list only as the holder of the steps: a step less, or one more that is done, is its own; a step still to do that it does not hold is new work, the task at work's or tasks", () => {
  // w1 done with its steps, w2 at work: the same steps begun anew are w2's, w1's kept; w1's sent again as they are, w1's.
  const done = tasks(tasks(plan(running(), STEPS).graph, { action: "done", id: "w1", summary: "Stored" }), { action: "start", ids: ["w2"] });
  const anew = STEPS.map((s) => I(s.text));
  const r = plan(done, anew);
  assert.deepEqual([task(r.graph, "w2").list, task(r.graph, "w1").list], [anew, STEPS]);
  const same = plan(done, STEPS);
  assert.deepEqual([same.changed, task(same.graph, "w2").list], [false, undefined]);
  assert.match(same.text, /^Your checklist is w1's steps: 1 of 3 done, kept on its card though it is done\./);
  // Its graph's last task done, nothing at work: a list with a step more, still to do, is new work — tasks of its own on
  // the graph, which a goal's graph is never closed for, w1's steps kept as they were.
  const one = tasks(tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] }), { action: "start", ids: ["w1"] });
  const more = plan(tasks(plan(one, STEPS).graph, { action: "done", id: "w1", summary: "Stored" }), [...STEPS.map((s) => I(s.text, "done")), I("Ship it")]);
  assert.deepEqual([more.closed, more.graph.closed], [null, null], "w1's graph stays open");
  assert.deepEqual([more.graph.tasks.map((/** @type {any} */ t) => t.id), task(more.graph, "w1").list], [["w1", "p1", "p2", "p3", "p4"], STEPS]);
  // Paused: a step of its many, done, sent alone is its list with steps less — no task made of it.
  const paused = tasks(plan(running(), STEPS).graph, { action: "pause", id: "w1", checkpoint: "Waiting on the schema" });
  const single = plan(paused, [I("Read the runner", "done")]);
  assert.deepEqual([task(single.graph, "w1").list, single.graph.tasks.map((/** @type {any} */ t) => t.id)], [[I("Read the runner", "done")], ["w1", "w2"]]);
  // Two done, each with its steps: w2 took a list last, so it holds the steps, and a list all done that shares a step with
  // them is its own, in the list's order and words — w1's steps, worded like it, stay as they were.
  const w2Steps = [I("Read the runner", "done"), I("Write the tests", "done"), I("Ship")];
  const two = plan(done, w2Steps);
  assert.deepEqual([task(two.graph, "w2").list, task(two.graph, "w1").list], [w2Steps, STEPS]);
  const both = tasks(two.graph, { action: "done", id: "w2", summary: "Shipped" });
  const sent = [...STEPS].reverse().map((s) => I(s.text.toUpperCase(), "done"));
  const back = plan(both, sent);
  assert.deepEqual([task(back.graph, "w1").list, task(back.graph, "w2").list, back.closed], [STEPS, sent, null]);
});

// (fails before: yes — the same review: 533405670 let a step worded as a done task's leave the list to the running task,
// so an old checklist sent again with one item more became that task's steps; an item names its task, done or not, as
// the agents' words say)
test("an item naming a task of the graph, done or not, keeps the list the checklist's: an old checklist with an item more is tasks, not the running task's steps", () => {
  const idle = tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] });
  const old = plan(idle, [I("Read the runner", "done"), I("Write the tests", "done")]).graph;
  const g = tasks(old, { action: "start", ids: ["w1"] });
  const r = plan(g, [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement")]);
  assert.deepEqual([r.graph.tasks.map((/** @type {any} */ t) => t.id), task(r.graph, "w1").list], [["w1", "p1", "p2", "p3"], undefined]);
});

// (fails before: yes — Coding Agents Fixes' review of 4ce8b5f22..ca1b9f200, sa_093fa3ef: an item naming a task added with
// the tasks tool marked it as the checklist's, so it held no steps once it ran, and a list of steps made tasks p1 … and
// dropped it, running, as it left the checklist)
test("a task added with the tasks tool that a checklist once named is still the agent's own: its steps a later list, nothing dropped", () => {
  const g = tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }, { id: "t3", name: "Page" }] });
  const named = plan(g, [I("Store"), I("Events"), I("Page")]).graph;
  assert.deepEqual(named.tasks.map((/** @type {any} */ t) => [t.id, t.checklist, t.took]), [["t1", "Store", true], ["t2", "Events", true], ["t3", "Page", true]]);
  const started = tasks(named, { action: "start", ids: ["t1"] });
  const r = plan(started, [I("Read the spec", "done"), I("Write the code", "doing"), I("Run the tests")]);
  assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => [t.id, t.state]), [["t1", "running"], ["t2", "waiting"], ["t3", "waiting"]]);
  assert.equal(task(r.graph, "t1").list.length, 3);
  assert.match(r.text, /^Your checklist is t1's steps: 1 of 3 done, said on its box\./);
  // The page keeps the graph for its steps once it stopped too.
  const paused = tasks(r.graph, { action: "pause", id: "t1", checkpoint: "Later" });
  assert.deepEqual(pageOf({ plan: task(r.graph, "t1").list, graph: tg.graphView(paused), planned: "plan" }, false), { shows: "graph", other: false });
  // A task its checklist made, running, is the checklist's still: a new list is tasks.
  const own = plan(null, [I("Read", "done"), I("Fix", "doing")]).graph;
  assert.deepEqual(plan(own, [I("Draw the page")]).graph.tasks.map((/** @type {any} */ t) => [t.id, t.state]), [["p1", "done"], ["p2", "dropped"], ["p3", "waiting"]]);
});

// (fails before: yes — the review of d73e88759, sa_efec5d53: a stopped task whose steps none were ticked done took a list
// worded as them from the task at work; items past STEPS_MAX went nowhere unsaid; a helper's task at work, its box drawing
// the helper, was said to show the steps on its box; "though it is checking")
test("beside a task at work, a stopped task's steps none of which were ticked done are the new task's; past the cap, and a box that draws its helper, said", () => {
  const UNTICKED = [I("Read the code", "doing"), I("Write the fix"), I("Run the tests")];
  const done = tasks(tasks(plan(running(), UNTICKED).graph, { action: "done", id: "w1", summary: "Stored" }), { action: "start", ids: ["w2"] });
  const r = plan(done, UNTICKED);
  assert.deepEqual([task(r.graph, "w2").list, task(r.graph, "w1").list], [UNTICKED, UNTICKED]);
  assert.match(r.text, /^Your checklist is w2's steps: 0 of 3 done, said on its box\./);
  // Nothing at work beside it: still its steps sent again.
  const alone = tasks(plan(running(), UNTICKED).graph, { action: "pause", id: "w1", checkpoint: "Waiting on the schema" });
  assert.match(plan(alone, UNTICKED).text, /^Your checklist is w1's steps: 0 of 3 done, kept on its card though it is paused\./);
  // Past the cap: said, the one at work's and a stopped task's alike.
  const many = Array.from({ length: 31 }, (_, i) => I(`Step ${i + 1}`));
  assert.match(plan(running(), many).text, /^Your checklist is w1's steps: 0 of 30 done, said on its box\. Only your first 30 items are its steps: the one after them is kept nowhere\. /);
  const thirty = tasks(plan(running(), many.slice(0, 30)).graph, { action: "pause", id: "w1", checkpoint: "Waiting" });
  assert.match(plan(thirty, [...many, I("Ship it")]).text, /kept on its card though it is paused\. Only your first 30 items are its steps: the 2 after them are kept nowhere\. /);
  // A task whose helper ended holds the steps, its box still drawing the helper: on its card.
  const helped = running();
  Object.assign(task(helped, "w1"), { helper: { agent: "sa_9" } });
  assert.match(tg.applyPlan(helped, STEPS, { at: T1, crew: "agent", helping: () => false }).text, /^Your checklist is w1's steps: 1 of 3 done, kept on its card\. /);
  // Being checked, said so.
  const checking = tasks(plan(running(), STEPS).graph, { action: "done", id: "w1", summary: "Stored" });
  Object.assign(task(checking, "w1"), { state: "checking" });
  assert.match(plan(checking, STEPS).text, /kept on its card though it is being checked\./);
});

test("the Plan page keeps the graph while it holds tasks the agent planned on it — its checklist their steps —; a checklist's own graph, or a closed one, as it was", () => {
  const items = STEPS;
  const g = tg.graphView(plan(running(), items).graph);
  assert.deepEqual(pageOf({ plan: items, graph: g, planned: "plan" }, false), { shows: "graph", other: false });
  assert.deepEqual(planCount({ plan: items, graph: g, planned: "plan" }), { done: 0, all: 2 }, "the badge counts what the page shows");
  // The checklist's own graph: the checklist shows, its graph a press away.
  const own = tg.graphView(plan(null, items).graph);
  assert.deepEqual(pageOf({ plan: items, graph: own, planned: "plan" }, false), { shows: "checklist", other: true });
  // A closed graph and a checklist after it: the checklist.
  const closed = tg.graphView({ ...plan(running(), items).graph, closed: { at: T1, reason: "done" } });
  assert.deepEqual(pageOf({ plan: items, graph: closed, planned: "plan" }, false), { shows: "checklist", other: true });
});

// (fails before: yes — the review of sa_412aaa50's fix, sa_a5bfa260: the page asked only for a running task's steps, so
// a paused or done task's steps sent again swapped the graph for the checklist)
test("the Plan page keeps the graph for a paused or done task's steps sent again, its text as the graph matches it; another checklist, as it was", () => {
  const pausedGraph = tasks(plan(running(), STEPS).graph, { action: "pause", id: "w1", checkpoint: "Waiting on the schema" });
  const paused = tg.graphView(pausedGraph);
  const again = [I("  read THE runner", "done"), I("Write the tests", "done"), I("Implement")];
  // The page reads the graph as the list left it: its steps ticked.
  const ticked = tg.graphView(plan(pausedGraph, again).graph);
  assert.deepEqual(pageOf({ plan: again, graph: ticked, planned: "plan" }, false), { shows: "graph", other: false });
  assert.deepEqual(planCount({ plan: again, graph: ticked, planned: "plan" }), { done: 0, all: 2 });
  const doneGraph = tasks(plan(running(), STEPS).graph, { action: "done", id: "w1", summary: "Stored" });
  assert.deepEqual(pageOf({ plan: STEPS, graph: tg.graphView(doneGraph), planned: "plan" }, false), { shows: "graph", other: false });
  // Another checklist: the page reads what the graph made of it (the re-read of 67038d835 — it matched the texts itself
  // before, against a graph the list had never reached).
  const more = [...STEPS, I("Ship it")];
  assert.deepEqual(pageOf({ plan: more, graph: tg.graphView(plan(doneGraph, more).graph), planned: "plan" }, false), { shows: "checklist", other: true });
  const other = [I("Draw the page")];
  assert.deepEqual(pageOf({ plan: other, graph: tg.graphView(plan(pausedGraph, other).graph), planned: "plan" }, false), { shows: "checklist", other: true });
  assert.equal(paused?.stepsOf, "w1", "its holder, as the page is given it");
});

// (fails before: yes — the review of d73e88759, sa_efec5d53: the page matched by text alone, so a list worded as a done
// task's steps begun anew — tasks of its own on the graph — showed the graph; a checklist-made task's steps matched; and a
// blank or doubled item kept the page from a paused task's steps the graph took)
// (the re-read of 67038d835: the page reads which task holds the steps from the graph and matches no text. Its row "a
// task its checklist named" went with that: it held the page's own clause to a view no graph makes — a task its checklist
// made never holds steps, which the row below it in the case table still pins on the graph)
test("the Plan page shows what the graph made of a list: tasks of its own where its steps were begun anew, a task's steps with blank and doubled items aside", () => {
  const ALL = STEPS.map((s) => I(s.text, "done"));
  const g = tasks(tasks(plan(running(), ALL).graph, { action: "done", id: "w1", summary: "Stored" }), { action: "start", ids: ["w2"] });
  const w2 = tasks(g, { action: "pause", id: "w2", checkpoint: "Later" });
  const anew = STEPS.map((s) => I(s.text));
  const r = plan(w2, anew);
  assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => t.id), ["w1", "w2", "p1", "p2", "p3"], "the graph made them tasks");
  assert.deepEqual(pageOf({ plan: anew, graph: tg.graphView(r.graph), planned: "plan" }, false), { shows: "checklist", other: true });
  assert.deepEqual(planCount({ plan: anew, graph: tg.graphView(r.graph), planned: "plan" }), { done: 0, all: 3 });
  const paused = tasks(plan(running(), STEPS).graph, { action: "pause", id: "w1", checkpoint: "Waiting on the schema" });
  for (const [what, items] of /** @type {[string, { text: string, status: string }[]][]} */ ([["a blank item", [...STEPS, I("   ")]], ["an item doubled", [...STEPS, I("read the RUNNER", "done")]]])) {
    const after = plan(paused, items);
    assert.deepEqual([after.graph.tasks.map((/** @type {any} */ t) => t.id), task(after.graph, "w1").list], [["w1", "w2"], STEPS], what);
    assert.deepEqual(pageOf({ plan: items, graph: tg.graphView(after.graph), planned: "plan" }, false), { shows: "graph", other: false }, what);
  }
});

// (fails before: yes — only an open graph was looked at, so a done task's steps sent again after its graph closed made a
// new graph of tasks p1 … all done, which the agent was told to close again)
test("a task's steps sent again after its graph closed are still its steps: kept on it, the graph left closed; another list starts a new graph", () => {
  const ALL = STEPS.map((s) => I(s.text, "done"));
  const one = tasks(tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] }), { action: "start", ids: ["w1"] });
  const done = tasks(plan(one, STEPS).graph, { action: "done", id: "w1", summary: "Stored" });
  const closed = tasks(done, { action: "close", reason: "The watchers are stored" });
  const again = plan(closed, ALL);
  assert.deepEqual([again.changed, again.closed, again.graph.closed, again.graph.tasks.map((/** @type {any} */ t) => t.id)], [true, null, closed.closed, ["w1"]]);
  assert.deepEqual(task(again.graph, "w1").list, ALL);
  assert.equal(task(again.graph, "w1").state, "done");
  assert.equal(again.text, "Your checklist is w1's steps: 3 of 3 done, kept on its card though it is done. Its task graph stays closed.");
  // The same again changes nothing.
  const same = plan(again.graph, ALL);
  assert.deepEqual([same.changed, same.graph], [false, again.graph]);
  // Another list, one with a step more, or one naming its task: a new graph, as before.
  for (const items of [[I("Draw the page", "doing"), I("Wire the route")], [...ALL, I("Ship it")], [I("Watchers in the store", "done")]]) {
    const fresh = plan(closed, items);
    assert.equal(fresh.graph.closed, null, JSON.stringify(items));
    assert.match(fresh.text, /^Your checklist starts a new task graph: p1/);
  }
  // A graph carried on in a new chat: its tasks are that chat's, so a list here starts a new graph.
  const carried = tg.carriedAway(done, { at: T1, to: "ch_2", title: "Next" });
  assert.deepEqual(plan(carried, ALL).graph.tasks.map((/** @type {any} */ t) => t.id), ["p1", "p2", "p3"]);
});

// (fails before: yes — the same: through the real runner, the checklist sent again after the close made tasks p1 to p3)
test("a coding agent's checklist sent again after its graph closed, through the real runner: its task's steps, the graph kept closed", async () => {
  /** @type {Map<string, any>} */
  const meta = new Map([["ch_1", {}]]);
  const archive = {
    metaOf: (/** @type {string} */ id, /** @type {readonly string[]} */ keys) => (meta.has(id) ? Object.fromEntries(keys.filter((k) => meta.get(id)[k] !== undefined).map((k) => [k, meta.get(id)[k]])) : null),
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) => (meta.set(id, structuredClone({ ...meta.get(id), ...patch })), meta.get(id)),
    openGraphs: () => [],
  };
  const registry = { launch: () => ({ ok: false, error: "none" }), slots: () => 4, tell: () => {}, stop: () => ({ ok: true }), resumable: () => null, checkProblem: () => null, runProblem: () => null, guard: () => {} };
  let t = T1;
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => t++ });
  const memory = { enabled: () => true, isOpen: () => true, cfg: () => ({}) };
  const tools = createAgentTools({ memory, memoryToolsOn: () => true, graphs: () => /** @type {any} */ (runner), turns: createAgentTurns(), subagents: () => null, membersOf: () => null });
  const at = { cwd: "C:/p", upstream: "claude", chain: "ch_1", turn: "t_1", graph: true, emit: () => {} };
  assert.ok(runner.apply("ch_1", { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] }, { crew: "agent" }).ok);
  assert.ok(runner.apply("ch_1", { action: "start", ids: ["w1"] }, { crew: "agent" }).ok);
  await tools.call("checklist", { items: STEPS }, at);
  assert.ok(runner.apply("ch_1", { action: "done", id: "w1", summary: "Stored" }, { crew: "agent" }).ok);
  assert.ok(runner.apply("ch_1", { action: "close", reason: "The watchers are stored" }, { crew: "agent" }).ok);
  const r = await tools.call("checklist", { items: STEPS.map((s) => I(s.text, "done")) }, at);
  assert.match(r.text, /Your checklist is w1's steps: 3 of 3 done, kept on its card though it is done\. Its task graph stays closed\./, r.text);
  const kept = meta.get("ch_1").graph;
  assert.deepEqual([kept.closed?.reason, kept.tasks.map((/** @type {any} */ x) => [x.id, x.state, x.list.filter((/** @type {any} */ s) => s.status === "done").length])], ["The watchers are stored", [["w1", "done", 3]]]);
});

// (fails before: yes — the page took the checklist for a running task's steps whenever one kept steps, whatever the
// checklist was: one naming the graph's tasks, or one the graph made tasks of before the task ran again)
test("the Plan page takes a checklist for a running task's steps only where the graph put it there; the graph and the page agree case by case", () => {
  const g = plan(running(), STEPS).graph;
  // A list naming a task of the graph is the checklist's, w1 keeping its steps.
  const named = [I("Events as triggers"), I("Draw the page")];
  const r = plan(g, named);
  assert.deepEqual([task(r.graph, "w1").list, r.graph.tasks.map((/** @type {any} */ t) => t.id)], [STEPS, ["w1", "w2", "p1"]]);
  assert.deepEqual(pageOf({ plan: named, graph: tg.graphView(r.graph), planned: "plan" }, false), { shows: "checklist", other: true });
  // Tasks made of a list while nothing ran, then w1 started again with its old steps: the list is those tasks still.
  const other = [I("Draw the page", "doing"), I("Wire the route")];
  const made = plan(tasks(g, { action: "pause", id: "w1", checkpoint: "Later" }), other);
  assert.deepEqual(made.graph.tasks.map((/** @type {any} */ t) => t.id), ["w1", "w2", "p1", "p2"]);
  const back = tg.graphView(tasks(made.graph, { action: "start", ids: ["w1"] }));
  assert.deepEqual(pageOf({ plan: other, graph: back, planned: "plan" }, false), { shows: "checklist", other: true });
  assert.deepEqual(planCount({ plan: other, graph: back, planned: "plan" }), { done: 0, all: 2 }, "the badge counts the checklist");
  // Case by case, the graph's word on a list and the page's on the graph it left: the page shows the graph where the
  // list became a task's steps, the checklist where it became tasks.
  const ALL = STEPS.map((s) => I(s.text, "done"));
  const UNTICKED = [I("Read the code", "doing"), I("Write the fix"), I("Run the tests")];
  const doneBeside = (/** @type {any[]} */ steps) => tasks(tasks(plan(running(), steps).graph, { action: "done", id: "w1", summary: "Stored" }), { action: "start", ids: ["w2"] });
  const helped = running();
  Object.assign(task(helped, "w1"), { helper: { agent: "sa_9" } });
  const took = tasks(plan(tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }] }), [I("Store"), I("Events")]).graph, { action: "start", ids: ["t1"] });
  /** @type {[string, any, { text: string, status: string }[]][]} */
  const cases = [
    ["a running task's steps", running(), STEPS],
    ["ticked on", g, [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement", "doing")]],
    ["a list naming a task", g, named],
    ["tasks made while nothing ran", tasks(g, { action: "pause", id: "w1", checkpoint: "Later" }), other],
    ["those tasks' list, w1 at work again", tasks(made.graph, { action: "start", ids: ["w1"] }), other],
    ["one step of a paused task's many", tasks(g, { action: "pause", id: "w1", checkpoint: "Later" }), [I("Read the runner", "done")]],
    ["a done task's steps begun anew beside one at work", doneBeside(STEPS), STEPS.map((s) => I(s.text))],
    ["a done task's steps sent again beside one at work", doneBeside(STEPS), STEPS],
    ["never-ticked steps beside one at work", doneBeside(UNTICKED), UNTICKED],
    ["all done, sent again", tasks(plan(running(), STEPS).graph, { action: "done", id: "w1", summary: "Stored" }), ALL],
    ["a task a helper works on", helped, STEPS],
    ["a checklist's own task at work", plan(null, [I("Read", "done"), I("Fix", "doing")]).graph, [I("Draw the page")]],
    ["a task an item took, at work", took, STEPS],
    ["past the cap", running(), Array.from({ length: 31 }, (_, i) => I(`Step ${i + 1}`))],
  ];
  for (const [what, before, items] of cases) {
    const after = plan(before, items);
    const steps = /^Your checklist is \w+'s steps:/.test(after.text);
    assert.equal(pageOf({ plan: items, graph: tg.graphView(after.graph), planned: "plan" }, false).shows, steps ? "graph" : "checklist", what);
  }
});

test("its box says the step it is on, and its card lists them, each with its mark", () => {
  const g = plan(running(), STEPS).graph;
  const el = drawGraph(tg.graphView(g), { h: fakeH, now: T1 + 5000, chosen: "w1" }).el;
  /** @param {any} n @returns {any} */
  const w1 = (n) => (n?.attrs?.["data-id"] === "w1" ? n : (n?.kids || []).map(w1).find(Boolean));
  assert.equal(textOf(w1(el)), "w1|Watchers in the store|step 2 of 3 · Write the tests");
  const drawn = textOf(el);
  assert.match(drawn, /Steps\|1 of 3 done/);
  assert.match(drawn, /Read the runner\|.*Write the tests\|.*Implement/);
  // None doing: how many are done.
  const between = plan(g, [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement")]).graph;
  const el2 = drawGraph(tg.graphView(between), { h: fakeH, now: T1 + 5000 }).el;
  assert.equal(textOf(w1(el2)), "w1|Watchers in the store|2 of 3 steps done");
});

test("the agents' words: on every engine, a checklist kept while a task of the graph runs is that task's steps, named in task or by naming none of the graph's", () => {
  assert.equal(PROMPT_VERSION, 129);
  assert.match(CODER_GRAPH_TEXT, /its items are tasks of yours on this graph, p1, p2, … in the order you first gave them[^]*While a task you added with the tasks tool runs \(start it first\), a checklist that names it in task, or names none of the graph's tasks, is that task's steps instead: Filament says them on its box, and makes no task of them, so list only that task's steps there\./);
  assert.match(PROMPT.graph, /doing starts it, done ends it\. While a task you added with the tasks tool runs \(start it first\), a checklist that names it in task, or names none of the graph's tasks, is that task's steps instead: Filament says them on its box, and makes no task of them\./);
  // The field both doors take, the loop's plan and a coding agent's checklist.
  for (const tool of [PLAN_TOOL, CODER_CHECKLIST_TOOL]) assert.equal(/** @type {any} */ (tool.input_schema.properties).task.description, "The id of a running task you added with the tasks tool: these items are its steps, not tasks of their own.");
});
