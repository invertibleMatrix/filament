// @ts-check
// Which task holds the checklist (the owner's of 11-11, after the re-read of 67038d835). A checklist is sent whole each
// time, and is one of three things: the checklist of the graph's tasks, the steps of one task, or a new checklist. Which
// task a steps list belonged to was worked out again at each send from the texts, in the core and once more on the Plan
// page, and the rows nobody tested went wrong: tasks added with the tasks tool were dropped as a list of steps arrived
// while none of them ran (F1), a done task's steps sent again with a step less, reworded or added closed its graph and
// started one of done tasks (F2), a running task's steps moved to another task started later (F3), a closed graph's done
// task took new work worded as its never-ticked steps (F4), a paused task started again was never the newest started
// (F5), a coding agent was told to give a task to a sub-agent its tool refuses (F6), and the page matched texts itself
// (F7, F9). Now the graph keeps which task holds the steps (`stepsOf`), and the page reads it.
// (fails before: yes — each row names its finding; a row marked "as before" pins what the rule keeps)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tg from "../src/core/task-graph.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { pageOf, planCount } from "../src/ui/harness/views/plan.js";

const T1 = 1000;
/** @param {string} text @param {string} [status] */
const I = (text, status = "pending") => ({ text, status });
/** A tasks call, taken. @param {any} graph @param {any} input @param {number} [at] @returns {any} */
const tasks = (graph, input, at = T1) => {
  const r = tg.applyTasks(graph, input, { at, crew: "agent" });
  assert.ok(r.ok, JSON.stringify(r));
  return r.graph;
};
/** A checklist against the graph. @param {any} graph @param {{ text: string, status: string }[]} items @param {Record<string, any>} [o] @returns {any} */
const plan = (graph, items, o = {}) => tg.applyPlan(graph, items, { at: T1, crew: "agent", ...o });
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);
/** @param {any} graph */
const states = (graph) => graph.tasks.map((/** @type {any} */ t) => `${t.id}:${t.state}`).join(" ");
/** The graph as the page is given it. @param {any} graph @returns {any} */
const view = (graph) => tg.graphView(graph);
/** What the page shows for a checklist the agent keeps on this graph. @param {any} graph @param {any[]} items */
const shows = (graph, items) => pageOf({ plan: items, graph: view(graph), planned: "plan" }, false).shows;

const STEPS = [I("Read the runner", "done"), I("Write the tests", "doing"), I("Implement")];
const ALL = STEPS.map((s) => I(s.text, "done"));
const UNTICKED = [I("Read the code", "doing"), I("Write the fix"), I("Run the tests")];
const NEW = [I("Draw the page", "doing"), I("Wire the route")];

/** Two tasks of the agent's own, neither needing the other. */
const two = () => tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }, { id: "w2", name: "Events as triggers" }] });
/** `two`, its w1 at work. */
const running = () => tasks(two(), { action: "start", ids: ["w1"] });
/** A goal's graph of one task, at work. */
const one = () => tasks(tasks(null, { action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] }), { action: "start", ids: ["w1"] });
/** `one`, its task done holding these steps. @param {any[]} [steps] */
const ended = (steps = STEPS) => tasks(plan(one(), steps).graph, { action: "done", id: "w1", summary: "Stored" });
/** `ended`, its graph closed. @param {any[]} [steps] */
const shut = (steps = STEPS) => tasks(ended(steps), { action: "close", reason: "The watchers are stored" });
/** Three tasks added with the tasks tool, each named by an item of a checklist since. */
const took = () => plan(tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }, { id: "t3", name: "Page" }] }), [I("Store"), I("Events"), I("Page")]).graph;
/** `took`, its t1 at work holding steps. */
const tookAtWork = () => plan(tasks(took(), { action: "start", ids: ["t1"] }), [I("Read the spec", "doing"), I("Write the code")]).graph;

const STAYS_ALL = "t1, t2 and t3 left your checklist: your checklist did not make them, so they stay on your task graph as they are — tasks drop takes them off.";

// ---- rule 1 and 4, F1: only the tasks the checklist made are dropped by leaving it -----------------------------------

// (fails before: yes — F1: "t1, t2 left your checklist, dropped", a paused one with its checkpoint, a running one a helper
// worked on)
test("F1: a list naming none, while none of the agent's own tasks is at work, makes tasks of its own and drops no task added with the tasks tool — before a start, after a pause, between a done and a start, while a helper works one", () => {
  const helped = /** @type {any} */ (tg.helperTook(took(), "t1", { agent: "sa_1", model: "m", copy: false, at: T1 }));
  /** @type {[string, any, Record<string, any>, string][]} */
  const rows = [
    ["before a start", took(), {}, "t1:waiting t2:waiting t3:waiting p1:running p2:waiting"],
    ["after a pause", tasks(tookAtWork(), { action: "pause", id: "t1", checkpoint: "Waiting on the schema" }), {}, "t1:paused t2:waiting t3:waiting p1:running p2:waiting"],
    ["between a done and a start", tasks(tookAtWork(), { action: "done", id: "t1", summary: "Stored" }), {}, "t1:done t2:waiting t3:waiting p1:running p2:waiting"],
    ["while a helper works one", helped, { helping: () => true }, "t1:running t2:waiting t3:waiting p1:running p2:waiting"],
  ];
  assert.deepEqual(rows.map(([what, before, o]) => [what, states(plan(before, NEW, o).graph)]), rows.map(([what, , , want]) => [what, want]));
  for (const [what, before, o] of rows) {
    const r = plan(before, NEW, o);
    assert.match(r.text, /^On your task graph as p1, p2 — new: p1, p2\. /, what);
    assert.doesNotMatch(r.text, /dropped/, what);
    assert.equal(r.closed, null, what);
  }
  // The paused one keeps its checkpoint and its steps.
  const paused = plan(rows[1][1], NEW).graph;
  assert.deepEqual([task(paused, "t1").checkpoint?.n, task(paused, "t1").list.length], [1, 2]);
  // Said once, in plain words: the tasks are no longer the checklist's, so the next list says nothing of them.
  const first = plan(took(), NEW);
  assert.ok(first.text.includes(STAYS_ALL), first.text);
  assert.deepEqual(first.graph.tasks.slice(0, 3).map((/** @type {any} */ t) => [t.checklist, t.took, t.item]), [[undefined, undefined, undefined], [undefined, undefined, undefined], [undefined, undefined, undefined]]);
  const again = plan(first.graph, [I("Draw the page", "done"), I("Wire the route", "doing")]);
  assert.doesNotMatch(again.text, /left your checklist/);
  assert.equal(states(again.graph), "t1:waiting t2:waiting t3:waiting p1:done p2:running");
});

// (fails before: yes — F1's other half: a task added with the tasks tool whose item went was dropped, open or paused)
test("rule 1: a task added with the tasks tool whose item leaves the checklist stays as it is, said once; one the checklist made is dropped, as before", () => {
  const r = plan(took(), [I("Store", "doing"), I("Events")]);
  assert.equal(states(r.graph), "t1:running t2:waiting t3:waiting");
  assert.equal(r.text, "On your task graph as t1, t2 — t1 started. t3 left your checklist: your checklist did not make it, so it stays on your task graph as it is — tasks drop takes it off. 0 of 3 done · running: t1 · ready: t2, t3.");
  const again = plan(r.graph, [I("Store", "doing"), I("Events")]);
  assert.deepEqual([again.changed, again.text], [false, "On your task graph as t1, t2. 0 of 3 done · running: t1 · ready: t2, t3."]);
  // Named again by its name, it is the checklist's again.
  const back = plan(r.graph, [I("Store", "doing"), I("Events"), I("Page")]);
  assert.deepEqual([task(back.graph, "t3").checklist, task(back.graph, "t3").took], ["Page", true]);
  // An item's own task (p1 …) that leaves the list is dropped, a tasks-tool task beside it kept.
  const mixed = plan(took(), [I("Store"), I("Events"), I("Page"), I("Release")]).graph;
  const gone = plan(mixed, [I("Store"), I("Events")]);
  assert.equal(states(gone.graph), "t1:waiting t2:waiting t3:waiting p1:dropped");
  assert.match(gone.text, /p1 left your checklist, dropped\. t3 left your checklist: your checklist did not make it, so it stays on your task graph as it is — tasks drop takes it off\./);
});

// ---- rule 2, F2: its holder's steps sent again, not at work ----------------------------------------------------------

// (fails before: yes — F2: a step less, one reworded or one added closed the graph ("Filament closed it (every task
// done)") and started p1 … all done)
test("F2: a done task's steps sent again with a step less, one reworded or one added, each done, are its steps still — nothing closed, no task made; a step still to do that it does not hold is new work", () => {
  /** @type {[string, { text: string, status: string }[]][]} */
  const rows = [
    ["a step less", [I("Read the runner", "done"), I("Write the tests", "done")]],
    ["one reworded, done", [I("Read the runner", "done"), I("Write every test", "done"), I("Implement", "done")]],
    ["one added, done", [...ALL, I("Ship it", "done")]],
    ["a late tick", ALL],
  ];
  /** What a list left: whether it closed the graph, and the tasks. @param {any} r */
  const left = (r) => [r.closed ? "closed" : "open", states(r.graph)];
  assert.deepEqual(rows.map(([what, items]) => [what, ...left(plan(ended(), items))]), rows.map(([what]) => [what, "open", "w1:done"]));
  for (const [what, items] of rows) {
    const r = plan(ended(), items);
    assert.deepEqual([r.closed, r.graph.closed, states(r.graph)], [null, null, "w1:done"], what);
    assert.deepEqual(task(r.graph, "w1").list, items, what);
    assert.match(r.text, new RegExp(`^Your checklist is w1's steps: ${items.length} of ${items.length} done, kept on its card though it is done\\. `), what);
    assert.deepEqual([view(r.graph).stepsOf, view(r.graph).stepsListed, shows(r.graph, items)], ["w1", true, "graph"], what);
  }
  // One added that is still to do is new work: tasks of its own on the graph, which a goal's graph is never closed for.
  const open = plan(ended(), [...ALL, I("Ship it")]);
  assert.deepEqual([open.closed, open.graph.closed, states(open.graph)], [null, null, "w1:done p1:done p2:done p3:done p4:waiting"]);
  assert.deepEqual(task(open.graph, "w1").list, STEPS, "its steps kept as they were");
  assert.match(open.text, /^On your task graph as p1 to p4 — new: p1, p2, p3, p4\. /);
  assert.deepEqual([view(open.graph).stepsOf, view(open.graph).stepsListed, shows(open.graph, [...ALL, I("Ship it")])], ["w1", false, "checklist"]);
  // A done step taken back is new work too, as before.
  assert.equal(states(plan(ended(), STEPS.map((s) => I(s.text))).graph), "w1:done p1:waiting p2:waiting p3:waiting");
  // A done task's own step that starts, its graph open, is its step still (it can be started again): said done.
  const on = plan(ended(), [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement", "doing")]);
  assert.match(on.text, /^Your checklist is w1's steps: 2 of 3 done, kept on its card though it is done\. /);
});

// (fails before: yes — F2 through the real runner: the graph closed, p1 and p2 made done)
test("F1 and F2 through the real runner: a coding agent's steps sent again with a step less stay its done task's; its list between a done and a start drops no task", async () => {
  const rig = () => {
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
    /** @param {any} input */
    const call = (input) => assert.ok(runner.apply("ch_1", input, { crew: "agent", solo: true }).ok, JSON.stringify(input));
    return { call, told, checklist: (/** @type {any[]} */ items) => tools.call("checklist", { items }, at), graph: () => meta.get("ch_1").graph };
  };
  // F2: w1 done holding three steps, two of them sent again.
  const a = rig();
  a.call({ action: "add", goal: "Watchers", tasks: [{ id: "w1", name: "Watchers in the store" }] });
  a.call({ action: "start", ids: ["w1"] });
  await a.checklist(STEPS);
  a.call({ action: "done", id: "w1", summary: "Stored" });
  const less = await a.checklist([I("Read the runner", "done"), I("Write the tests", "done")]);
  assert.match(less.text, /Your checklist is w1's steps: 2 of 2 done, kept on its card though it is done\./, less.text);
  assert.deepEqual([a.graph().closed, a.graph().tasks.map((/** @type {any} */ x) => [x.id, x.state, x.list.length]), a.graph().stepsOf], [null, [["w1", "done", 2]], "w1"]);
  assert.equal(a.told.findLast((e) => e.type === "graph").graph.stepsOf, "w1", "the page hears who holds them");
  // F1: t1 and t2 named by a checklist, t1 done, then a list of steps before t2 starts.
  const b = rig();
  b.call({ action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }] });
  await b.checklist([I("Store", "doing"), I("Events")]);
  b.call({ action: "done", id: "t1", summary: "Stored" });
  const steps = await b.checklist(NEW);
  assert.doesNotMatch(steps.text, /dropped/, steps.text);
  assert.match(steps.text, /t2 left your checklist: your checklist did not make it, so it stays on your task graph as it is — tasks drop takes it off\./);
  assert.deepEqual(b.graph().tasks.map((/** @type {any} */ x) => [x.id, x.state]), [["t1", "done"], ["t2", "waiting"], ["p1", "running"], ["p2", "waiting"]]);
  // F6: its tool takes no `by`, so its tick names no sub-agent.
  assert.match(steps.text, /Give one a check or needs with tasks change, by its id\./);
  assert.doesNotMatch(steps.text, /sub-agent/);
});

// ---- rule 2 and 3, F3 and F5: the holder at work, and the newest started -----------------------------------------------

// (fails before: yes — F3: the tick went to t1, started later by its helper, and t2 kept its stale list for good)
test("F3: the steps of a task at work stay its own as another of the agent's tasks starts later — none of them ticked done yet", () => {
  const g = plan(tasks(tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }] }), { action: "start", ids: ["t2"] }), [I("a", "doing"), I("b"), I("c")]).graph;
  // Its helper takes t1, which starts it, and ends: t1 is the agent's own again, started after t2.
  const helped = /** @type {any} */ (tg.helperTook(g, "t1", { agent: "sa_1", model: "m", copy: false, at: T1 + 5 }));
  assert.deepEqual([task(helped, "t1").state, task(helped, "t1").startedAt > task(helped, "t2").startedAt], ["running", true]);
  const ticked = [I("a", "done"), I("b", "doing"), I("c")];
  const r = plan(helped, ticked, { helping: () => false });
  assert.deepEqual([task(r.graph, "t2").list, task(r.graph, "t1").list], [ticked, undefined]);
  assert.match(r.text, /^Your checklist is t2's steps: 1 of 3 done, said on its box\. /);
  assert.doesNotMatch(r.text, /held your steps/);
  // A list that shares none of them is the one started last's, which holds the steps from then on: said as they move,
  // and the task that held them keeps its own.
  const other = plan(helped, NEW, { helping: () => false });
  assert.deepEqual([task(other.graph, "t1").list, task(other.graph, "t2").list.length, view(other.graph).stepsOf], [NEW, 3, "t1"]);
  // (t1's box names the helper that worked on it, so its steps are on its card.)
  assert.match(other.text, /^Your checklist is t1's steps: 0 of 2 done, kept on its card\. t2 held your steps until now, and keeps those it had\. /);
  assert.doesNotMatch(plan(other.graph, [I("Draw the page", "done"), I("Wire the route", "doing")], { helping: () => false }).text, /held your steps/, "said as they move, not again");
  // Alone at work, a list that shares nothing with its steps replaces them, as before.
  const alone = plan(g, NEW);
  assert.deepEqual([task(alone.graph, "t2").list, view(alone.graph).stepsOf], [NEW, "t2"]);
  assert.doesNotMatch(alone.text, /held your steps/);
});

// (fails before: yes — F5: a paused task keeps when it first started, so started again it was never the newest)
test("F5: of two of the agent's own at work, the one started last holds a new list — a paused one started again by when it started again", () => {
  let g = tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }] });
  g = tasks(g, { action: "start", ids: ["t1"] }, T1);
  g = tasks(g, { action: "pause", id: "t1", checkpoint: "Waiting on the schema" }, T1 + 1);
  g = tasks(g, { action: "start", ids: ["t2"] }, T1 + 2);
  g = tasks(g, { action: "start", ids: ["t1"] }, T1 + 3);
  assert.deepEqual([task(g, "t1").startedAt, task(g, "t2").startedAt], [T1, T1 + 2], "a paused one keeps when it first started");
  const r = plan(g, STEPS);
  assert.deepEqual([task(r.graph, "t1").list, task(r.graph, "t2").list], [STEPS, undefined]);
});

// ---- rule 2 and 4, F4: a closed graph --------------------------------------------------------------------------------

// (fails before: yes — F4: "Your checklist is w1's steps: 1 of 3 done … Its task graph stays closed.", no graph for the
// new job)
test("F4: on a closed graph, a list worded as a done task's steps whose step starts is new work — a new graph; all done, a tick alone or unchanged, they are its steps still, the graph kept closed", () => {
  const closed = shut(UNTICKED);
  /** @type {[string, { text: string, status: string }[]][]} */
  const anew = [
    ["the first done, the next begun", [I("Read the code", "done"), I("Write the fix", "doing"), I("Run the tests")]],
    ["none begun yet", UNTICKED.map((s) => I(s.text))],
    ["two begun", [I("Read the code", "doing"), I("Write the fix", "doing"), I("Run the tests")]],
  ];
  assert.deepEqual(anew.map(([what, items]) => [what, plan(closed, items).graph.closed ? "kept closed" : "a new graph"]), anew.map(([what]) => [what, "a new graph"]));
  for (const [, items] of anew) {
    const r = plan(closed, items);
    assert.equal(r.graph.closed, null, JSON.stringify(items));
    assert.match(r.text, /^Your checklist starts a new task graph: p1 to p3\. /, JSON.stringify(items));
    assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => t.id), ["p1", "p2", "p3"]);
  }
  /** @type {[string, { text: string, status: string }[], boolean, number][]} */
  const still = [
    ["all done", UNTICKED.map((s) => I(s.text, "done")), true, 3],
    ["a tick alone", [I("Read the code", "done"), I("Write the fix"), I("Run the tests")], true, 1],
    ["unchanged", UNTICKED, false, 0],
  ];
  for (const [what, items, changed, done] of still) {
    const r = plan(closed, items);
    assert.deepEqual([r.changed, r.closed, r.graph.closed, states(r.graph)], [changed, null, closed.closed, "w1:done"], what);
    assert.equal(r.text, `Your checklist is w1's steps: ${done} of 3 done, kept on its card though it is done. Its task graph stays closed.`, what);
    // A closed graph is no plan the page keeps: the checklist shows, the graph a press away.
    assert.equal(shows(r.graph, items), "checklist", what);
  }
});

// ---- rule 4: what a new checklist closes -----------------------------------------------------------------------------

// (fails before: yes — a goal's graph, its tasks all done, was closed by the next checklist and a new one started)
test("rule 4: a new checklist joins a graph with a goal or a task added with the tasks tool, all done or not — never closed from the checklist; a checklist's own graph, all done, is closed and a new one started, as before", () => {
  const goal = plan(tasks(one(), { action: "done", id: "w1", summary: "Stored" }), NEW);
  assert.deepEqual([goal.closed, goal.graph.closed, states(goal.graph)], [null, null, "w1:done p1:running p2:waiting"]);
  assert.match(goal.text, /^On your task graph as p1, p2 — new: p1, p2\. /);
  // A checklist's graph the agent added a task to with the tasks tool: joined too.
  let own = plan(null, [I("Read", "doing")]).graph;
  own = tasks(own, { action: "add", tasks: [{ id: "t1", name: "Docs" }] });
  own = tasks(tasks(own, { action: "start", ids: ["t1"] }), { action: "done", id: "t1", summary: "Written" });
  own = plan(own, [I("Read", "done")]).graph;
  const joined = plan(own, NEW);
  assert.deepEqual([joined.closed, states(joined.graph)], [null, "p1:done t1:done p2:running p3:waiting"]);
  // A checklist's own graph, no goal and every task its own: closed, a new one started.
  const list = plan(plan(null, [I("Read", "doing")]).graph, [I("Read", "done")]).graph;
  const next = plan(list, NEW, { at: T1 + 9 });
  assert.deepEqual([next.closed?.closed, states(next.graph)], [{ at: T1 + 9, reason: "every task done" }, "p2:running p3:waiting"]);
  assert.match(next.text, /^Every task of your last task graph is done, and your checklist names none of them: Filament closed it \(every task done\)\. Your checklist starts a new one: p2, p3\. /);
});

// ---- the holder: kept on the graph, read by the page (F7, F9) ----------------------------------------------------------

// (fails before: yes — the graph kept no holder; the page matched the texts itself)
test("the graph says which task holds the steps, and whether the checklist as last sent is those steps; the page reads it", () => {
  const g = plan(running(), STEPS).graph;
  assert.deepEqual([g.stepsOf, view(g).stepsOf, view(g).stepsListed, shows(g, STEPS)], ["w1", "w1", true, "graph"]);
  assert.deepEqual(planCount({ plan: STEPS, graph: view(g), planned: "plan" }), { done: 0, all: 2 }, "the badge counts the graph");
  // A list that names a task while w1 holds steps is the checklist's: w1 keeps its steps, and is their holder still.
  const named = [I("Events as triggers"), I("Draw the page")];
  const r = plan(g, named);
  assert.deepEqual([states(r.graph), task(r.graph, "w1").list, view(r.graph).stepsOf, view(r.graph).stepsListed, shows(r.graph, named)], ["w1:running w2:waiting p1:waiting", STEPS, "w1", false, "checklist"]);
  assert.deepEqual(planCount({ plan: named, graph: view(r.graph), planned: "plan" }), { done: 0, all: 2 }, "the badge counts the checklist");
  // Its steps sent again are its steps, the checklist's tasks as they were.
  const back = plan(r.graph, ALL);
  assert.deepEqual([states(back.graph), task(back.graph, "w1").list, view(back.graph).stepsListed, shows(back.graph, ALL)], ["w1:running w2:waiting p1:waiting", ALL, true, "graph"]);
  // The page matches no text: what it is given beside the graph does not change what the graph says.
  assert.equal(pageOf({ plan: [I("Something else")], graph: view(g), planned: "plan" }, false).shows, "graph");
  // Kept through its done, a pause and a close; none once its task is dropped.
  assert.equal(view(tasks(g, { action: "done", id: "w1", summary: "Stored" })).stepsOf, "w1");
  assert.equal(view(tasks(g, { action: "pause", id: "w1", checkpoint: "Later" })).stepsOf, "w1");
  assert.equal(view(tasks(tasks(g, { action: "done", id: "w1", summary: "Stored" }), { action: "close", reason: "Stored" })).stepsOf, "w1");
  const dropped = tasks(g, { action: "drop", ids: ["w1"], reason: "Not needed" });
  assert.deepEqual([view(dropped).stepsOf, view(dropped).stepsListed, shows(dropped, STEPS)], [null, false, "checklist"]);
  // A list after the drop is a new checklist: nothing holds it.
  assert.equal(states(plan(dropped, ALL).graph), "w1:dropped w2:waiting p1:done p2:done p3:done");
});

// (fails before: yes — F9: the page asked for a task of the agent's own, which no test held to; a task given to a
// sub-agent since kept the steps and the page showed the checklist over them)
test("F9: the page shows the graph for a holder that is no longer the agent's own, and the checklist where the list became tasks though a task keeps steps worded the same", () => {
  const g = plan(running(), STEPS).graph;
  const given = tasks(g, { action: "change", tasks: [{ id: "w1", by: "sub-agent", writes: ["a.js"], goal: "x", steps: ["y"], acceptance: "z" }] });
  assert.deepEqual([task(given, "w1").by, task(given, "w1").list.length, view(given).stepsOf, shows(given, STEPS)], ["sub-agent", 3, "w1", "graph"]);
  // A done task's steps begun anew while nothing is at work are tasks of their own: the page shows the checklist.
  const done = tasks(plan(running(), ALL).graph, { action: "done", id: "w1", summary: "Stored" });
  const anew = STEPS.map((s) => I(s.text));
  const r = plan(done, anew);
  assert.deepEqual([states(r.graph), view(r.graph).stepsOf, view(r.graph).stepsListed, shows(r.graph, anew)], ["w1:done w2:waiting p1:waiting p2:waiting p3:waiting", "w1", false, "checklist"]);
  assert.deepEqual(planCount({ plan: anew, graph: view(r.graph), planned: "plan" }), { done: 0, all: 3 });
});

// (fails before: yes — no holder was read from a graph at all)
test("a graph kept before it named its holder: the one task that keeps steps holds them; where several do, none", () => {
  /** A graph as it was kept before: no holder on it. @param {any} graph */
  const old = (graph) => {
    const { stepsOf, stepsListed, ...rest } = structuredClone(graph);
    return rest;
  };
  const kept = old(tasks(plan(running(), STEPS).graph, { action: "pause", id: "w1", checkpoint: "Later" }));
  assert.deepEqual([view(kept).stepsOf, view(kept).stepsListed, shows(kept, STEPS)], ["w1", true, "graph"]);
  // Its steps ticked are its own, and the graph names its holder from then on.
  const ticked = plan(kept, ALL);
  assert.deepEqual([task(ticked.graph, "w1").list, ticked.graph.stepsOf], [ALL, "w1"]);
  // Two that keep steps: the graph does not tell whose were kept last.
  let both = plan(running(), STEPS).graph;
  both = plan(tasks(tasks(both, { action: "done", id: "w1", summary: "Stored" }), { action: "start", ids: ["w2"] }), NEW).graph;
  assert.deepEqual([both.stepsOf, view(old(both)).stepsOf, shows(old(both), NEW)], ["w2", null, "checklist"]);
  // The one at work takes the next list, and holds the steps from then on.
  assert.equal(plan(old(both), [I("Draw the page", "done"), I("Wire the route", "doing")]).graph.stepsOf, "w2");
});

// ---- the checklist names its task -------------------------------------------------------------------------------------

/** Two of the agent's own at work, t2 started last. */
const both = () => {
  let g = tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }, { id: "t3", name: "Page" }] });
  g = tasks(g, { action: "start", ids: ["t1"] }, T1);
  return tasks(g, { action: "start", ids: ["t2"] }, T1 + 1);
};

// (fails before: yes — the checklist took no `task`: the list went to t2, started last, or stayed t2's, or ticked t2 done)
test("a checklist that names its task is that task's steps, where the rule alone gives them to another: the one started last, the holder still, the task an item names", () => {
  // Started last: t2 takes a list that names none, as before; named, t1 does.
  assert.deepEqual([task(plan(both(), STEPS).graph, "t2").list, task(plan(both(), STEPS).graph, "t1").list], [STEPS, undefined], "none named: as before");
  const named = plan(both(), STEPS, { task: "t1" });
  assert.deepEqual([task(named.graph, "t1").list, task(named.graph, "t2").list, named.graph.stepsOf, view(named.graph).stepsListed], [STEPS, undefined, "t1", true]);
  assert.match(named.text, /^Your checklist is t1's steps: 1 of 3 done, said on its box\. /);
  // Its id is read as every id is, case aside.
  assert.deepEqual(task(plan(both(), STEPS, { task: " T1 " }).graph, "t1").list, STEPS);
  // The holder still: t2's steps sent again with one ticked stay t2's; named, they are t1's, said as they move.
  const held = plan(both(), STEPS).graph;
  const ticked = [I("Read the runner", "done"), I("Write the tests", "done"), I("Implement", "doing")];
  assert.deepEqual(task(plan(held, ticked).graph, "t2").list, ticked, "none named: as before");
  const moved = plan(held, ticked, { task: "t1" });
  assert.deepEqual([task(moved.graph, "t1").list, task(moved.graph, "t2").list, moved.graph.stepsOf], [ticked, STEPS, "t1"]);
  assert.match(moved.text, /^Your checklist is t1's steps: 2 of 3 done, said on its box\. t2 held your steps until now, and keeps those it had\. /);
  // An item that names a task of the graph makes the list the checklist's, and ticks it; named, it is a step's words.
  const names = [I("Events", "done"), I("Wire them")];
  assert.equal(task(plan(both(), names).graph, "t2").state, "done", "none named: as before");
  const step = plan(both(), names, { task: "t1" });
  assert.deepEqual([states(step.graph), task(step.graph, "t1").list], ["t1:running t2:running t3:waiting", names]);
});

// (fails before: yes — no `task` was read, so a wrong one changed nothing and was told nothing)
test("a checklist's task that is no task of the agent's own at work is refused in words that say which are, and the graph takes none of the list", () => {
  const ARE = "t1 and t2 are. Name one of them, or leave task out.";
  let g = plan(both(), [I("Lint", "doing")], { task: "t1" }).graph;
  g = plan(g, [I("Store"), I("Events"), I("Page"), I("Release", "doing")]).graph;
  g = tasks(g, { action: "add", tasks: [{ id: "s1", name: "Theirs", by: "sub-agent", writes: ["a.js"], goal: "x", steps: ["y"], acceptance: "z" }, { id: "st", name: "A step" }, { id: "k1", name: "Its part", under: "st" }] });
  Object.assign(task(g, "s1"), { state: "running", startedAt: T1, agent: "sa_1" });
  g = tasks(g, { action: "start", ids: ["k1"] });
  g = tasks(g, { action: "pause", id: "k1", checkpoint: "Later" });
  assert.deepEqual([task(g, "p1").state, task(g, "st").state, task(g, "k1").state], ["running", "running", "paused"]);
  /** @type {[string, string][]} */
  const rows = [
    ["t9", "no task at all"],
    ["t3", "one that waits"],
    ["p1", "one its checklist made"],
    ["s1", "a sub-agent's"],
    ["st", "a step whose sub-tasks do its work"],
    ["k1", "a paused one"],
  ];
  for (const [id, what] of rows) {
    const told = tg.stepsTask(g, id);
    assert.deepEqual(told, { ok: false, error: `task names one of your own tasks at work on your task graph, and ${id} is none: ${ARE}` }, what);
    const r = plan(g, STEPS, { task: id });
    assert.deepEqual([r.changed, r.graph, r.text], [false, g, `Your task graph took none of it: ${/** @type {any} */ (told).error}`], what);
  }
  // One a helper works on now is the helper's; once it ended, the agent's again.
  const helped = /** @type {any} */ (tg.helperTook(both(), "t1", { agent: "sa_1", model: "m", copy: false, at: T1 + 2 }));
  assert.deepEqual(tg.stepsTask(helped, "t1", () => true), { ok: false, error: "task names one of your own tasks at work on your task graph, and t1 is none: t2 is. Name it, or leave task out." });
  assert.equal(/** @type {any} */ (tg.stepsTask(helped, "t1", () => false)).task?.id, "t1");
  // None at work, a closed graph, no graph: none to name.
  const NONE = "task names one of your own tasks at work on your task graph, and none is now: start the task with tasks start first, or leave task out.";
  const idle = tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }] });
  assert.deepEqual([tg.stepsTask(idle, "t1"), tg.stepsTask(shut(), "w1"), tg.stepsTask(null, "t1")], [{ ok: false, error: NONE }, { ok: false, error: NONE }, { ok: false, error: NONE }]);
  assert.equal(plan(null, STEPS, { task: "t1" }).text, `Your task graph took none of it: ${NONE}`);
  // An empty list names no steps: as with none named.
  assert.deepEqual(plan(both(), [], { task: "t1" }), plan(both(), []));
});

// (fails before: yes — the holder named once it was done was refused, in words that said to start it)
test("a checklist that names the task that holds its steps, once that task is not at work, is read as one that names none: its last ticks stay its own", () => {
  const held = plan(both(), STEPS, { task: "t1" }).graph;
  // Marked done first, then the last ticks sent with its name: the order an agent takes as often as the other.
  const done = tasks(held, { action: "done", id: "t1", summary: "Stored" });
  assert.deepEqual(tg.stepsTask(done, "t1"), { ok: true, task: null });
  const last = plan(done, ALL, { task: "t1" });
  assert.deepEqual([task(last.graph, "t1").list, last.graph.stepsOf, states(last.graph)], [ALL, "t1", "t1:done t2:running t3:waiting"]);
  assert.deepEqual(last, plan(done, ALL), "as with none named");
  // Paused, the same.
  const paused = tasks(held, { action: "pause", id: "t1", checkpoint: "Later" });
  assert.deepEqual([tg.stepsTask(paused, "t1"), plan(paused, ALL, { task: "t1" })], [{ ok: true, task: null }, plan(paused, ALL)]);
  // Another task that is not at work is refused as it was: it holds nothing the list could be.
  assert.equal(/** @type {any} */ (tg.stepsTask(done, "t3")).error, "task names one of your own tasks at work on your task graph, and t3 is none: t2 is. Name it, or leave task out.");
});

// (fails before: yes — the checklist's `task` reached no runner: the list went to t2, and a wrong one was recorded)
test("a coding agent's checklist that names its task, through the real runner: the named task's steps; a wrong one refused before anything is drawn; a lead's, which is on no graph, refused too; none named as before", async () => {
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
  for (const input of [{ action: "add", goal: "G", tasks: [{ id: "t1", name: "Store" }, { id: "t2", name: "Events" }] }, { action: "start", ids: ["t1"] }, { action: "start", ids: ["t2"] }]) assert.ok(runner.apply("ch_1", input, { crew: "agent", solo: true }).ok);
  const listOf = (/** @type {string} */ id) => meta.get("ch_1").graph.tasks.find((/** @type {any} */ x) => x.id === id).list;
  const named = await tools.call("checklist", { items: STEPS, task: "t1" }, at);
  assert.match(named.text, /^Checklist recorded: 3 items \(1 done\)\. Your checklist is t1's steps: 1 of 3 done, said on its box\./, named.text);
  assert.deepEqual([listOf("t1"), listOf("t2"), told.map((e) => e.type)], [STEPS, undefined, ["plan", "graph"]]);
  // A wrong one: the call's error, in the graph's words; no checklist drawn, the graph as it was.
  const before = structuredClone(meta.get("ch_1").graph);
  const wrong = await tools.call("checklist", { items: NEW, task: "t9" }, at);
  assert.deepEqual(wrong, { text: "Not recorded: task names one of your own tasks at work on your task graph, and t9 is none: t1 and t2 are. Name one of them, or leave task out.", isError: true });
  assert.deepEqual([meta.get("ch_1").graph, told.map((e) => e.type)], [before, ["plan", "graph"]]);
  // A lead's checklist is on no graph: it names no task.
  const led = await tools.call("checklist", { items: NEW, task: "t1" }, { ...at, team: true });
  assert.deepEqual([led, told.length], [{ text: "Not recorded: task names one of your own tasks at work on your task graph, and this checklist is on none: leave task out.", isError: true }, 2]);
  // None named: the rule alone, t2 started last.
  const none = await tools.call("checklist", { items: NEW }, at);
  assert.match(none.text, /Your checklist is t2's steps: 0 of 2 done, said on its box\. t1 held your steps until now, and keeps those it had\./, none.text);
});

// ---- F6 and F8 ---------------------------------------------------------------------------------------------------------

// (fails before: yes — F6: "Give one a check, needs or a sub-agent with tasks change", whose `by` a coding agent's tool
// refuses)
test("F6: a coding agent's tick offers what its tasks tool takes — a check or needs, no sub-agent; the loop's agent hears of one, as before", () => {
  assert.match(plan(null, NEW, { solo: true }).text, /^Your checklist starts your task graph: p1, p2\. Give one a check or needs with tasks change, by its id\. /);
  assert.match(plan(null, NEW).text, /^Your checklist starts your task graph: p1, p2\. Give one a check, needs or a sub-agent with tasks change, by its id\. /);
});

// (fails before: yes — F8: two items alike in their first 119 characters were one, unsaid)
test("F8: items alike in the first 119 characters are one item, and the answer says so", () => {
  const long = `Fix ${"the parser ".repeat(15)}`.trim();
  const SAME = "One item reads as an earlier one in its first 119 characters, all Filament keeps of an item: it was taken as that one. Word them apart within 119 characters.";
  const r = plan(null, [I(`${long} in the lexer`), I(`${long} in the printer`), I("Run the tests")]);
  assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => t.id), ["p1", "p2"]);
  assert.ok(r.text.includes(SAME), r.text);
  // As a task's steps too; the same words twice are one item, as before, and unsaid.
  const steps = plan(running(), [I(`${long} in the lexer`, "doing"), I(`${long} in the printer`)]);
  assert.match(steps.text, /^Your checklist is w1's steps: 0 of 1 done, said on its box\. One item reads as an earlier one in its first 119 characters, /);
  assert.doesNotMatch(plan(null, [I("Look"), I("look ", "done")]).text, /reads as an earlier one/);
});

// (fails before: yes — F8: a task being checked was no open task, so a turn that changed a second file while its only
// task was checked was asked to plan)
test("F8: a task being checked counts as open — its verdict may open it again", () => {
  let g = tasks(null, { action: "add", goal: "G", tasks: [{ id: "t1", name: "Fix", check: ["npm test"] }] });
  g = tasks(tasks(g, { action: "start", ids: ["t1"] }), { action: "done", id: "t1", summary: "Fixed" });
  assert.deepEqual([task(g, "t1").state, tg.hasOpenTasks(g)], ["checking", true]);
  assert.equal(tg.hasOpenTasks(tasks(one(), { action: "done", id: "w1", summary: "Stored" })), false, "all done: none open, as before");
});

// (fails before: yes — F8: a task at work whose steps were all done heard nothing of marking it done)
test("F8: every step done on a task at work says once to mark the task done — again only once a step was open in between", () => {
  const MARK = "Every step of w1 is done: mark it done with tasks done when its work is finished.";
  const all = plan(plan(running(), STEPS).graph, ALL);
  assert.equal(all.text, `Your checklist is w1's steps: 3 of 3 done, said on its box. ${MARK} 0 of 2 done · running: w1 · ready: w2.`);
  assert.doesNotMatch(plan(all.graph, ALL).text, /mark it done/);
  const more = plan(all.graph, [...ALL, I("Ship it", "doing")]);
  assert.doesNotMatch(more.text, /mark it done/);
  assert.ok(plan(more.graph, [...ALL, I("Ship it", "done")]).text.includes(MARK));
  // Not for a task no longer at work: its done was said already.
  assert.doesNotMatch(plan(ended(), ALL).text, /mark it done with tasks done/);
});
