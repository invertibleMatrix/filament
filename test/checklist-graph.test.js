// @ts-check
// HarnessV3-TaskGraph-v2 V2-5 (§14.6; TG2-D8, TG2-D74..D78): the checklist is the graph. With the session's task graph
// on, each item the agent gives the plan tool is a task of its own on its graph — p1, p2, … in the order it first gave
// them — and the item's status moves it, forward only: doing starts it, done ends it (checked first where it has a
// check), blocked marks it. An item is matched by its text, case and spacing aside; one that left the list is dropped
// unless a task needs it; someone else's task follows its worker. A list that names none of a finished graph's tasks
// closes it and starts a new one. The plan tool, a lead's plan, a coding agent's and a sub-agent's stay as they were.
// The cases of §14.6, in order.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { alsoOpenWords, alsoRows, createStillOpen, openList } from "../src/app/agent/still-open.js";
import { PROMPT, PROMPT_VERSION, TOOL_TEXT, systemPromptFor } from "../src/app/agent/prompt.js";
import { CODER_TASKS_TOOL, PLAN_TOOL } from "../src/app/agent/tools.js";
import { CODER_GRAPH_TEXT } from "../src/app/agent-context.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { MEMBERS } from "./helpers/roster.js";

const T1 = 1000;
/** @type {{ at: number, crew: import("../src/core/task-graph.js").Crew }} */
const AT = { at: T1, crew: "agent" };
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {string} text @param {string} [status] */
const I = (text, status = "pending") => ({ text, status });
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);
/** @param {any} graph */
const states = (graph) => graph.tasks.map((/** @type {any} */ t) => `${t.id}:${t.state}${t.blocked ? "+blocked" : ""}`).join(" ");
/** A tasks call, taken. @param {any} graph @param {any} input @returns {any} */
const tasks = (graph, input) => ok(tg.applyTasks(graph, input, AT)).graph;
/** A plan call against the graph. @param {any} graph @param {{ text: string, status: string }[]} items @param {number} [at] @returns {any} */
const plan = (graph, items, at = T1) => tg.applyPlan(graph, items, { at, crew: "agent" });
const NUDGE = "Give one a check, needs or a sub-agent with tasks change, by its id.";
/** The three items most cases open with. */
const THREE = [I("Read the parser", "done"), I("Fix the trailing comma", "doing"), I("Run the tests")];
/** A sub-agent's fields, for a change that gives it a task. */
const WORKER = { by: "sub-agent", writes: ["test/more.test.js"], goal: "More tests", steps: ["Write them"], acceptance: "they pass" };

// ---- case 1: the first checklist starts the graph -------------------------------------------------------------------

// (fails before: yes — applyPlan was no export)
test("with no graph, a checklist starts one: each item a task of the agent's own, p1 … in order, its status its state, and the answer names them", () => {
  const r = plan(null, THREE);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.closed, null);
  assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => [t.id, t.name, t.by, t.checklist, t.state]), [
    ["p1", "Read the parser", "you", "Read the parser", "done"],
    ["p2", "Fix the trailing comma", "you", "Fix the trailing comma", "running"],
    ["p3", "Run the tests", "you", "Run the tests", "waiting"],
  ]);
  assert.deepEqual([r.graph.goal, r.graph.closed, r.graph.held, task(r.graph, "p1").summary, task(r.graph, "p2").startedAt], ["", null, null, "ticked on the checklist", T1]);
  assert.deepEqual([task(r.graph, "p1").check, task(r.graph, "p1").needs, task(r.graph, "p1").review, task(r.graph, "p1").blocked], [[], [], false, false]);
  assert.equal(r.text, `Your checklist starts your task graph: p1 to p3. ${NUDGE} 1 of 3 done · running: p2 · ready: p3.`);
  // Two items read as a list, not a range; blocked is waiting, marked.
  const two = plan(null, [I("Look"), I("Ask", "blocked")]);
  assert.equal(two.text, `Your checklist starts your task graph: p1, p2. ${NUDGE} 0 of 2 done · ready: p1, p2.`);
  assert.equal(states(two.graph), "p1:waiting p2:waiting+blocked");
  // An item with no text is none, and the same text twice is one task.
  assert.deepEqual(plan(null, [I("  "), I("Look"), I("look ", "done")]).graph.tasks.map((/** @type {any} */ t) => `${t.id}:${t.state}`), ["p1:waiting"]);
  // With nothing to put on it, the graph stays as it was.
  assert.deepEqual([plan(null, []).graph, plan(null, []).changed, plan(null, []).text], [null, false, ""]);
});

// ---- case 2: the same text is the same task --------------------------------------------------------------------------

// (fails before: yes)
test("a second checklist: the same texts are the same tasks, case and spacing aside, and a new text is the next free pN", () => {
  const a = plan(null, THREE.slice(0, 2)).graph;
  const b = plan(a, [I("read  the PARSER", "done"), I("Fix the trailing comma", "doing"), I("Run the tests")]);
  assert.equal(b.text, `On your task graph as p1 to p3 — new: p3. ${NUDGE} 1 of 3 done · running: p2 · ready: p3.`);
  assert.equal(task(b.graph, "p1").name, "Read the parser", "a task keeps the name it was given");
  // The same list again changes nothing, and says where each item is.
  const c = plan(b.graph, THREE);
  assert.deepEqual([c.changed, c.text], [false, "On your task graph as p1 to p3. 1 of 3 done · running: p2 · ready: p3."]);
  // An id taken by a task the agent added itself is skipped.
  const own = tasks(b.graph, { action: "add", tasks: [{ id: "p4", name: "Something else" }] });
  assert.deepEqual(plan(own, [...THREE, I("Write the docs")]).graph.tasks.map((/** @type {any} */ t) => t.id), ["p1", "p2", "p3", "p4", "p5"]);
  // A task the agent added by the tasks tool, named as an item, is that item's: no second task.
  const added = tasks(null, { action: "add", goal: "Ship", tasks: [{ id: "fix", name: "Fix the trailing comma" }] });
  const named = plan(added, [I("Fix the trailing comma", "doing")]);
  assert.deepEqual([named.graph.tasks.length, task(named.graph, "fix").state, task(named.graph, "fix").checklist], [1, "running", "Fix the trailing comma"]);
  assert.equal(named.text, "On your task graph as fix — fix started. 0 of 1 done · running: fix.");
});

// ---- case 3: forward -------------------------------------------------------------------------------------------------

// (fails before: yes)
test("forward: doing starts a task once its needs are done, done ends it — checked first where it has a check — blocked marks it and pending clears the mark", () => {
  let g = plan(null, [I("Read the parser", "done"), I("Fix the trailing comma"), I("Run the tests")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p3", needs: ["p2"] }, { id: "p2", check: ["npm test"] }] });
  const early = plan(g, [I("Read the parser", "done"), I("Fix the trailing comma"), I("Run the tests", "doing")]);
  assert.equal(early.text, "On your task graph as p1 to p3. p3 waits for its needs, p2 (waiting): it stays waiting. 1 of 3 done · ready: p2.");
  assert.equal(early.changed, false);
  const started = plan(g, [I("Read the parser", "done"), I("Fix the trailing comma", "doing"), I("Run the tests", "blocked")]);
  assert.equal(started.text, "On your task graph as p1 to p3 — p2 started; p3 blocked. 1 of 3 done · running: p2.");
  assert.equal(states(started.graph), "p1:done p2:running p3:waiting+blocked");
  const checking = plan(started.graph, [I("Read the parser", "done"), I("Fix the trailing comma", "done"), I("Run the tests", "pending")], T1 + 5);
  assert.equal(checking.text, "On your task graph as p1 to p3 — p3 no longer blocked. Checking p2: Filament runs its check in a copy of your folder now (`npm test`); it is done once that passes. Its verdict reaches you either way, and wakes this chat if your turn has ended: go on with what does not need it. Next of yours: p3 \"Run the tests\" — its item to doing as you take it up. 1 of 3 done · checking: p2 · ready: p3.");
  assert.deepEqual([task(checking.graph, "p2").state, task(checking.graph, "p2").summary, task(checking.graph, "p2").endedAt, task(checking.graph, "p2").verdict], ["checking", "ticked on the checklist", T1 + 5, null]);
  // A waiting task called done is done straight, once its needs are; one with no check is done at once.
  const straight = plan(checking.graph, [I("Read the parser", "done"), I("Fix the trailing comma", "done"), I("Run the tests", "done")]);
  assert.equal(states(straight.graph), "p1:done p2:checking p3:done", "p3 needs p2, which is being checked: the agent's own may go on");
  assert.match(straight.text, /^On your task graph as p1 to p3 — p3 done\. /);
});

// (fails before: yes — the hunt of a-red, sa_123498d1: a done the graph refused was remembered as the item's, so the same
// list sent again was held as a task "open again since its item said done" that never was done, and never ticked)
test("a done the graph refused is not remembered: the same list ticks it once its needs are, and a tick refused for its acceptance is refused again in its own words", () => {
  let g = plan(null, [I("Read the parser", "doing"), I("Fix the trailing comma")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p2", needs: ["p1"] }] });
  const refused = plan(g, [I("Read the parser", "doing"), I("Fix the trailing comma", "done")]);
  assert.match(refused.text, /p2 waits for its needs, p1 \(running\): it stays waiting\./);
  const ticked = plan(refused.graph, [I("Read the parser", "done"), I("Fix the trailing comma", "done")]);
  assert.equal(states(ticked.graph), "p1:done p2:done", ticked.text);
  assert.doesNotMatch(ticked.text, /open again/);

  let a = plan(null, [I("Write the docs", "doing")]).graph;
  a = tasks(a, { action: "change", tasks: [{ id: "p1", acceptance: "The guide says it" }] });
  const words = "p1 has acceptance and no check: tasks done with id p1, its summary and evidence — what shows that holds — ends it; a tick does not.";
  const once = plan(a, [I("Write the docs", "done")]);
  assert.ok(once.text.includes(words), once.text);
  const again = plan(once.graph, [I("Write the docs", "done")]);
  assert.ok(again.text.includes(words), again.text);
  assert.doesNotMatch(again.text, /open again/);
});

// ---- case 4: never back ----------------------------------------------------------------------------------------------

// (fails before: yes)
test("never back: a done, checking or running task its item calls back stays as it is, said", () => {
  let g = plan(null, [I("Read the parser", "done"), I("Fix the trailing comma", "doing"), I("Run the tests", "doing")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p2", check: ["npm test"] }] });
  g = tasks(g, { action: "done", id: "p2", summary: "Fixed" });
  const r = plan(g, [I("Read the parser"), I("Fix the trailing comma", "doing"), I("Run the tests", "pending")]);
  assert.equal(r.changed, false);
  assert.equal(r.text, "On your task graph as p1 to p3. p1 is done on your graph: its item does not reopen it. p2 is being checked now: its item does not reopen it. p3 is started on your graph: its item does not move it back. 1 of 3 done · running: p3 · checking: p2.");
  // A stale checklist after tasks done reopens nothing.
  const stale = plan(tasks(g, { action: "done", id: "p3", summary: "Ran them" }), [I("Read the parser", "done"), I("Fix the trailing comma", "done"), I("Run the tests", "doing")]);
  assert.equal(task(stale.graph, "p3").state, "done");
  assert.match(stale.text, / p3 is done on your graph: its item does not reopen it\. /);
});

// ---- case 5: left the checklist --------------------------------------------------------------------------------------

// (fails before: yes)
test("left the checklist: the agent's own open task is dropped and said; a done one stays; one an open task needs stays, said; someone else's stays", () => {
  let g = plan(null, [I("Read the parser", "done"), I("Fix the trailing comma", "doing"), I("Run the tests"), I("Map the callers"), I("Write more tests")]).graph;
  g = tasks(g, { action: "add", tasks: [{ id: "docs", name: "Write the docs", needs: ["p4"] }] });
  g = tasks(g, { action: "change", tasks: [{ id: "p5", ...WORKER }] });
  const r = plan(g, [I("Fix the trailing comma", "doing")], T1 + 7);
  assert.equal(r.text, "On your task graph as p2 — p3 left your checklist, dropped. p4 left your checklist, but docs needs it: it stays. p5 left your checklist; it is a sub-agent's task, and stays. 1 of 5 done · running: p2 · ready: p4, p5.");
  assert.deepEqual([task(r.graph, "p3").state, task(r.graph, "p3").why, task(r.graph, "p3").endedAt], ["dropped", "it left your checklist", T1 + 7]);
  assert.deepEqual([task(r.graph, "p1").state, task(r.graph, "p4").state, task(r.graph, "p5").state], ["done", "waiting", "waiting"]);
  // A task that needs one that left, and left with it, goes with it.
  let h = plan(null, [I("A"), I("B")]).graph;
  h = tasks(h, { action: "change", tasks: [{ id: "p2", needs: ["p1"] }] });
  assert.equal(states(plan(h, [I("C")]).graph), "p1:dropped p2:dropped p3:waiting");
  // A dropped item named again is a new task: the dropped one stays dropped.
  const back = plan(r.graph, [I("Fix the trailing comma", "doing"), I("Run the tests")]);
  assert.deepEqual([task(back.graph, "p3").state, task(back.graph, "p6").name], ["dropped", "Run the tests"]);
});

// ---- case 6: someone else's ------------------------------------------------------------------------------------------

// (fails before: yes)
test("someone else's: a task tasks change gave a sub-agent or command keeps its state whatever its item says, said where they disagree", () => {
  let g = plan(null, [I("Read the parser", "done"), I("Write more tests"), I("Run the mutants")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p2", ...WORKER }, { id: "p3", by: "command", run: ["node mutate.js"] }] });
  const r = plan(g, [I("Read the parser", "done"), I("Write more tests", "done"), I("Run the mutants", "doing")]);
  assert.equal(r.changed, false);
  assert.equal(r.text, "On your task graph as p1 to p3. p2 is a sub-agent's task: its state follows its worker, not your checklist. p3 is a command task: Filament's runs end it, not your checklist. 1 of 3 done · ready: p2, p3.");
  // Where they agree, nothing is said.
  assert.equal(plan(g, [I("Read the parser", "done"), I("Write more tests"), I("Run the mutants")]).text, "On your task graph as p1 to p3. 1 of 3 done · ready: p2, p3.");
  // Running on its worker, doing agrees.
  const running = /** @type {any} */ (tg.launched(g, "p2", "sa-1", T1, "sub-agent"));
  assert.doesNotMatch(plan(running, [I("Read the parser", "done"), I("Write more tests", "doing"), I("Run the mutants")]).text, /p2 is/);
});

// ---- case 7: tasks change by an item's id ----------------------------------------------------------------------------

// (fails before: yes — TG2-D78: a name changed by tasks change keeps its item)
test("tasks change by an item's id takes needs, check and who does it; a new name keeps its item, so the checklist still moves it", () => {
  let g = plan(null, [I("Fix the trailing comma"), I("Run the tests")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p1", name: "Fix parse() for a trailing comma", check: ["npm test"] }, { id: "p2", needs: ["p1"] }] });
  assert.deepEqual([task(g, "p1").name, task(g, "p1").checklist, task(g, "p1").check, task(g, "p2").needs], ["Fix parse() for a trailing comma", "Fix the trailing comma", ["npm test"], ["p1"]]);
  const r = plan(g, [I("Fix the trailing comma", "doing"), I("Run the tests")]);
  assert.equal(r.graph.tasks.length, 2, "no new task for the old name");
  assert.equal(r.text, "On your task graph as p1, p2 — p1 started. 0 of 2 done · running: p1.");
  // The new name is not the item: named in the checklist, it is a new task.
  assert.deepEqual(plan(g, [I("Fix parse() for a trailing comma"), I("Fix the trailing comma"), I("Run the tests")]).graph.tasks.map((/** @type {any} */ t) => t.id), ["p1", "p2", "p3"]);
});

// (fails before: yes — the nudge map of 11-10: a red check opened p1 again and said "mark it done again (tasks done)",
// while the whole list, sent again for another item, still said done — which sent p1 to its check again, nothing fixed,
// its summary overwritten)
test("a red check opens a ticked task again, and the list sent again still saying done ticks nothing: its item goes to doing while the cause is fixed, then done runs the check again", () => {
  /** @type {import("../src/core/task-graph.js").CheckOutcome} */
  const RED = { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 1, ms: 4000, output: "not ok 1", stopped: false }], bounces: 0, stopped: false };
  let g = plan(null, [I("Fix the parser", "doing"), I("Run the tests")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p1", check: ["npm test"] }] });
  g = plan(g, [I("Fix the parser", "done"), I("Run the tests")]).graph;
  assert.equal(task(g, "p1").state, "checking");
  g = /** @type {any} */ (tg.checked(g, "p1", RED, T1 + 1)).graph;
  assert.equal(task(g, "p1").state, "running");
  // Its verdict says how a checklist's task is ticked again.
  assert.match(tg.endText(g, "p1", { crew: "agent" }), /Fix the cause — never the check — set its item on your checklist to doing while you do, then to done again\./);
  // The list sent again for p2, p1 still done: p1 stays open, said so.
  const again = plan(g, [I("Fix the parser", "done"), I("Run the tests", "doing")]);
  assert.equal(task(again.graph, "p1").state, "running");
  assert.equal(task(again.graph, "p1").verdict.kind, "failed", "its red verdict kept");
  assert.match(again.text, /p1 did not pass its check, so it is open again: its item still says done, which ticks nothing now — set it to doing while you fix the cause, then to done again\./);
  // Doing, then done: checked again.
  const doing = plan(again.graph, [I("Fix the parser", "doing"), I("Run the tests", "doing")]);
  assert.equal(task(doing.graph, "p1").state, "running");
  assert.doesNotMatch(doing.text, /did not pass its check/);
  const done = plan(doing.graph, [I("Fix the parser", "done"), I("Run the tests", "doing")]);
  assert.equal(task(done.graph, "p1").state, "checking");
  // A task the tasks tool made says tasks done, as before.
  let own = tasks(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", check: ["npm test"] }] });
  own = tasks(tasks(own, { action: "start", ids: ["t1"] }), { action: "done", id: "t1", summary: "fixed" });
  own = /** @type {any} */ (tg.checked(own, "t1", RED, T1 + 1)).graph;
  assert.match(tg.endText(own, "t1", { crew: "agent" }), /Fix the cause — never the check — then mark it done again \(tasks done\)\./);
});

// ---- case 8: a new checklist closes a finished graph -----------------------------------------------------------------

// (fails before: yes)
test("a list naming none of a finished graph's tasks closes it — every task done — and starts a new one, numbered on; a closed graph's next list starts one too", () => {
  let g = plan(null, [I("Fix the parser", "doing"), I("Run the tests")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p1", check: ["npm test"] }] });
  g = tasks(g, { action: "done", id: "p1", summary: "Fixed" });
  g = /** @type {any} */ (tg.checked(g, "p1", { ran: true, commands: ["npm test"], runs: [{ command: "npm test", exit: 0, ms: 4000, output: "ok", stopped: false }], bounces: 0, stopped: false }, T1 + 1)).graph;
  g = tasks(g, { action: "drop", ids: ["p2"], reason: "not needed" });
  const r = plan(g, [I("Write the docs", "doing"), I("Release")], T1 + 9);
  assert.deepEqual([r.closed.closed, r.closed.tasks.map((/** @type {any} */ t) => t.state)], [{ at: T1 + 9, reason: "every task done" }, ["done", "dropped"]]);
  assert.deepEqual([r.graph.closed, r.graph.startedAt, r.graph.rev, r.graph.tasks.map((/** @type {any} */ t) => `${t.id}:${t.state}`)], [null, T1 + 9, g.rev, ["p3:running", "p4:waiting"]]);
  assert.equal(r.text, `Every task of your last task graph is done, and your checklist names none of them: Filament closed it (every task done). Filament runs their checks once more on your folder as it stands — \`npm test\` — and you hear what comes. Your checklist starts a new one: p3, p4. ${NUDGE} 0 of 2 done · running: p3 · ready: p4.`);
  // A list that names one of them goes on with the graph.
  assert.equal(plan(g, [I("Fix the parser", "done"), I("Release")]).graph.tasks.length, 3);
  // A graph with a task still being checked is not finished.
  const checking = tasks(plan(null, [I("Fix the parser", "doing")]).graph, { action: "change", tasks: [{ id: "p1", check: ["npm test"] }] });
  assert.equal(plan(tasks(checking, { action: "done", id: "p1", summary: "Fixed" }), [I("Release")]).closed, null);
  // Closed by tasks close, the next list starts a new graph, numbered on.
  const shut = tasks(g, { action: "close", reason: "shipped" });
  const next = plan(shut, [I("Write the docs")]);
  assert.deepEqual([next.closed, next.graph.closed, next.graph.tasks.map((/** @type {any} */ t) => t.id)], [null, null, ["p3"]]);
  assert.equal(next.text, `Your checklist starts a new task graph: p3. ${NUDGE} 0 of 1 done · ready: p3.`);
});

// ---- case 9: the graph full ------------------------------------------------------------------------------------------

// (fails before: yes)
test("a checklist past the graph's size: the graph takes none of it, and the answer says why", () => {
  const many = Array.from({ length: tg.MAX_TASKS + 1 }, (_, n) => I(`Item ${n + 1}`));
  const r = plan(null, many);
  assert.deepEqual([r.graph, r.changed], [null, false]);
  assert.equal(r.text, `Your task graph took none of it: a graph holds at most ${tg.MAX_TASKS} tasks, and this checklist would make it ${tg.MAX_TASKS + 1}.`);
  const full = plan(null, many.slice(0, tg.MAX_TASKS)).graph;
  const more = plan(full, [...many.slice(0, tg.MAX_TASKS - 1).map((x) => ({ ...x, status: "done" })), I("One more")]);
  assert.equal(more.graph, full, "nothing of it is taken: no item is moved either");
  assert.equal(more.changed, false);
});

// ---- case 10: a long item --------------------------------------------------------------------------------------------

// (fails before: yes)
test("an item over 120 characters is cut, and matched as cut", () => {
  const long = `Fix ${"the parser ".repeat(15)}`.trim();
  const g = plan(null, [I(long)]).graph;
  assert.equal(task(g, "p1").name.length, 120);
  assert.ok(task(g, "p1").name.endsWith("…"));
  const again = plan(g, [I(long, "doing")]);
  assert.deepEqual([again.graph.tasks.length, task(again.graph, "p1").state], [1, "running"]);
});

// ---- case 11: an empty list ------------------------------------------------------------------------------------------

// (fails before: yes)
test("an empty list drops the agent's open checklist tasks; done ones stay", () => {
  const g = plan(null, THREE).graph;
  const r = plan(g, []);
  assert.equal(r.text, "On your task graph — p2, p3 left your checklist, dropped. Its one task is done. Before you close, weigh what was done against what the person asked: what was asked that no item did goes on your checklist as items (send the whole list with them); if nothing is left, close the graph with its outcome (tasks close).");
  assert.equal(states(r.graph), "p1:done p2:dropped p3:dropped");
});

// ---- case 12: the runner ---------------------------------------------------------------------------------------------

/**
 * A session kept in memory, a registry that launches nothing that ends, and the folder's checks answered when the test
 * says (checked-done's rig).
 */
function rig(/** @type {Record<string, any>} */ extra = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const told = [];
  /** @type {any[]} */
  const launches = [];
  /** @type {any[]} */
  const published = [];
  /** @type {{ commands: string[], o: any, done: (v: any) => void }[]} */
  const folderChecks = [];
  const state = { t: 2000, n: 0 };
  const registry = {
    /** @param {any} spec */
    launch: (spec) => (launches.push(spec), { ok: true, id: `sa-${++state.n}`, done: new Promise(() => {}) }),
    slots: () => 4,
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => told.push({ chainId, ...d }),
    stop: () => ({ ok: true }),
    resumable: () => null,
    /** @param {string} chainId @param {string[]} commands @param {any} o */
    checkFolder: (chainId, commands, o) => new Promise((done) => folderChecks.push({ commands, o, done })),
    checkProblem: () => null,
    runProblem: () => null,
    guard: () => {},
  };
  const archive = {
    /** The meta's named keys, as the archive's `metaOf` reads them. @param {string} id @param {readonly string[]} keys */
    metaOf: (id, keys) => {
      const c = chains.get(id);
      return c ? Object.fromEntries(keys.filter((k) => c.meta?.[k] !== undefined).map((k) => [k, c.meta[k]])) : null;
    },
    /** @param {string} id @param {Record<string, any>} patch */
    mergeMeta: (id, patch) => {
      const c = chains.get(id);
      if (!c) return null;
      c.meta = structuredClone({ ...c.meta, ...patch });
      return c.meta;
    },
    openGraphs: () => [...chains.values()].filter((c) => c.meta.graph && !c.meta.graph.closed).map((c) => ({ id: c.id, graph: structuredClone(c.meta.graph) })),
  };
  const runner = createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (topic, e) => published.push({ topic, e }) }, crew: () => "agent", log: () => {}, now: () => state.t++, ...extra });
  return { runner, told, launches, published, folderChecks, graph: () => chains.get("c1").meta.graph };
}
const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };
/** How a check went, as the registry hands it: one command's end. @param {string} command @param {number} exit */
const RAN = (command, exit) => ({ ran: true, commands: [command], runs: [{ command, exit, ms: 4000, output: exit === 0 ? "ok" : "FAIL", stopped: false }], bounces: 0, stopped: false });
const tick = () => new Promise((r) => setImmediate(r));

// (fails before: yes — the runner had no plan)
test("the runner: a plan call keeps the graph and draws it, starts a sub-agent's task its done item made ready, and runs a done item's check", async () => {
  const r = rig();
  r.runner.attach("c1", TURN);
  const first = r.runner.plan("c1", [I("Fix the parser", "doing"), I("Write more tests")]);
  assert.deepEqual([first.changed, first.view.tasks.map((/** @type {any} */ t) => t.id)], [true, ["p1", "p2"]]);
  assert.equal(r.graph().tasks.length, 2);
  assert.equal(r.published.filter((p) => p.topic === "graph").length, 1, "the page hears it");
  ok(r.runner.apply("c1", { action: "change", tasks: [{ id: "p2", needs: ["p1"], ...WORKER }, { id: "p1", check: ["npm test"] }] }, { crew: "agent" }));
  const done = r.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests")]);
  assert.match(done.text, /Checking p1: Filament runs its check/);
  assert.deepEqual([r.folderChecks.length, r.folderChecks[0].commands, r.folderChecks[0].o.id], [1, ["npm test"], "check-p1"]);
  assert.equal(r.launches.length, 0, "p1 is being checked: the sub-agent's task waits for its verdict");
  r.folderChecks[0].done(RAN("npm test", 0));
  await tick();
  assert.equal(task(r.graph(), "p1").state, "done");
  assert.deepEqual(r.launches.map((l) => l.task.id), ["p2"]);
  // Unchanged, a plan call keeps nothing and draws nothing.
  const before = r.published.length;
  const same = r.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests")]);
  assert.deepEqual([same.changed, same.view, r.published.length], [false, null, before]);
});

// (fails before: yes — 11-10: an item's status alone kept nothing, so a red task's doing was lost and its done never
// ticked it again)
// (fails before: yes — the review of 67038d835, its finding 7: that keep went the way every keep goes — the graph's rev
// one on, the pages sent it, the watchers told — and the test let one drawing through)
test("the runner: a red check's task is ticked again only through doing — an item's status alone, no task moved, is kept with the session and drawn nowhere", async () => {
  /** @type {string[]} */
  const heard = [];
  const r = rig({ onGraphKept: (/** @type {string} */ chainId) => heard.push(chainId) });
  r.runner.attach("c1", TURN);
  r.runner.plan("c1", [I("Fix the parser", "doing"), I("Write more tests")]);
  ok(r.runner.apply("c1", { action: "change", tasks: [{ id: "p1", check: ["npm test"] }] }, { crew: "agent" }));
  r.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests")]);
  r.folderChecks[0].done(RAN("npm test", 1));
  await tick();
  assert.equal(task(r.graph(), "p1").state, "running");
  const again = r.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests", "doing")]);
  assert.match(again.text, /p1 did not pass its check/);
  assert.equal(r.folderChecks.length, 1, "no check on nothing fixed");
  const [drawn, told, rev] = [r.published.length, heard.length, r.graph().rev];
  const doing = r.runner.plan("c1", [I("Fix the parser", "doing"), I("Write more tests", "doing")]);
  assert.deepEqual([doing.changed, doing.view, task(r.graph(), "p1").item], [false, null, "doing"], "kept, no task moved");
  assert.deepEqual([r.published.length - drawn, heard.length - told, r.graph().rev - rev], [0, 0, 0], "no page sent it, no watcher told, its rev as it was");
  r.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests", "doing")]);
  assert.equal(r.folderChecks.length, 2, "checked again");
});

// (fails before: yes — the owner's of 11-10: a done said the graph alone; a sub-agent's change that waits, a command
// that runs and a letter owed went unsaid until a compaction, which a large window may never bring.)
test("a done and a tick say what else is open beside the graph — the graph's own sub-agents left out, at most three, a dismissed one and the folder's not; a start and a doing say none", () => {
  const NOW = 10_000_000;
  const rows = openList({
    shells: /** @type {any} */ ([{ id: "bc_1", command: "npm test", cwd: "/p", agent: null, startedAt: NOW - 120_000 }]),
    agent: null,
    agents: [
      { id: "sa_9", description: "Map the parser", running: false, files: 3 },
      { id: "sa_t", description: "p2's worker", running: true, files: 0 },
      { id: "sa_d", description: "Old try", running: false, files: 0, failed: "it stopped" },
    ],
    letters: [{ id: "lt_1", subject: "Second opinion", from: "the chat \"Fable\" (aco2a1bn)", at: NOW - 60_000 }],
    changes: [/** @type {const} */ ({ kind: "graph", id: "sa_g", task: "p3", files: 2, mark: "m" })],
    copies: [{ repo: "/p", count: 2, bytes: null }],
    now: NOW,
  }).rows.map((r) => (r.key === "agent:sa_d:failed" ? { ...r, dismissed: /** @type {const} */ (true) } : r));
  const said = alsoOpenWords(rows, { skip: new Set(["sa_t"]) });
  // (fails before: yes — FabeleHelper's of 11-10: in the list's order, a command that runs first) What waits on the
  // agent first, what goes on by itself last.
  assert.equal(said, 'Also still open, beside your graph: sub-agent sa_9 ("Map the parser"): 3 files of its work wait to be applied; letter lt_1, "Second opinion", from the chat "Fable" (aco2a1bn), 1 min ago: it waits for your reply; background command bc_1: `npm test` in /p, running for 2 min.');
  assert.doesNotMatch(said, /sa_t|sa_g|sa_d|copies/, "the graph's own, a dismissed one and the folder's are not said");
  const many = alsoOpenWords([...rows, ...rows.map((r) => ({ ...r, key: `${r.key}-2` }))], { skip: new Set(["sa_t"]) });
  // (fails before: yes — the nudge map of 11-10, c-mirror: four named, and the rest counted with nowhere to read them)
  assert.match(many, /; and 3 more, which Still open names at your next turn's start\.$/);
  assert.equal(alsoOpenWords(rows.filter((r) => r.view.group === "left")), "");
  // The runner: after a done and a tick, not after a start or a doing; the graph's own sub-agents skipped.
  /** @type {string[][]} */
  const asked = [];
  const r = rig({ alsoOpen: (/** @type {string} */ _c, /** @type {Set<string>} */ skip) => (asked.push([...skip]), "Also still open, beside your graph: sub-agent sa_9.") });
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "One" }, { id: "t2", name: "Two" }] }, { crew: "agent" }));
  assert.doesNotMatch(ok(r.runner.apply("c1", { action: "start", ids: ["t1"] }, { crew: "agent" })).text, /Also still open/);
  assert.match(ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "One done." }, { crew: "agent" })).text, /\nAlso still open, beside your graph: sub-agent sa_9\.$/);
  assert.equal(asked.length, 1);
  const s = rig({ alsoOpen: () => "Also still open, beside your graph: letter lt_1." });
  s.runner.attach("c1", TURN);
  assert.doesNotMatch(s.runner.plan("c1", [I("Fix the parser", "doing"), I("Write more tests")]).text, /Also still open/);
  assert.match(s.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests")]).text, /\nAlso still open, beside your graph: letter lt_1\.$/);
  // None given (a Filament that keeps no list): nothing said.
  const n = rig();
  n.runner.plan("c1", [I("Fix the parser", "doing")]);
  assert.doesNotMatch(n.runner.plan("c1", [I("Fix the parser", "done")]).text, /Also still open/);
  // (fails before: yes — the hunt of a-next, sa_16f6bbd4: an item sent done as it was added ended no task, and a lead's
  // done heard the main agent's list as its own)
  const b = rig({ alsoOpen: () => "Also still open, beside your graph: letter lt_1." });
  b.runner.attach("c1", TURN);
  assert.doesNotMatch(b.runner.plan("c1", [I("Read the parser", "done"), I("Fix it", "doing")]).text, /Also still open/, "made done as it was added");
  const l = rig({ alsoOpen: () => "Also still open, beside your graph: letter lt_1." });
  l.runner.attach("c1", TURN);
  ok(l.runner.apply("c1", { action: "add", goal: "G", tasks: [{ id: "t1", name: "One" }] }, { crew: "agent" }));
  ok(l.runner.apply("c1", { action: "start", ids: ["t1"] }, { crew: "agent" }));
  assert.doesNotMatch(ok(l.runner.apply("c1", { action: "done", id: "t1", summary: "One done." }, { crew: MEMBERS })).text, /Also still open/, "a lead's call");
});

// (fails before: yes — FabeleHelper's of 11-10: each done of a turn said the whole list again)
test("also open, within a turn: a later done says only what came since, counting the rest, and nothing where nothing came; the next turn says it whole", () => {
  const NOW = 10_000_000;
  /** @param {any[]} letters */
  const list = (letters) =>
    openList({
      shells: /** @type {any} */ ([{ id: "bc_1", command: "npm test", cwd: "/p", agent: null, startedAt: NOW - 120_000 }]),
      agent: null,
      agents: [{ id: "sa_9", description: "Map the parser", running: false, files: 3 }],
      letters,
      now: NOW,
    }).rows;
  let rows = list([]);
  /** @type {Set<string>[]} */
  const sets = [];
  // As still-open.js's `also` does: the words, then what they weighed marked said.
  const r = rig({
    alsoOpen: (/** @type {string} */ _c, /** @type {Set<string>} */ skip, /** @type {Set<string>} */ said) => {
      sets.push(said);
      const text = alsoOpenWords(rows, { skip, said });
      for (const x of alsoRows(rows, skip)) said.add(x.key);
      return text;
    },
  });
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: ["t1", "t2", "t3", "t4"].map((id) => ({ id, name: id.toUpperCase() })) }, { crew: "agent" }));
  /** @param {string} id */
  const finish = (id) => {
    ok(r.runner.apply("c1", { action: "start", ids: [id] }, { crew: "agent" }));
    return ok(r.runner.apply("c1", { action: "done", id, summary: `${id} done.` }, { crew: "agent" })).text;
  };
  const WHOLE = 'Also still open, beside your graph: sub-agent sa_9 ("Map the parser"): 3 files of its work wait to be applied; background command bc_1: `npm test` in /p, running for 2 min.';
  assert.ok(finish("t1").endsWith(`\n${WHOLE}`));
  assert.doesNotMatch(finish("t2"), /Also still open/, "nothing came since: nothing said");
  rows = list([{ id: "lt_1", subject: "Second opinion", from: "the chat \"Fable\" (aco2a1bn)", at: NOW - 60_000 }]);
  assert.ok(finish("t3").endsWith('\nAlso still open, beside your graph: letter lt_1, "Second opinion", from the chat "Fable" (aco2a1bn), 1 min ago: it waits for your reply (new); 2 as said before.'));
  assert.equal(new Set(sets).size, 1, "one turn, one set");
  rows = list([]);
  r.runner.begin("c1", "agent");
  assert.ok(finish("t4").endsWith(`\n${WHOLE}`), "a new turn whose start said none of it: said whole");
});

// (fails before: yes — the re-read of 11-11: the runner's set of what a turn's answers said began empty though the
// turn's start had said the list whole, so its first done named three again, counted the rest and owed the next start
// the whole list: with more than three things open beside the graph, every turn's start said it)
test("also open, in a turn whose start said the list: its dones say none of it again, and the next turn's start owes no list", () => {
  const NOW = 10_000_000;
  const six = ["a", "b", "c", "d", "e", "f"].map((x, i) => ({ kind: /** @type {const} */ ("try"), task: `x${i + 1}`, description: `try ${x}`, id: `sa_${x}`, files: 1, mark: "m", since: NOW - 60_000 }));
  /** @type {Record<string, any>} */
  let meta = {};
  const kept = {
    metaOf: (/** @type {string} */ _id, /** @type {readonly string[]} */ keys) => Object.fromEntries(keys.filter((k) => k in meta).map((k) => [k, structuredClone(meta[k])])),
    mergeMeta: (/** @type {string} */ _id, /** @type {Record<string, any>} */ patch) => {
      meta = Object.fromEntries(Object.entries({ ...meta, ...structuredClone(patch) }).filter(([, v]) => v !== undefined));
    },
    getCompactions: () => [],
  };
  const so = createStillOpen({ archive: () => kept, changes: () => six, now: () => NOW });
  // As server.js wires the runner to the list.
  const r = rig({ alsoOpen: (/** @type {string} */ c, /** @type {Set<string>} */ skip, /** @type {Set<string>} */ said) => so.also(c, skip, said) });
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "add", goal: "G", tasks: ["t1", "t2", "t3"].map((id) => ({ id, name: id.toUpperCase() })) }, { crew: "agent" }));
  /** @param {string} id */
  const finish = (id) => {
    ok(r.runner.apply("c1", { action: "start", ids: [id] }, { crew: "agent" }));
    return ok(r.runner.apply("c1", { action: "done", id, summary: `${id} done.` }, { crew: "agent" })).text;
  };
  // A turn whose start said nothing: its done names three and counts three, which the next start owes.
  so.begin("c1");
  assert.match(finish("t1"), /\nAlso still open, beside your graph: sub-agent sa_a .*; and 3 more, which Still open names at your next turn's start\.$/);
  so.ended("c1", false);
  so.over("c1");
  // The next turn: its start says the list whole, as its first prompt carries it.
  r.runner.begin("c1", "agent");
  const start = so.due("c1");
  assert.equal(start?.why, "more");
  so.begin("c1");
  so.startSaid("c1", start?.keys || []);
  assert.doesNotMatch(finish("t2"), /Also still open/, "the start said each");
  so.ended("c1", true);
  so.over("c1");
  assert.equal(so.due("c1"), null, "nothing counted: nothing owed");
});

// (fails before: yes — the owner's of 11-10: the runner knew nothing of what the person asked since a graph began, and a
// turn's start said nothing of a graph left open with all done)
test("all done, by the runner: the tick that ends the last weighs it against the goal and what the person asked since; the next turn's start once more, then nothing", () => {
  /** @type {number | null} */
  let personAt = null;
  const r = rig({ personAt: () => personAt });
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "add", goal: "Fix the parser", tasks: [{ id: "t1", name: "Fix it" }] }, { crew: "agent" }));
  personAt = 10_000_000;
  const done = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed." }, { crew: "agent" })).text;
  assert.match(done, /^Done: t1\. Its one task is done\. Before you close, weigh what was done against the goal "Fix the parser" and what the person asked since the graph began: /, done);
  assert.match(String(r.runner.begin("c1", "agent")), /"Fix the parser": its one task is done, and it is still open\. Weigh what was done against its goal and what the person asked since it began: /);
  assert.equal(r.runner.begin("c1", "agent"), null, "once more, then nothing");
  // (fails before: yes — FabeleHelper's of 11-10) After a compaction it comes back though it was heard: the fold's and a
  // switch's graph block (`open`), and a coding agent's where-you-are (`where` back).
  assert.match(String(r.runner.where("c1", "agent", { back: true })), /"Fix the parser": its one task is done, and it is still open\. /);
  assert.equal(r.runner.open("c1", "agent"), r.runner.where("c1", "agent", { back: true }));
  assert.equal(r.runner.where("c1", "agent"), null, "a turn's start: said");
  // A checklist's graph has no goal: weighed against what the person asked, and what is left goes on its checklist — its
  // steps go there, never on a graph (FabeleHelper's of 11-10) —, at the tick and at the next turn's start.
  const s = rig();
  s.runner.attach("c1", TURN);
  s.runner.plan("c1", [I("Fix the parser", "doing")]);
  assert.match(s.runner.plan("c1", [I("Fix the parser", "done")]).text, / p1 done\. Its one task is done\. Before you close, weigh what was done against what the person asked: what was asked that no item did goes on your checklist as items \(send the whole list with them\); /);
  assert.match(String(s.runner.begin("c1", "agent")), /its one task is done, and it is still open\. Weigh what was done against what the person asked: what was asked that no item did goes on your checklist as items \(send the whole list with them\); if nothing is left, close it/);
});

// (fails before: yes)
test("the runner: a held graph stays held — a plan call starts no sub-agent's task — and a checklist that closes a graph runs its checks, told though a new graph is the session's", async () => {
  const r = rig();
  r.runner.attach("c1", TURN);
  r.runner.plan("c1", [I("Fix the parser", "doing"), I("Write more tests")]);
  ok(r.runner.apply("c1", { action: "change", tasks: [{ id: "p2", needs: ["p1"], ...WORKER }] }, { crew: "agent" }));
  r.runner.stop("c1");
  assert.ok(r.graph().held);
  r.runner.plan("c1", [I("Fix the parser", "done"), I("Write more tests")]);
  assert.deepEqual([r.launches.length, !!r.graph().held, task(r.graph(), "p1").state], [0, true, "done"]);
  // Its next tasks call lets go of the hold.
  ok(r.runner.apply("c1", { action: "show" }, { crew: "agent" }));
  assert.deepEqual([r.launches.map((l) => l.task.id), r.graph().held], [["p2"], null]);
  // A graph of done tasks, one with a check, closed by a new checklist.
  const s = rig();
  s.runner.attach("c1", TURN);
  s.runner.plan("c1", [I("Fix the parser", "doing")]);
  ok(s.runner.apply("c1", { action: "change", tasks: [{ id: "p1", check: ["npm test"] }] }, { crew: "agent" }));
  s.runner.plan("c1", [I("Fix the parser", "done")]);
  s.folderChecks[0].done(RAN("npm test", 0));
  await tick();
  const next = s.runner.plan("c1", [I("Write the docs", "doing")]);
  assert.match(next.text, /^Every task of your last task graph is done/);
  assert.deepEqual([s.graph().closed, s.graph().tasks.map((/** @type {any} */ t) => t.id)], [null, ["p2"]]);
  const close = s.folderChecks.at(-1);
  assert.deepEqual([close?.commands, close?.o.id, close?.o.all], [["npm test"], "check-close", true]);
  close?.done(RAN("npm test", 1));
  await tick();
  assert.match(s.told.at(-1).text, /^\[Filament: after the graph's close, Filament ran its checks on your folder as it stands: `npm test` \(p1\) failed/);
  assert.equal(s.graph().closed, null, "the new graph keeps nothing of the old one's run");
});

// ---- case 13: the loop -----------------------------------------------------------------------------------------------

describe("the plan call in the session's loop", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let parent;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    parent = mkdtempSync(join(tmpdir(), "filament-checklist-graph-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [parent], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, parent);
  });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  /** A session in the folder: the agent's on Filament's loop, or — `engine.mode` team — a team's lead's. @param {any} engine */
  const create = async (engine) => {
    const model = engine.mode === "team" ? "brain-model" : "agent/brain-model";
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: parent, model, preset: "plain", settings: { engine, subagents: { pool: [{ model: "", seats: 1 }] } } } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** One turn whose first reply calls plan; what its call answered, and the run's events. @param {string} id */
  const planTurn = async (id) => {
    /** @type {string | null} */
    let answer = null;
    brain = (call) => {
      if (!(call.body.tools || []).some((/** @type {any} */ t) => t.name === "plan")) return undefined;
      const res = (call.body.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : [])).find((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === "pl");
      if (!res) return reply([{ type: "tool_use", id: "pl", name: "plan", input: { items: [I("Read the parser", "done"), I("Fix the trailing comma", "doing")] } }], "tool_use");
      answer = typeof res.content === "string" ? res.content : res.content.map((/** @type {any} */ b) => b.text || "").join("");
      return reply([{ type: "text", text: "Planned." }]);
    };
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fix the parser", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const runId = String(r.headers.get("x-filament-request-id"));
    await r.json();
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=2000`)).json()).events || [];
    return { answer: /** @type {any} */ (answer), events, graph: structuredClone(/** @type {any} */ (shim.app).memory.archive.getChain(id)?.meta?.graph ?? null) };
  };

  // (fails before: yes — the plan call's answer was its line alone, and the graph stayed empty)
  test("the agent's plan call answers with the graph's words, and the page hears the graph", async () => {
    const id = await create({ supervise: false });
    const r = await planTurn(id);
    assert.equal(r.answer, `Plan recorded: 2 items (1 done). Your checklist starts your task graph: p1, p2. ${NUDGE} 1 of 2 done · running: p2.`);
    assert.deepEqual(r.graph.tasks.map((/** @type {any} */ t) => `${t.id}:${t.state}`), ["p1:done", "p2:running"]);
    const kinds = r.events.map((/** @type {any} */ e) => e.type);
    assert.ok(kinds.includes("plan") && kinds.includes("graph"), kinds.join(","));
  });

  // (fails before: no — the guard)
  test("for a team's lead, the plan call is as it was, byte for byte", async () => {
    const led = await planTurn(await create({ mode: "team", team: "builders", supervise: false }));
    assert.deepEqual([led.answer, led.graph], ["Plan recorded: 2 items (1 done).", null]);
  });

  // (fails before: yes — the plan tool took no `task`: the list went to t2, started last, and a wrong one was recorded as
  // t2's steps too)
  test("the agent's plan call that names its task: the named task's steps, where the one started last would take them; a wrong one is the call's error, and draws nothing", async () => {
    const id = await create({ supervise: false });
    const STEPS = [I("Read the parser", "done"), I("Fix the trailing comma", "doing")];
    /** The calls in order, each once its last one's answer is in. @type {[string, string, any][]} */
    const calls = [
      ["a", "tasks", { action: "add", goal: "The parser", tasks: [{ id: "t1", name: "Parser" }, { id: "t2", name: "Printer" }] }],
      ["s1", "tasks", { action: "start", ids: ["t1"] }],
      ["s2", "tasks", { action: "start", ids: ["t2"] }],
      ["named", "plan", { items: STEPS, task: "t1" }],
      ["wrong", "plan", { items: [I("Something else", "doing")], task: "t9" }],
    ];
    /** @type {Map<string, string>} */
    const answers = new Map();
    brain = (call) => {
      if (!(call.body.tools || []).some((/** @type {any} */ t) => t.name === "plan")) return undefined;
      for (const b of (call.body.messages || []).flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []))) if (b?.type === "tool_result") answers.set(String(b.tool_use_id), typeof b.content === "string" ? b.content : b.content.map((/** @type {any} */ x) => x.text || "").join(""));
      const next = calls.find(([use]) => !answers.has(use));
      return next ? reply([{ type: "tool_use", id: next[0], name: next[1], input: next[2] }], "tool_use") : reply([{ type: "text", text: "Planned." }]);
    };
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "fix the parser", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const runId = String(r.headers.get("x-filament-request-id"));
    await r.json();
    assert.match(String(answers.get("named")), /^Plan recorded: 2 items \(1 done\)\. Your checklist is t1's steps: 1 of 2 done, said on its box\./);
    assert.equal(answers.get("wrong"), "Error: Not recorded: task names one of your own tasks at work on your task graph, and t9 is none: t1 and t2 are. Name one of them, or leave task out.");
    const graph = /** @type {any} */ (shim.app).memory.archive.getChain(id)?.meta?.graph;
    assert.deepEqual(graph.tasks.map((/** @type {any} */ t) => [t.id, t.state, t.list ?? null]), [["t1", "running", STEPS], ["t2", "running", null]]);
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=2000`)).json()).events || [];
    assert.deepEqual(events.filter((/** @type {any} */ e) => e.type === "plan").map((/** @type {any} */ e) => e.items), [STEPS], "the refused list was drawn nowhere");
  });
});

// ---- case 14: the page -----------------------------------------------------------------------------------------------

// (fails before: yes)
test("the Plan view: a checklist task's card says so where it says who does it, a blocked one says blocked on its line, and a graph with no goal is the agent's checklist", () => {
  const g = plan(null, [I("Read the parser", "done"), I("Fix the trailing comma", "blocked")]).graph;
  const el = drawGraph(tg.graphView(g), { h: fakeH, now: T1 + 5000, chosen: "p2" }).el;
  const drawn = textOf(el);
  // (E41 P4: who does it is the card's line under its name, with when — no Who row)
  assert.match(drawn, /\|the agent — an item of its checklist · added just now/);
  // A task is one line (the redesign of 11-05): blocked is its fact, its whole line in its tooltip.
  /** @param {any} n @returns {any} */
  const p2Of = (n) => (n?.attrs?.["data-id"] === "p2" ? n : (n?.kids || []).map(p2Of).find(Boolean));
  assert.equal(textOf(p2Of(el)), "p2|Fix the trailing comma|blocked");
  assert.equal(p2Of(el).attrs.title, "p2 Fix the trailing comma\nready · blocked · ready to start");
  assert.match(drawn, /The agent's checklist/);
  const p1 = textOf(drawGraph(tg.graphView(g), { h: fakeH, now: T1 + 5000, chosen: "p1" }).el);
  assert.match(p1, /ticked on the checklist/);
  // A task the agent added itself says what it always did.
  const own = textOf(drawGraph(tg.graphView(tasks(null, { action: "add", goal: "Ship", tasks: [{ id: "t1", name: "Fix" }] })), { h: fakeH, now: T1, chosen: "t1" }).el);
  assert.match(own, /\|the agent · added just now/);
  assert.doesNotMatch(own, /checklist/);
});

// ---- case 15: show and the reattached graph --------------------------------------------------------------------------

// (fails before: yes)
test("show, and the graph a summary brings back, say which tasks are from the checklist and which are blocked", () => {
  const g = plan(null, [I("Read the parser", "done"), I("Fix the trailing comma", "blocked")]).graph;
  const shown = tg.showText(g, "agent");
  assert.match(shown, /^The task graph — your checklist$/m);
  assert.match(shown, /^- p1 "Read the parser" — done: ticked on the checklist · from your checklist$/m);
  assert.match(shown, /^- p2 "Fix the trailing comma" — ready, blocked · from your checklist$/m);
  assert.equal(tg.openGraphText(g, "agent"), shown);
  assert.match(ok(tg.applyTasks(g, { action: "show", id: "p2" }, AT)).text, /^p2 "Fix the trailing comma" — ready, blocked · from your checklist$/m);
  // A sub-agent's brief names no goal the graph does not have.
  const given = tasks(g, { action: "change", tasks: [{ id: "p2", ...WORKER }] });
  assert.doesNotMatch(tg.briefText(given, "p2", "agent"), /The work:/);
  assert.match(tg.briefText(tasks(given, { action: "change", goal: "Ship the parser" }), "p2", "agent"), /^The work: Ship the parser$/m);
});

// ---- case 16: the prompt ---------------------------------------------------------------------------------------------

// (fails before: yes — the owner's of 11-10: "sometimes in Plan view multiple tasks are spinning, what does that mean?
// does that mean those are being done in parallel?" A spinner is a status the agent sets, and its words let it leave
// one item doing as it took up the next, and start its own independent tasks together to work them one by one.)
test("a spinner says work goes on: the checklist's doing is the item the agent is on, a task starts as work on it begins — another, or several, only while something works them at once; the prompt's version moved with these words", () => {
  assert.equal(PROMPT_VERSION, 129);
  const ONE = "One item doing at a time: the one you are on; another only while a sub-agent or a background command works it.";
  assert.ok(TOOL_TEXT.plan.endsWith(` ${ONE}`), TOOL_TEXT.plan);
  // A coding agent's says next that its items are tasks on its graph (version 119, c-mirror).
  assert.ok(TOOL_TEXT.coderChecklist.endsWith(` ${ONE} Unless you lead a team, its items are tasks of yours on your task graph (p1, p2, … in the order you first gave them): doing starts one, done ends it.`), TOOL_TEXT.coderChecklist);
  const coder = /** @type {any} */ (CODER_TASKS_TOOL).input_schema.properties;
  const own = PROMPT.graph;
  for (const [text, start] of /** @type {[string, RegExp][]} */ ([
    [own, /you start when work on it begins — several at once only where sub-agents or commands work them meanwhile: a started task reads as at work — and mark done/],
    [String(coder.action.description), /start: tasks whose needs are done, as work on each begins; several at once only where sub-agents or commands work them meanwhile\./],
    [String(coder.ids.description), /^start: tasks whose needs are done, as work on each begins \(several at once only where sub-agents or commands work them meanwhile\), or done ones to reopen\./],
    [CODER_GRAPH_TEXT, /Start a task when work on it begins \(several at once only where sub-agents or background commands work them meanwhile: a started task reads as at work\), and mark it done/],
  ])) {
    assert.match(text, start);
    // The words before version 112: "can start together" (the graph section, its block), "independent ones start
    // together" (the start action), "several at once when independent" (the ids).
    assert.doesNotMatch(text, /start together|several at once when independent/);
  }
  // The loop's tasks tool says the same (the nudge map of 11-10: it still said "several at once when they are independent").
  for (const text of [TOOL_TEXT.tasks, TOOL_TEXT.tasksReads]) {
    assert.match(text, /start — ids of your own tasks whose needs are done, as work on each begins \(several at once only where sub-agents or commands work them meanwhile\), or /);
    assert.doesNotMatch(text, /several at once when they are independent/);
  }
});

// (fails before: yes — the nudge map of 11-10: "Started t1, t2: yours, so you do them now." and "p1, p2 started" said
// nothing of the rule the prompt gives.)
test("two of the agent's own tasks at work at once are said — by a start and by a checklist — one at a time, the others paused; one, a helper's or a step's, is not", () => {
  const both = /t1 and t2 both read as at work now: one task of yours at a time — the one you are on\. Pause the others until you take them up \(tasks pause, one call a task, each with its checkpoint\), unless a sub-agent or a command works one meanwhile\./;
  const g = tasks(null, { action: "add", goal: "Two", tasks: [{ id: "t1", name: "One" }, { id: "t2", name: "Two" }, { id: "t3", name: "Three" }] });
  const two = ok(tg.applyTasks(g, { action: "start", ids: ["t1", "t2"] }, AT));
  assert.match(two.text, both);
  // One started, then another: the second start says it too.
  const first = ok(tg.applyTasks(g, { action: "start", ids: ["t1"] }, AT));
  assert.doesNotMatch(first.text, /read as at work now/);
  assert.match(ok(tg.applyTasks(first.graph, { action: "start", ids: ["t2"] }, AT)).text, both);
  // A helper works one: nothing to say.
  const helped = tg.helperTook(first.graph, "t1", { agent: "sa_1", model: "m", copy: false, at: T1 });
  assert.doesNotMatch(ok(tg.applyTasks(helped || first.graph, { action: "start", ids: ["t2"] }, AT)).text, /read as at work now/);
  // One started again from its checkpoint, or reopened, beside the one it is on (Fable52's of 11-10): said too.
  const paused = ok(tg.applyTasks(first.graph, { action: "pause", id: "t1", checkpoint: "Read the parser; the comma next." }, AT));
  const onT2 = ok(tg.applyTasks(paused.graph, { action: "start", ids: ["t2"] }, AT));
  assert.doesNotMatch(onT2.text, /read as at work now/);
  assert.match(ok(tg.applyTasks(onT2.graph, { action: "start", ids: ["t1"] }, AT)).text, both);
  const t1done = ok(tg.applyTasks(first.graph, { action: "done", id: "t1", summary: "Read it." }, AT));
  const t2on = ok(tg.applyTasks(t1done.graph, { action: "start", ids: ["t2"] }, AT));
  const again = ok(tg.applyTasks(t2on.graph, { action: "start", ids: ["t1"] }, AT));
  assert.match(again.text, /Reopened t1 for round 2/);
  assert.match(again.text, both);
  // The checklist: two items doing.
  const r = plan(null, [I("Read the parser", "doing"), I("Fix the comma", "doing"), I("Run the tests")]);
  assert.match(r.text, /p1 and p2 are both doing, and each reads as at work: one item doing at a time — the one you are on\. Tick done what is done; one you have not taken up yet waits paused on your graph until you do \(tasks pause, one call a task, each with its checkpoint\)\./);
  // One doing, the one before it ticked done: nothing to say.
  assert.doesNotMatch(plan(r.graph, [I("Read the parser", "done"), I("Fix the comma", "doing"), I("Run the tests")]).text, /are both doing/);
  assert.doesNotMatch(plan(null, THREE).text, /are both doing/);
});

// (fails before: yes)
test("the prompt: the agent's graph section says its checklist is on the graph and its plan line gives the checklist first; a lead's and a prompt with no graph keep theirs; version 36 (37 since a lead's own hands, HarnessV4_Tasks decision 9; 38 since E23's model fields)", () => {
  assert.equal(PROMPT_VERSION, 129);
  const on = systemPromptFor({ root: "/p", delegateRead: false, graph: true });
  assert.ok(on.includes(PROMPT.planOnGraph));
  assert.ok(!on.includes(PROMPT.planOrGraph));
  assert.equal(PROMPT.planOnGraph, "Before you start work that breaks into more than one step, publish a checklist with the plan tool, and update it as items finish: its items are tasks on your task graph (below), and work that branches (a step with steps of its own) goes on the graph with the tasks tool, its steps as sub-tasks under it. Only a question you answer straight, or a single step, needs neither; never do work of more than one step with neither: the developer follows the work by them, live. Do not narrate a todo list in prose.");
  assert.match(PROMPT.graph, /^- Your checklist is on your task graph: each item you give the plan tool is a task of yours there, p1, p2, … in the order you first gave them, and its status moves the task — doing starts it, done ends it\. /);
  assert.match(PROMPT.graph, /\n- What the graph does for you: a task's check — one to five commands — runs in a copy of the folder once you mark it done, and a red one opens it again with the output; /);
  assert.doesNotMatch(PROMPT.graph, /Nothing has to go on it\./);
  const lead = systemPromptFor({ root: "/p", delegateRead: false, graph: true, lead: { name: "Architect", persona: "You lead." } });
  assert.ok(lead.includes(PROMPT.planOrGraph) && !lead.includes(PROMPT.planOnGraph) && !lead.includes(PROMPT.graph));
  // A prompt with no graph — a sub-agent's, a fork's — keeps the plain plan line.
  const noGraph = systemPromptFor({ root: "/p", delegateRead: false });
  assert.ok(noGraph.includes(PROMPT.plan) && !noGraph.includes(PROMPT.planOnGraph));
  // The plan tool is as it was, one doing at a time since version 112 (a spinner says work goes on, the owner's of 11-10).
  assert.equal(TOOL_TEXT.plan, "Publish or update your checklist for this task. Send the whole list every time (items keep their order); the developer sees it live. Statuses: pending, doing, done, blocked. One item doing at a time: the one you are on; another only while a sub-agent or a background command works it.");
  assert.equal(PLAN_TOOL.description, TOOL_TEXT.plan);
});

// ---- a-ticks: batch ticks, skipped items and reworded items are said (the nudge map of 11-10) ----------------------

/** A plan call in a turn of the chat's. @param {any} graph @param {{ text: string, status: string }[]} items @param {number} turn @returns {any} */
const planIn = (graph, items, turn) => tg.applyPlan(graph, items, { at: T1, crew: "agent", turn });
const BATCH = /tick each item doing as you start it and done as you finish it — the person follows your work by them\./;

// (fails before: yes — items ticked done in a heap, none doing first, were taken in silence: the person saw nothing move
// until the end)
test("items ticked done at once, none doing first: said once a turn, never for one ticked through doing", () => {
  let g = plan(null, [I("Read the code"), I("Fix the bug"), I("Write a test"), I("Run the suite")]).graph;
  const batch = planIn(g, [I("Read the code", "done"), I("Fix the bug", "done"), I("Write a test"), I("Run the suite")], 3);
  assert.match(batch.text, /You ticked p1, p2 done at once, none of them doing first: tick each item doing as you start it and done as you finish it — the person follows your work by them\./);
  const again = planIn(batch.graph, [I("Read the code", "done"), I("Fix the bug", "done"), I("Write a test", "done"), I("Run the suite", "done")], 3);
  assert.doesNotMatch(again.text, BATCH, "once a turn");
  g = plan(null, [I("Read the code"), I("Fix the bug"), I("Write a test")]).graph;
  const next = planIn(planIn(g, [I("Read the code", "done"), I("Fix the bug", "done"), I("Write a test")], 3).graph, [I("Read the code", "done"), I("Fix the bug", "done"), I("Write a test", "done")], 4);
  assert.doesNotMatch(next.text, BATCH, "one alone is no heap");
  // Through doing, one at a time: nothing said.
  g = planIn(plan(null, [I("Read the code", "doing"), I("Fix the bug")]).graph, [I("Read the code", "done"), I("Fix the bug", "doing")], 5).graph;
  assert.doesNotMatch(planIn(g, [I("Read the code", "done"), I("Fix the bug", "done")], 5).text, BATCH);
});

// (fails before: yes — an item left pending while later ones were ticked done was skipped in silence)
test("an item still pending while a later one is ticked done: do it, or take it off with why — not one whose needs wait", () => {
  let g = plan(null, [I("Read the code", "doing"), I("Fix the bug"), I("Write a test")]).graph;
  g = plan(g, [I("Read the code", "done"), I("Fix the bug"), I("Write a test", "doing")]).graph;
  const r = plan(g, [I("Read the code", "done"), I("Fix the bug"), I("Write a test", "done")]);
  assert.match(r.text, /p2 still waits while a later item is done: do it now, or take it off your checklist and say why\./);
  assert.doesNotMatch(plan(r.graph, [I("Read the code", "done"), I("Fix the bug"), I("Write a test", "done")]).text, /still waits/, "said as a later item is ticked, not at every send");
  // One that waits for its needs is no skip.
  g = plan(null, [I("Read the code", "doing"), I("Fix the bug"), I("Write a test")]).graph;
  g = tasks(g, { action: "add", tasks: [{ id: "t9", name: "Ask for the spec" }] });
  g = tasks(g, { action: "change", tasks: [{ id: "p2", needs: ["t9"] }] });
  g = plan(g, [I("Read the code", "done"), I("Fix the bug"), I("Write a test", "doing")]).graph;
  assert.doesNotMatch(plan(g, [I("Read the code", "done"), I("Fix the bug"), I("Write a test", "done")]).text, /still waits/);
});

// (fails before: yes — an item reworded on the checklist is a new task, and what tasks change gave the old one went with
// it in silence)
test("an item reworded on the checklist: the old task's check and acceptance are said gone, and how to give them to the new one", () => {
  let g = plan(null, [I("Fix the parser"), I("Run the tests")]).graph;
  g = tasks(g, { action: "change", tasks: [{ id: "p1", check: ["npm test"], acceptance: "a trailing comma parses" }] });
  const r = plan(g, [I("Fix parse() for a trailing comma"), I("Run the tests")]);
  assert.match(r.text, /p1 left your checklist, dropped/);
  assert.match(r.text, /p1 left your checklist with its check and acceptance, and p3 is new without them: if p3 is p1 in new words, give it what p1 had with tasks change by its id\./);
  // A plain item gone and one added: nothing went with it.
  const plain = plan(plan(null, [I("Fix the parser"), I("Run the tests")]).graph, [I("Fix parse()"), I("Run the tests")]);
  assert.doesNotMatch(plain.text, /new without/);
});

// (fails before: yes — FabeleHelper's lt_3e272bf8 §1 on 75a195da6: the guard held only a task a red check opened. A done
// task reopened with tasks start went running with no red verdict, and the next list, its item still done, ticked it done
// again: its summary overwritten, its check run again)
test("a task reopened since its item said done: the list sent again ticks nothing, said once per reopen", () => {
  let g = plan(null, [I("Fix the parser", "doing"), I("Run the tests")]).graph;
  g = plan(g, [I("Fix the parser", "done"), I("Run the tests")]).graph;
  assert.equal(task(g, "p1").state, "done");
  g = tasks(g, { action: "start", ids: ["p1"] });
  assert.equal(task(g, "p1").state, "running");
  const again = plan(g, [I("Fix the parser", "done"), I("Run the tests", "doing")]);
  assert.equal(task(again.graph, "p1").state, "running", "not ticked done again");
  assert.match(again.text, /p1 is open again since its item said done: its item still says done, which ticks nothing now — set it to doing while you work on it, then to done again\./);
  const twice = plan(again.graph, [I("Fix the parser", "done"), I("Run the tests", "doing")]);
  assert.equal(task(twice.graph, "p1").state, "running");
  assert.doesNotMatch(twice.text, /open again since its item said done/, "said once per reopen");
  // Doing, then done: it ends.
  const doing = plan(twice.graph, [I("Fix the parser", "doing"), I("Run the tests", "doing")]);
  assert.equal(task(plan(doing.graph, [I("Fix the parser", "done"), I("Run the tests", "doing")]).graph, "p1").state, "done");
});

// (fails before: yes — FabeleHelper's envelope 31 on b48d4bd4d: nothing marked a skipped item said, so one the agent left
// pending on purpose was named again at every later tick)
test("an item left pending while later ones are ticked done one by one is named once", () => {
  const names = ["Read the code", "Ask for the spec", "Fix the bug", "Write a test", "Run the suite"];
  /** The list with each item's status. @param {string[]} st */
  const list = (st) => names.map((n, i) => I(n, st[i]));
  let g = plan(null, list(["doing", "pending", "pending", "pending", "pending"])).graph;
  g = plan(g, list(["done", "pending", "pending", "pending", "pending"])).graph;
  let said = 0;
  for (const k of [2, 3, 4]) {
    const st = names.map((_, i) => (i === 0 || (i >= 2 && i < k) ? "done" : i === k ? "doing" : "pending"));
    g = plan(g, list(st)).graph;
    st[k] = "done";
    const r = plan(g, list(st));
    if (/p2 still waits while a later item is done/.test(r.text)) said++;
    g = r.graph;
  }
  assert.equal(said, 1);
});
