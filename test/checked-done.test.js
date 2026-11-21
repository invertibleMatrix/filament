// @ts-check
// HarnessV3-TaskGraph-v2 V2-1 (§14.1; TG2-D1, TG2-D3): checked done. A task on the session's graph may carry a check —
// one to five commands that prove it done — and Filament runs it itself: a worker's in its worktree once it reports, red
// going back to it twice first, as a team worker's does (TG2-D45); the agent's own in a copy of the folder once it marks
// the task done, in the background, the task `checking` meanwhile — green done, red open again, red then green flaky;
// at close, each distinct command once more on the folder as it stands. A check is read at the call as a brief's is
// (TG2-D44). A task with no check is done, unchecked, and says so. A worker that stopped on its provider says so in one
// line with the provider's choices (TG2-D54's rule). The cases of §14.1, in order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL } from "../src/app/agent/tools.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { copiesOf } from "./helpers/copies.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { membersOf } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made)
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {}
});

/** @type {{ crew: import("../src/core/task-graph.js").Crew }} */
const AGENT = { crew: "agent" };
const LED = membersOf({ scout: "Map what exists.", builder: "Build against the contract.", tester: "", reviewer: "Review against the contract." });
/** @param {any} r @returns {any} */
const ok = (r) => (assert.ok(r.ok, JSON.stringify(r)), r);
/** @param {any} r @returns {string} */
const no = (r) => (assert.equal(r.ok, false, JSON.stringify(r)), r.error);
/** Let what a promise's end starts run. */
const tick = () => new Promise((r) => setImmediate(r));
const T1 = 1000;

/** The agent's own task t1 with a check, a task t2 of its own that needs it, and a sub-agent's t3 that needs it too. */
const OWN = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Fix the parser", writes: ["src/parse.js"], check: ["npm test"] },
    { id: "t2", name: "Update the docs", needs: ["t1"] },
    { id: "t3", name: "Write more tests", needs: ["t1"], by: "sub-agent", writes: ["test/more.test.js"], goal: "More tests", steps: ["Write them"], acceptance: "they pass", check: ["node --test test/more.test.js"] },
  ],
};
/** @param {any} graph @param {string} id @returns {any} */
const task = (graph, id) => graph.tasks.find((/** @type {any} */ t) => t.id === id);
/** A check's run as the registry hands it: one command's end. @param {string} command @param {number | null} exit @param {Record<string, any>} [more] */
const RUN = (command, exit, more = {}) => ({ command, exit, ms: 4000, output: exit === 0 ? "ok" : "FAIL parse.test.js\n  expected [] to equal ['']", stopped: false, ...more });
/** How a check went, as the registry hands it. @param {any[]} runs @param {Record<string, any>} [more] @returns {any} */
const RAN = (runs, more = {}) => ({ ran: true, commands: runs.map((r) => r.command), runs, bounces: 0, stopped: false, ...more });

// ---- case 1: the field ----------------------------------------------------------------------------------------------

// (fails before: yes — check was no field of a task: "t1: check is no field of a task")
test("a task's check is one to five commands, for a task whose change is kept — every problem said at once", () => {
  const added = ok(tg.applyTasks(null, OWN, { at: T1, ...AGENT }));
  assert.deepEqual([task(added.graph, "t1").check, task(added.graph, "t2").check, task(added.graph, "t3").check], [["npm test"], [], ["node --test test/more.test.js"]]);
  assert.deepEqual([task(added.graph, "t1").verdict, task(added.graph, "t2").verdict], [null, null]);
  const bad = no(
    tg.applyTasks(
      null,
      {
        action: "add",
        goal: "g",
        tasks: [
          { id: "a", name: "A", check: ["1", "2", "3", "4", "5", "6"] },
          { id: "b", name: "B", check: "npm test" },
          { id: "c", name: "C", check: ["npm test", " "] },
          { id: "d", name: "D", by: "explorer", goal: "Know", steps: ["Look"], acceptance: "listed", check: ["npm test"] },
          { id: "e", name: "E", check: [`echo ${"x".repeat(600)}`] },
        ],
      },
      { at: T1, ...AGENT },
    ),
  );
  assert.equal(
    bad,
    [
      "5 problems, so nothing of this call changed — one call can fix them all:",
      "- a: check holds at most 5 commands — the ones that prove the task done",
      "- b: check is a list of commands, one to five — the ones that prove the task done",
      "- c: check is a list of commands, one to five — the ones that prove the task done",
      "- d: check is for a task whose change is kept — your own, or one that changes files — and an explorer changes nothing: its report is what is read",
      "- e: a command of check is up to 500 characters (this one has 605)",
    ].join("\n"),
  );
  // A team's member that changes nothing takes none; a coding agent's own task takes one.
  const scout = no(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "s", name: "S", by: "scout", goal: "Know", steps: ["Look"], acceptance: "listed", check: ["npm test"] }] }, { at: T1, crew: LED }));
  assert.equal(scout, "s: check is for a task whose change is kept — your own, or one that changes files — and a scout changes nothing: its report is what is read");
  ok(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "c1", name: "C", check: ["npm test"] }] }, { at: T1, crew: "agent", solo: true }));
  // check: [] takes it away.
  const changed = ok(tg.applyTasks(added.graph, { action: "change", tasks: [{ id: "t1", check: [] }] }, { at: T1, ...AGENT }));
  assert.deepEqual(task(changed.graph, "t1").check, []);
});

// (fails before: yes — nothing vetted a check's commands)
test("each command is vetted as the call is read — the session's rules and a brief's rule speak through `vet`, among the call's other problems", () => {
  /** @param {readonly string[]} cmds */
  const vet = (cmds) => (cmds.includes("npm ci") ? "check's `npm ci` installs packages, and a worker's worktree uses your folder's installed ones: leave it out — what the task needs installed, the developer installs" : null);
  const r = no(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "a", name: "A", check: ["npm ci", "npm test"] }, { id: "b", name: "" }] }, { at: T1, ...AGENT, vet }));
  assert.equal(r, "2 problems, so nothing of this call changed — one call can fix them all:\n- a: check's `npm ci` installs packages, and a worker's worktree uses your folder's installed ones: leave it out — what the task needs installed, the developer installs\n- b: name is required: a few words naming the task");
  // Only a check the call gives is vetted: one it keeps was, when it came.
  /** @type {string[][]} */
  const asked = [];
  const g = ok(tg.applyTasks(null, OWN, { at: T1, ...AGENT, vet: (c) => (asked.push([...c]), null) })).graph;
  ok(tg.applyTasks(g, { action: "change", tasks: [{ id: "t1", name: "Fix the parser well" }] }, { at: T1, ...AGENT, vet: (c) => (asked.push([...c]), null) }));
  assert.deepEqual(asked, [["npm test"], ["node --test test/more.test.js"]]);
});

// ---- cases 4 and 5: the agent's own done ----------------------------------------------------------------------------

// (fails before: yes — done marked the task done at once, whatever proved it)
test("the agent's done of a task with a check sets it checking and answers at once; a task of its own that needs it may start, a worker's waits", () => {
  const g = ok(tg.applyTasks(null, OWN, { at: T1, ...AGENT })).graph;
  const started = ok(tg.applyTasks(g, { action: "start", ids: ["t1"] }, { at: T1, ...AGENT })).graph;
  const d = ok(tg.applyTasks(started, { action: "done", id: "t1", summary: "Empty input gives []" }, { at: T1 + 1, ...AGENT }));
  assert.equal(task(d.graph, "t1").state, "checking");
  assert.equal(d.text, "Checking t1: Filament runs its check in a copy of your folder now (`npm test`); it is done once that passes. Its verdict reaches you either way, and wakes this chat if your turn has ended: go on with what does not need it. Next of yours: t2 \"Update the docs\" — start it as you take it up. 0 of 3 done · checking: t1.");
  assert.deepEqual(tg.jobs(d.graph), [], "a worker's task starts from checked work");
  ok(tg.applyTasks(d.graph, { action: "start", ids: ["t2"] }, { at: T1 + 2, ...AGENT }));
  assert.equal(no(tg.applyTasks(d.graph, { action: "done", id: "t1", summary: "again" }, { at: T1 + 2, ...AGENT })), "t1 is being checked now — its verdict reaches you as a message");
  assert.equal(no(tg.applyTasks(d.graph, { action: "change", tasks: [{ id: "t1", name: "x" }] }, { at: T1 + 2, ...AGENT })), "t1 is being checked now — wait for its verdict");
  assert.equal(no(tg.applyTasks(d.graph, { action: "drop", ids: ["t1"], reason: "x" }, { at: T1 + 2, ...AGENT })), "t1 is being checked now — wait for its verdict");
  assert.match(tg.showText(d.graph, "agent"), /- t1 "Fix the parser" — being checked: `npm test` · writes src\/parse\.js/);
  assert.equal(tg.graphView(d.graph)?.counts.checking, 1);
  // A task with no check is done at once, as before.
  const own = ok(tg.applyTasks(d.graph, { action: "start", ids: ["t2"] }, { at: T1 + 3, ...AGENT })).graph;
  assert.equal(task(ok(tg.applyTasks(own, { action: "done", id: "t2", summary: "Docs" }, { at: T1 + 4, ...AGENT })).graph, "t2").state, "done");
});

/** The graph with t1 done and checking. */
const checkingGraph = () => {
  const g = ok(tg.applyTasks(null, OWN, { at: T1, ...AGENT })).graph;
  return ok(tg.applyTasks(g, { action: "done", id: "t1", summary: "Empty input gives []" }, { at: T1 + 1, ...AGENT })).graph;
};

// (fails before: yes — there was no verdict to read)
test("green: done, checked; red twice: open again with the end of its output; red then green: done, flaky; not run: done, unchecked — each told", () => {
  const green = /** @type {any} */ (tg.checked(checkingGraph(), "t1", RAN([RUN("npm test", 0)]), T1 + 5));
  assert.equal(green.state, "done");
  const t = task(green.graph, "t1");
  assert.deepEqual([t.state, t.verdict], ["done", { kind: "passed", runs: [{ command: "npm test", exit: 0, ms: 4000, first: null }], unrun: [], output: "", words: "", back: 0, at: T1 + 5 }]);
  assert.equal(tg.endText(green.graph, "t1", { crew: "agent" }), '[Filament: task t1 "Fix the parser" passed its check: `npm test` passed (exit 0, 4 s). It is done.\nNow: 1 of 3 done · ready: t2, t3.]');
  assert.deepEqual(tg.jobs(green.graph), [{ id: "t3", kind: "start" }], "checked: the worker's task starts");
  assert.match(tg.showText(green.graph, "agent"), /- t1 "Fix the parser" — done, checked: Empty input gives \[\]/);
  assert.match(String(tg.applyTasks(green.graph, { action: "show", id: "t1" }, { at: T1, ...AGENT }).ok && /** @type {any} */ (tg.applyTasks(green.graph, { action: "show", id: "t1" }, { at: T1, ...AGENT })).text), /\nCheck: `npm test`\nChecked: `npm test` passed \(exit 0, 4 s\)/);

  const red = /** @type {any} */ (tg.checked(checkingGraph(), "t1", RAN([RUN("npm test", 1, { first: { exit: 1, ms: 3000 } })]), T1 + 5));
  assert.equal(red.state, "open");
  assert.deepEqual([task(red.graph, "t1").state, task(red.graph, "t1").verdict.kind, task(red.graph, "t1").verdict.output], ["running", "failed", "FAIL parse.test.js\n  expected [] to equal ['']"]);
  assert.equal(
    tg.endText(red.graph, "t1", { crew: "agent" }),
    "[Filament: task t1 \"Fix the parser\" did not pass its check, so it is open again: `npm test` failed (exit 1, 3 s), and again on a second run (exit 1, 4 s). Fix the cause — never the check — then mark it done again (tasks done).\nThe end of its output:\nFAIL parse.test.js\n  expected [] to equal ['']\nNow: 0 of 3 done · running: t1.]",
  );
  assert.equal(tg.jobs(red.graph).length, 0);
  assert.equal(no(tg.applyTasks(red.graph, { action: "start", ids: ["t2"] }, { at: T1 + 6, ...AGENT })), "t2 can't start yet: it needs t1 (running) done first");
  // Done again, it is checked again.
  assert.equal(task(ok(tg.applyTasks(red.graph, { action: "done", id: "t1", summary: "Fixed" }, { at: T1 + 7, ...AGENT })).graph, "t1").state, "checking");

  const flaky = /** @type {any} */ (tg.checked(checkingGraph(), "t1", RAN([RUN("npm test", 0, { first: { exit: 1, ms: 3000 } })]), T1 + 5));
  assert.deepEqual([flaky.state, task(flaky.graph, "t1").verdict.kind], ["done", "flaky"]);
  assert.equal(tg.endText(flaky.graph, "t1", { crew: "agent" }), '[Filament: task t1 "Fix the parser" passed its check, flaky: `npm test` failed (exit 1, 3 s), then passed (exit 0, 4 s) on a second run. It is done.\nNow: 1 of 3 done · ready: t2, t3.]');
  assert.match(tg.showText(flaky.graph, "agent"), /— done, checked \(flaky\): /);
  // (fails before: yes — the owner's of 11-06: a flaky verdict kept nothing of its first run, so what failed could not
  // be looked into) The end of what its first run printed rides the verdict.
  const told = /** @type {any} */ (tg.checked(checkingGraph(), "t1", RAN([RUN("npm test", 0, { first: { exit: 1, ms: 3000, output: "ok 1\nnot ok 2 - the lock was held\nℹ fail 1\n" } })]), T1 + 5));
  assert.equal(task(told.graph, "t1").verdict.output, "ok 1\nnot ok 2 - the lock was held\nℹ fail 1");
  assert.equal(tg.endText(told.graph, "t1", { crew: "agent" }), '[Filament: task t1 "Fix the parser" passed its check, flaky: `npm test` failed (exit 1, 3 s), then passed (exit 0, 4 s) on a second run. It is done.\nThe end of its first run\'s output:\nok 1\nnot ok 2 - the lock was held\nℹ fail 1\nNow: 1 of 3 done · ready: t2, t3.]');
  // (fails before: yes — the hunt of check-wake: tasks show and the Plan's task said "flaky", nothing of what failed)
  const shown = /** @type {any} */ (tg.applyTasks(told.graph, { action: "show", id: "t1" }, { at: T1, ...AGENT })).text;
  assert.match(shown, /\nChecked, flaky: `npm test` failed \(exit 1, 3 s\), then passed \(exit 0, 4 s\) on a second run\nThe end of its first run's output:\nok 1\nnot ok 2 - the lock was held\nℹ fail 1/);
  assert.doesNotMatch(String(/** @type {any} */ (tg.applyTasks(flaky.graph, { action: "show", id: "t1" }, { at: T1, ...AGENT })).text), /first run's output/, "none kept, none said");
  assert.ok(textOf(drawGraph(tg.graphView(told.graph), { h: fakeH, now: T1 + 60_000, chosen: "t1" }).el).includes("passed, flaky — npm test: exit 1, then exit 0 on a second run|ok 1\nnot ok 2 - the lock was held\nℹ fail 1"), "the Plan's task quotes it");

  const not = /** @type {any} */ (tg.checked(checkingGraph(), "t1", { ran: false, words: "this folder is not in git, so Filament has no copy of it to run the check in" }, T1 + 5));
  assert.deepEqual([not.state, task(not.graph, "t1").verdict.kind], ["done", "not"]);
  assert.equal(tg.endText(not.graph, "t1", { crew: "agent" }), '[Filament: Filament did not check task t1 "Fix the parser": this folder is not in git, so Filament has no copy of it to run the check in. It is done, unchecked.\nNow: 1 of 3 done · ready: t2, t3.]');
  // Several commands: the one that failed, those before it, and those not run.
  const many = /** @type {any} */ (tg.checked(checkingGraph(), "t1", { ...RAN([RUN("npm run build", 0), RUN("npm test", 1, { first: { exit: 1, ms: 3000 } })]), commands: ["npm run build", "npm test", "npx tsc"] }, T1 + 5));
  assert.match(tg.endText(many.graph, "t1", { crew: "agent" }), /open again: `npm run build` passed \(exit 0, 4 s\); `npm test` failed \(exit 1, 3 s\), and again on a second run \(exit 1, 4 s\); `npx tsc` not run\. /);
  // A check whose task is no longer checking is not this task's verdict.
  assert.equal(tg.checked(green.graph, "t1", RAN([RUN("npm test", 0)]), T1 + 9), null);
});

// ---- cases 2, 3 and 6: a worker's task ------------------------------------------------------------------------------

/** The graph with t3 — a sub-agent's, with a check — running on sa-1. */
const workerGraph = () => {
  const g = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [OWN.tasks[2], { id: "t4", name: "Ship it", needs: ["t3"] }].map((t) => ({ ...t, needs: (t.needs || []).filter((n) => n !== "t1") })) }, { at: T1, ...AGENT })).graph;
  return /** @type {any} */ (tg.launched(g, "t3", "sa-1", T1 + 1, "sub-agent"));
};
const FILES = [{ path: "test/more.test.js", added: 20, removed: 0 }];
/** A graph task's end. @param {Record<string, any>} [more] @returns {any} */
const END = (more = {}) => ({ agent: "sa-1", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Wrote the tests.", met: true, evidence: "they pass", left: "" }, words: "", files: FILES, shared: false, wrote: true, workError: null, ran: [], calls: [], written: [], spentUsd: 0.1, ms: 60_000, cut: false, check: null, provider: null, ...more });

// (fails before: yes — the worker's met decided: a red check nobody ran merged)
test("a worker's check red after two returns fails its task in the check's words, its met named as the claim", () => {
  const r = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ check: RAN([RUN("node --test test/more.test.js", 1, { first: { exit: 1, ms: 3000 } })], { bounces: 2 }) }), T1 + 9));
  assert.equal(r.state, "failed");
  const t = task(r.graph, "t3");
  assert.equal(t.why, "Filament ran its check after it reported, and it failed after going back to its sub-agent twice, though its report said it passed");
  assert.deepEqual([t.verdict.kind, t.verdict.back, t.failures.cause], ["failed", 2, "check"]);
  const told = tg.endText(r.graph, "t3", { crew: "agent" });
  assert.match(told, /^\[Filament: task t3 "Write more tests" failed: Filament ran its check after it reported, and it failed after going back to its sub-agent twice, though its report said it passed\.\n/);
  assert.match(told, /\nCheck: `node --test test\/more\.test\.js` failed \(exit 1, 3 s\), and again on a second run \(exit 1, 4 s\)\nThe end of its output:\nFAIL parse\.test\.js\n {2}expected \[\] to equal \[''\]\n/);
  assert.match(told, /Its change is not in your folder: it waits in sub-agent sa-1's own worktree/);
  // Its report said it had not passed: no claim to name.
  const said = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ report: { ...END().report, met: false }, check: RAN([RUN("node --test test/more.test.js", 1)]) }), T1 + 9));
  assert.equal(task(said.graph, "t3").why, "Filament ran its check after it reported, and it failed");
});

// (fails before: yes — met: false failed the task though its check passed)
test("a worker's check green decides, whatever its met said: the task goes on — its change is ready, and merges once applied — and the end says the check passed", () => {
  const r = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ report: { ...END().report, met: false }, check: RAN([RUN("node --test test/more.test.js", 0)]) }), T1 + 9));
  assert.equal(r.state, "yours");
  const merged = /** @type {any} */ (tg.taskMerged(r.graph, "t3", FILES, T1 + 10));
  const told = tg.endText(merged, "t3", { crew: "agent" });
  assert.match(told, /^\[Filament: task t3 "Write more tests" is done: sub-agent sa-1 reported it done, and Filament's check passed \(`node --test test\/more\.test\.js`, 4 s\), and its change is merged into your folder\.\n/);
  assert.match(told, /\nIts report said the check had not passed; Filament's run of it passed\.\n/);
  assert.match(tg.showText(merged, "agent"), /— done, checked: Wrote the tests\./);
  // Flaky, in the worker's end too.
  const fl = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ check: RAN([RUN("node --test test/more.test.js", 0, { first: { exit: 1, ms: 3000 } })]) }), T1 + 9));
  assert.match(tg.endText(/** @type {any} */ (tg.taskMerged(fl.graph, "t3", FILES, T1 + 10)), "t3", { crew: "agent" }), /reported it done, and Filament's check passed, flaky: `node --test test\/more\.test\.js` failed \(exit 1, 3 s\), then passed \(exit 0, 4 s\) on a second run, and its change is merged/);
});

// (fails before: yes — a task with no check was done in its worker's words, with nothing said)
test("no check, or none Filament could run: done, unchecked — in the end's message, in tasks show, and in the page's data", () => {
  const plain = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ check: { ran: false, words: "its worker worked in the folder itself, so there was no worktree to run it in" } }), T1 + 9));
  assert.equal(plain.state, "yours", "the check could not run: its met decides, and its change is ready");
  const m = /** @type {any} */ (tg.taskMerged(plain.graph, "t3", FILES, T1 + 10));
  assert.match(tg.endText(m, "t3", { crew: "agent" }), /reported it done with its acceptance check passed — unchecked: its worker worked in the folder itself, so there was no worktree to run it in — and its change is merged into your folder\./);
  assert.equal(task(m, "t3").verdict.kind, "not");
  // A writer's task with no check.
  const g = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ ...OWN.tasks[2], needs: [], check: undefined }] }, { at: T1, ...AGENT })).graph;
  const run = /** @type {any} */ (tg.launched(g, "t3", "sa-1", T1, "sub-agent"));
  const e = /** @type {any} */ (tg.taskEnded(run, "t3", END(), T1 + 9));
  const done = /** @type {any} */ (tg.taskMerged(e.graph, "t3", FILES, T1 + 10));
  assert.match(tg.endText(done, "t3", { crew: "agent" }), /reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — and its change is merged into your folder\./);
  const shown = /** @type {any} */ (tg.applyTasks(done, { action: "show", id: "t3" }, { at: T1, ...AGENT })).text;
  assert.match(shown, /\nUnchecked: the task has no check\./);
  assert.equal(tg.graphView(done)?.tasks[0].verdict, null);
  // An explorer's task, which takes none, says nothing of one.
  const ex = ok(tg.applyTasks(null, { action: "add", goal: "Map", tasks: [{ id: "x1", name: "Map it", by: "explorer", goal: "Know", steps: ["Look"], acceptance: "listed" }] }, { at: T1, ...AGENT })).graph;
  const xr = /** @type {any} */ (tg.taskEnded(/** @type {any} */ (tg.launched(ex, "x1", "sa-2", T1, "explorer")), "x1", { ...END(), agent: "sa-2", files: [] }, T1 + 1));
  assert.doesNotMatch(tg.endText(xr.graph, "x1", { crew: "agent" }), /unchecked/);
  // The agent's own task with no check: no word of one, as before.
  const own = ok(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "o", name: "O" }] }, { at: T1, ...AGENT })).graph;
  const od = ok(tg.applyTasks(own, { action: "done", id: "o", summary: "Did it" }, { at: T1, ...AGENT })).graph;
  assert.match(/** @type {any} */ (tg.applyTasks(od, { action: "show", id: "o" }, { at: T1, ...AGENT })).text, /\nUnchecked: the task has no check\./);
});

// (fails before: yes — the brief named no check)
test("a worker's brief names its task's check", () => {
  const g = workerGraph();
  assert.match(tg.briefText(g, "t3", "agent"), /\n\nAcceptance check: they pass\n\nIts check — the commands that prove it done: `node --test test\/more\.test\.js`\n\n/);
});

// ---- case 7: a restart cuts a check; case 8: close -----------------------------------------------------------------

// (fails before: yes — a restart cut nothing of the agent's own)
test("a restart cuts a running check: the task is done, unchecked, and told in the check's words", () => {
  const cut = /** @type {any} */ (tg.restartCut(checkingGraph(), T1 + 9));
  assert.deepEqual(cut.ids, ["t1"]);
  assert.deepEqual([task(cut.graph, "t1").state, task(cut.graph, "t1").verdict.words], ["done", "a Filament restart cut its check"]);
  assert.equal(tg.endText(cut.graph, "t1", { crew: "agent" }), '[Filament: Filament did not check task t1 "Fix the parser": a Filament restart cut its check. It is done, unchecked.\nNow: 1 of 3 done · ready: t2, t3.]');
});

// (fails before: yes — close ran nothing)
test("close takes a checking task as done, says it runs each distinct check once more, and its verdict names the tasks and the red ones' output", () => {
  const g = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ id: "a", name: "A", check: ["npm test"] }, { id: "b", name: "B", check: ["npm test", "npx tsc"] }, { id: "c", name: "C" }, { id: "d", name: "D", check: ["npm run lint"] }] }, { at: T1, ...AGENT })).graph;
  let x = ok(tg.applyTasks(g, { action: "done", id: "a", summary: "A" }, { at: T1, ...AGENT })).graph;
  x = /** @type {any} */ (tg.checked(x, "a", RAN([RUN("npm test", 0)]), T1)).graph;
  x = ok(tg.applyTasks(x, { action: "done", id: "b", summary: "B" }, { at: T1, ...AGENT })).graph;
  x = ok(tg.applyTasks(x, { action: "done", id: "c", summary: "C" }, { at: T1, ...AGENT })).graph;
  const closed = ok(tg.applyTasks(x, { action: "close", reason: "shipped" }, { at: T1 + 1, ...AGENT }));
  assert.equal(closed.text, "Closed the graph: 3 done, 1 still open dropped with it. Filament runs their checks once more on your folder as it stands — `npm test`, `npx tsc` — and you hear what comes.");
  assert.deepEqual([task(closed.graph, "b").state, task(closed.graph, "b").verdict, task(closed.graph, "d").state], ["done", null, "dropped"]);
  assert.deepEqual(tg.closeRuns(closed.graph), [{ command: "npm test", tasks: ["a", "b"] }, { command: "npx tsc", tasks: ["b"] }]);
  const after = tg.closeChecked(closed.graph, { ...RAN([RUN("npm test", 0), RUN("npx tsc", 2, { output: "src/a.ts(3,1): error TS2304", first: { exit: 2, ms: 9000 } })]) }, T1 + 2);
  assert.equal(task(after, "b").verdict.kind, "failed", "the close's run is a checking task's check");
  assert.deepEqual([task(after, "a").verdict.kind, task(after, "a").verdict.at], ["passed", T1], "a task's own verdict stands: the close's run is not its");
  assert.equal(
    tg.closeChecksText(after, "agent"),
    "[Filament: after the graph's close, Filament ran its checks on your folder as it stands: `npm test` (a, b) passed (exit 0, 4 s); `npx tsc` (b) failed (exit 2, 9 s), and again on a second run (exit 2, 4 s). A check that passed when its task was done and fails now was broken by later work.\nThe end of `npx tsc`'s output:\nsrc/a.ts(3,1): error TS2304]",
  );
  const green = tg.closeChecked(closed.graph, RAN([RUN("npm test", 0), RUN("npx tsc", 0)]), T1 + 2);
  assert.equal(tg.closeChecksText(green, "agent"), "[Filament: after the graph's close, its checks passed on your folder as it stands: `npm test` (a, b) passed (exit 0, 4 s); `npx tsc` (b) passed (exit 0, 4 s).]");
  assert.equal(tg.closeChecksText(tg.closeChecked(closed.graph, { ran: false, words: "this folder is not in git, so Filament has no copy of it to run the check in" }, T1 + 2), "agent"), "[Filament: Filament did not run the graph's checks after its close: this folder is not in git, so Filament has no copy of it to run the check in.]");
  // A graph with no check closes as before.
  const bare = ok(tg.applyTasks(ok(tg.applyTasks(null, { action: "add", goal: "g", tasks: [{ id: "o", name: "O" }] }, { at: T1, ...AGENT })).graph, { action: "close", reason: "done" }, { at: T1, ...AGENT }));
  assert.equal(bare.text, "Closed the graph: 0 done, 1 still open dropped with it.");
});

// ---- case 11: a worker's provider failure ---------------------------------------------------------------------------

// (fails before: yes — "its run failed (…)" with the four choices of any failure)
test("a worker that stopped on its provider: one line, the provider's words, and the provider's choices — a wall's new worker first", () => {
  const out = { said: 'zai says this account\'s allowance is used up — "Insufficient balance" (HTTP 429). It was not tried again, and the pool skips zai for 15 min.', wall: true, later: "once zai serves again", fresh: "which the pool puts on zai-b/glm-5.3-flash now", tell: null };
  const r = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ status: "failed", error: "round 1's model call failed", report: null, provider: out }), T1 + 9));
  assert.equal(r.state, "failed");
  assert.equal(task(r.graph, "t3").failures.cause, "provider");
  const told = tg.endText(r.graph, "t3", { crew: "agent" });
  assert.match(told, /^\[Filament: task t3 "Write more tests" failed: it stopped on its provider, not on its task: zai says this account's allowance is used up — "Insufficient balance" \(HTTP 429\)\. It was not tried again, and the pool skips zai for 15 min\.\n/);
  assert.match(told, /\nYour choices: send it back to a new sub-agent — tasks start with its id and fresh: true — which the pool puts on zai-b\/glm-5\.3-flash now; send it back to its sub-agent once zai serves again — tasks start with its id — keeping its conversation and its worktree; re-plan around it; or drop it\.\n/);
  const busy = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ status: "failed", report: null, files: [], provider: { ...out, said: "zai was busy or failing for everyone — \"Overloaded\" (HTTP 529) — through 10 tries over 2 min.", wall: false, later: "in a few minutes" } }), T1 + 9));
  assert.match(tg.endText(busy.graph, "t3", { crew: "agent" }), /\nYour choices: send it back to its sub-agent in a few minutes — tasks start with its id — keeping its conversation; send it back to a new sub-agent — tasks start with its id and fresh: true — which the pool puts on zai-b\/glm-5\.3-flash now; re-plan around it; or drop it\.\n/);
  const model = /** @type {any} */ (tg.taskEnded(workerGraph(), "t3", END({ status: "failed", report: null, files: [], provider: { ...out, said: "zai refuses glm-9 for this account — \"no such model\" (HTTP 403). It was not tried again: every try of glm-9 meets the same refusal.", tell: "Tell the developer: the session's pool needs a model zai serves this account in place of glm-9." } }), T1 + 9));
  assert.match(tg.endText(model.graph, "t3", { crew: "agent" }), /\nTell the developer: the session's pool needs a model zai serves this account in place of glm-9\. Then send it back to a new sub-agent — tasks start with its id and fresh: true — or re-plan around it, or drop it\.\n/);
  // Under a lead, in its words.
  const lg = ok(tg.applyTasks(null, { action: "add", goal: "Ship", tasks: [{ id: "b1", name: "Build", by: "builder", writes: ["a.js"], goal: "g", steps: ["s"], acceptance: "a" }] }, { at: T1, crew: LED })).graph;
  const lr = /** @type {any} */ (tg.taskEnded(/** @type {any} */ (tg.launched(lg, "b1", "sa-9", T1, "builder")), "b1", { ...END({ status: "failed", report: null, provider: out }), agent: "sa-9" }, T1 + 1));
  assert.match(tg.endText(lr.graph, "b1", { crew: LED }), /Your choices: send it back to a new builder — tasks start with its id and fresh: true — which the pool puts on zai-b\/glm-5\.3-flash now; send it back to its builder once zai serves again/);
});

// ---- the runner ------------------------------------------------------------------------------------------------------

/**
 * A session kept in memory and a registry that records what the runner asks of a check — `checkFolder` answers when
 * the test says, `checkProblem` in `state.problem`'s words.
 */
function rig() {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }]]);
  /** @type {any[]} */
  const told = [];
  /** @type {any[]} */
  const launches = [];
  /** @type {{ commands: string[], o: any, done: (v: any) => void }[]} */
  const folderChecks = [];
  /** @type {string[][]} */
  const vetted = [];
  const state = { problem: /** @type {string | null} */ (null), t: 2000, n: 0 };
  const registry = {
    /** @param {any} spec */
    launch: (spec) => (launches.push(spec), { ok: true, id: `sa-${++state.n}`, done: new Promise(() => {}) }),
    slots: () => 4,
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => told.push({ chainId, ...d }),
    stop: () => ({ ok: true }),
    resumable: () => null,
    /** @param {string} chainId @param {string[]} commands @param {any} o */
    checkFolder: (chainId, commands, o) =>
      new Promise((done) => {
        folderChecks.push({ commands, o, done });
        o.signal?.addEventListener("abort", () => done(RAN([RUN(commands[0], null, { stopped: true })], { stopped: true })), { once: true });
      }),
    /** @param {string} chainId @param {string[]} commands */
    checkProblem: (chainId, commands) => (vetted.push(commands), state.problem),
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
  const make = (/** @type {Record<string, any>} */ extra = {}) => createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: () => {} }, crew: () => "agent", log: () => {}, now: () => state.t++, ...extra });
  return { runner: make(), make, chains, told, launches, folderChecks, vetted, state, graph: () => chains.get("c1").meta.graph };
}
const TURN = { runId: "turn-1", cwd: "/p", mode: null, model: "m", thinking: null, team: null };

// (fails before: yes — the runner vetted nothing, and refused nothing)
test("the runner vets a check through the registry as the call is read — a refusal keeps the graph as it was", () => {
  const r = rig();
  r.state.problem = "check's `npm test` is refused by this session's rule bash(npm test:*) deny: leave it out";
  assert.equal(no(r.runner.apply("c1", OWN, AGENT)), "2 problems, so nothing of this call changed — one call can fix them all:\n- t1: check's `npm test` is refused by this session's rule bash(npm test:*) deny: leave it out\n- t3: check's `npm test` is refused by this session's rule bash(npm test:*) deny: leave it out");
  assert.equal(r.graph(), undefined);
  r.state.problem = null;
  ok(r.runner.apply("c1", OWN, AGENT));
  assert.deepEqual(r.vetted.slice(-2), [["npm test"], ["node --test test/more.test.js"]]);
});

// (fails before: yes — a worker's brief carried no grant of its check)
test("a worker's task with a check is launched with it granted, so the worker runs it without asking in its worktree", () => {
  const r = rig();
  ok(r.runner.apply("c1", { action: "add", goal: "g", tasks: [{ ...OWN.tasks[2], needs: [] }] }, AGENT));
  r.runner.attach("c1", TURN);
  assert.deepEqual(r.launches[0].grants, { check: ["node --test test/more.test.js"], mayRun: [] });
});

// (fails before: yes — done ended the task: nothing ran, and the turn owed nothing)
test("the agent's done runs the check in the background: the turn owes it, green is told, red reopens and is told", async () => {
  const r = rig();
  ok(r.runner.apply("c1", OWN, AGENT));
  r.runner.attach("c1", TURN);
  const d = ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
  assert.match(d.text, /^Checking t1: /);
  assert.equal(r.folderChecks.length, 1);
  assert.deepEqual([r.folderChecks[0].commands, r.folderChecks[0].o.all, r.folderChecks[0].o.id], [["npm test"], false, "check-t1"]);
  const owed = r.runner.owes("c1");
  assert.ok(owed, "the turn waits for the verdict");
  r.folderChecks[0].done(RAN([RUN("npm test", 1, { first: { exit: 1, ms: 3000 } })]));
  await tick();
  assert.equal(task(r.graph(), "t1").state, "running");
  assert.equal(r.told.at(-1).text, tg.endText(r.graph(), "t1", { crew: "agent" }));
  assert.deepEqual([r.told.at(-1).task, r.told.at(-1).description], ["t1", "t1: Fix the parser"]);
  assert.equal(r.runner.owes("c1"), null, "nothing owed once told");
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed again" }, AGENT));
  r.folderChecks[1].done(RAN([RUN("npm test", 0)]));
  await tick();
  assert.equal(task(r.graph(), "t1").state, "done");
  assert.match(r.told.at(-1).text, /passed its check/);
  assert.equal(r.launches.at(-1).task.id, "t3", "checked: the worker's task starts");
});

// (fails before: yes — nothing ran to stop)
test("the developer's stop cuts a running check: done, unchecked, told in the stop's words", async () => {
  const r = rig();
  ok(r.runner.apply("c1", OWN, AGENT));
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
  r.runner.stop("c1");
  await tick();
  assert.equal(r.folderChecks[0].o.signal.aborted, true);
  assert.deepEqual([task(r.graph(), "t1").state, task(r.graph(), "t1").verdict.words], ["done", "the developer's stop cut its check"]);
  assert.match(r.told.at(-1).text, /Filament did not check task t1 "Fix the parser": the developer's stop cut its check\. It is done, unchecked\./);
});

// (fails before: yes — the hunt of check-wake: a close's run that failed and then passed kept nothing of its first run)
test("a close's run that is flaky keeps the end of its first run's output, on the close and on the task's verdict, and says it", () => {
  const g = ok(tg.applyTasks(checkingGraph(), { action: "close", reason: "shipped" }, { at: T1 + 2, ...AGENT })).graph;
  const first = { exit: 1, ms: 3000, output: "ok 1\nnot ok 2 - the lock was held\n" };
  const closed = tg.closeChecked(g, RAN([RUN("npm test", 0, { first })]), T1 + 5);
  assert.equal(/** @type {any} */ (closed.closed?.checks).runs[0].output, "ok 1\nnot ok 2 - the lock was held");
  assert.deepEqual([task(closed, "t1").verdict.kind, task(closed, "t1").verdict.output], ["flaky", "ok 1\nnot ok 2 - the lock was held"]);
  assert.equal(tg.closeChecksText(closed, "agent"), "[Filament: after the graph's close, its checks passed on your folder as it stands: `npm test` (t1) failed (exit 1, 3 s), then passed (exit 0, 4 s) on a second run.\nThe end of `npm test`'s first run's output:\nok 1\nnot ok 2 - the lock was held]");
  const green = tg.closeChecked(g, RAN([RUN("npm test", 0)]), T1 + 5);
  assert.equal(tg.closeChecksText(green, "agent"), "[Filament: after the graph's close, its checks passed on your folder as it stands: `npm test` (t1) passed (exit 0, 4 s).]");
  const red = tg.closeChecked(g, RAN([RUN("npm test", 1, { first })]), T1 + 5);
  assert.deepEqual([task(red, "t1").verdict.kind, task(red, "t1").verdict.output], ["failed", "FAIL parse.test.js\n  expected [] to equal ['']"], "a red one keeps its own run's");
  const both = tg.closeChecked(g, RAN([RUN("npm run lint", 1), RUN("npm test", 0, { first })]), T1 + 5);
  assert.match(tg.closeChecksText(both, "agent"), /\nThe end of `npm run lint`'s output:\nFAIL parse\.test\.js\n {2}expected \[\] to equal \[''\]\nThe end of `npm test`'s first run's output:\nok 1\nnot ok 2 - the lock was held\]$/, "beside a red one, the flaky one's first run too");
});

// (fails before: yes — close ran nothing)
test("close runs each distinct check once more on the folder, owed by the turn, and its verdict is told and kept", async () => {
  const r = rig();
  ok(r.runner.apply("c1", OWN, AGENT));
  r.runner.attach("c1", TURN);
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
  const closed = ok(r.runner.apply("c1", { action: "close", reason: "shipped" }, AGENT));
  assert.match(closed.text, /Filament runs their checks once more on your folder as it stands — `npm test` — and you hear what comes\.$/);
  assert.equal(r.folderChecks[0].o.signal.aborted, true, "the close's run is t1's check");
  await tick();
  const close = r.folderChecks.at(-1);
  assert.deepEqual([close?.commands, close?.o.all, close?.o.id], [["npm test"], true, "check-close"]);
  assert.ok(r.runner.owes("c1"));
  const before = r.told.length;
  close?.done(RAN([RUN("npm test", 0)]));
  await tick();
  assert.equal(r.told.length, before + 1, "the cut check of t1 is not told: the close's run is");
  assert.equal(r.told.at(-1).text, tg.closeChecksText(r.graph(), "agent"));
  assert.deepEqual([r.graph().closed.checks.ran, task(r.graph(), "t1").verdict.kind], [true, "passed"]);
  assert.equal(r.runner.owes("c1"), null);
});

// (fails before: yes — the owner's of 11-06: a check's verdict was told with the chat's next message alone, and a coding
// agent's turn holds for none of its graph's checks, so a chat whose turn ended as `npm test` ran sat idle, its next task
// ready, until the person came back hours later; a background command's end wakes the chat)
test("a check's verdict wakes the chat once its turn has ended — passed, flaky or failed — as a background command's end does; a close's run wakes it where a check fails", async () => {
  for (const [first, exit, kind] of /** @type {const} */ ([[null, 0, "passed"], [{ exit: 1, ms: 3000 }, 0, "flaky"], [{ exit: 1, ms: 3000 }, 1, "failed"]])) {
    const r = rig();
    ok(r.runner.apply("c1", OWN, AGENT));
    r.runner.attach("c1", TURN);
    ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
    r.runner.detach("c1", TURN.runId);
    r.folderChecks[0].done(RAN([RUN("npm test", exit, first ? { first } : {})]));
    await tick();
    assert.equal(task(r.graph(), "t1").verdict.kind, kind);
    const told = r.told.find((d) => d.task === "t1");
    assert.equal(told?.text, tg.endText(r.graph(), "t1", { crew: "agent" }), kind);
    assert.equal(told?.wakes, true, `${kind}: it wakes the chat`);
  }
  for (const [exit, wakes] of /** @type {const} */ ([[0, undefined], [1, true]])) {
    const r = rig();
    ok(r.runner.apply("c1", OWN, AGENT));
    r.runner.attach("c1", TURN);
    ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
    ok(r.runner.apply("c1", { action: "close", reason: "shipped" }, AGENT));
    r.runner.detach("c1", TURN.runId);
    await tick();
    r.folderChecks.at(-1)?.done(RAN([RUN("npm test", exit)]));
    await tick();
    assert.equal(r.told.at(-1).text, tg.closeChecksText(r.graph(), "agent"));
    assert.equal(r.told.at(-1).wakes, wakes, exit ? "a check broken since wakes the chat" : "all passed: told with the next message");
  }
});

// (fails before: yes — the owner's of 11-06: the chat read as idle while its check ran)
test("the runner counts the checks it runs for a session, and says each one's end, so the chat's stretch is weighed again", async () => {
  const r = rig();
  /** @type {string[]} */
  const ended = [];
  const runner = r.make({ onCheckEnd: (/** @type {string} */ c) => ended.push(c) });
  ok(runner.apply("c1", OWN, AGENT));
  runner.attach("c1", TURN);
  assert.equal(runner.checking("c1"), 0);
  ok(runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
  assert.equal(runner.checking("c1"), 1, "one check running");
  runner.detach("c1", TURN.runId);
  r.folderChecks[0].done(RAN([RUN("npm test", 0)]));
  await tick();
  assert.deepEqual([runner.checking("c1"), ended], [0, ["c1"]]);
});

// (fails before: yes — a restart cut no check)
test("Filament starting tells a check a restart cut", () => {
  const r = rig();
  ok(r.runner.apply("c1", OWN, AGENT));
  ok(r.runner.apply("c1", { action: "done", id: "t1", summary: "Fixed" }, AGENT));
  const fresh = r.make();
  assert.equal(fresh.reconcile(), 1);
  assert.match(r.told.at(-1).text, /a Filament restart cut its check\. It is done, unchecked\./);
});

// ---- the registry: a check of the folder, for real -----------------------------------------------------------------

/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
const PARSE = "exports.parse = (s) => s.split(',');\n";
const FIXED = "exports.parse = (s) => (s ? s.split(',') : []);\n";
const CHECK_JS = "const { parse } = require('./parse.js');\nrequire('fs').writeFileSync('out.txt', 'x');\nconst n = parse('').length;\nconsole.log(n === 0 ? 'ok' : 'FAIL: ' + n);\nprocess.exit(n === 0 ? 0 : 1);\n";
/** A repository with the parser and its check committed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-checked-"));
  made.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "parse.js"), PARSE);
  writeFileSync(join(dir, "check.js"), CHECK_JS);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
};
/**
 * The checks' copies in a repository's home. A spare made ahead is none of them: a checkout that took 5 s or more, as a
 * busy machine's may, has one made for the next taker (HarnessV4_Worktrees_Plan W5, worktree.js's SPARE_AFTER_MS).
 * @param {string} dir
 */
const checksCopies = (dir) => copiesOf(dir).filter(([name]) => !name.startsWith("spare-"));
/**
 * A registry over `dir`: its session's settings `doc`, each run of a worker scripted by `runs` and finished with its
 * task report, its check run for real or as `checks` scripts it, and each graph task's end kept (`ends`).
 * @param {string} dir @param {{ own?: boolean }} [o]
 */
const registryOver = (dir, { own = true } = {}) => {
  /** @type {any[]} */
  const ends = [];
  /** @type {{ command: string, root: string }[]} */
  const ran = [];
  /** @type {((command: string) => any)[]} */
  const checks = [];
  /** @type {((o: { host: any, body: any }) => any)[]} */
  const runs = [];
  /** @type {any[]} */
  const posts = [];
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: /** @type {any[]} */ ([]) } };
  /** @type {ReturnType<typeof createSubagentRegistry>} */
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    ...(own
      ? {}
      : {
          runCheck: async (/** @type {string} */ command, /** @type {{ root: string }} */ { root }) => {
            ran.push({ command, root });
            const next = checks.shift();
            return next ? next(command) : { exit: 0, output: "ok", stopped: false };
          },
        }),
    context: {
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: (/** @type {any} */ e) => ends.push(e),
    },
    call: async ({ body, headers = {} }) => {
      const id = String(headers["x-filament-subagent"]);
      const host = registry.hostOf(id);
      posts.push({ body, host });
      const runId = `run-${posts.length}`;
      registry.attach(id, runId);
      const script = runs.shift() || (() => ({}));
      const end = (await script({ host, body })) || {};
      registry.finish(id, { status: end.status || "done", error: null, report: "Reported.", stoppedBy: null, convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Reported." }] }], rounds: 1, toolCalls: 2, tokensIn: 1, tokensOut: 1, spentUsd: 0.01, roundIds: [runId], taskReport: end.taskReport === undefined ? { status: "done", did: "Fixed it.", met: true, evidence: "the check passed", left: "" } : end.taskReport });
      return { ok: true, status: 200, json: { content: [{ type: "text", text: "Reported." }] }, id: runId, upstream: "m", retryAfter: null, shouldRetry: null };
    },
  });
  return { registry, ends, ran, checks, runs, posts, doc };
};

// (fails before: yes — the registry had no check of the folder of its own)
test("a check of the folder runs in a worktree of a snapshot — uncommitted work in it, nothing written back — stops at the first red unless all are asked, and runs a red one once more", async () => {
  const dir = repo();
  writeFileSync(join(dir, "parse.js"), FIXED);
  const r = registryOver(dir);
  const green = /** @type {any} */ (await r.registry.checkFolder("c1", ["node check.js"], { id: "check-t1" }));
  assert.deepEqual([green.ran, green.runs.map((/** @type {any} */ x) => [x.command, x.exit, x.first]), green.stopped], [true, [["node check.js", 0, null]], false]);
  assert.equal(existsSync(join(dir, "out.txt")), false, "what the check wrote stays in its copy");
  assert.deepEqual(checksCopies(dir), [["check-t1-c1", "free"]], "its copy is given back free, for the next check");
  writeFileSync(join(dir, "parse.js"), PARSE);
  const red = /** @type {any} */ (await r.registry.checkFolder("c1", ["node check.js", "echo after"], { id: "check-t1" }));
  assert.deepEqual(red.runs.map((/** @type {any} */ x) => [x.command, x.exit, x.first?.exit, x.output]), [["node check.js", 1, 1, "FAIL: 1"]], "red twice, and what follows is not run");
  const all = /** @type {any} */ (await r.registry.checkFolder("c1", ["node check.js", "echo after"], { id: "check-close", all: true }));
  assert.deepEqual(all.runs.map((/** @type {any} */ x) => [x.command, x.exit]), [["node check.js", 1], ["echo after", 0]]);
  assert.equal(git(dir, "status", "--porcelain"), "", "the folder is as it was: nothing the checks wrote reached it");
  // (fails before: yes — HarnessV4_Worktrees_Plan W3: each check checked the project out anew)
  assert.deepEqual(checksCopies(dir), [["check-close-c1", "free"]], "one copy for all three: its own place's again, then moved to the next check's");
});

// (fails before: yes — nothing ran twice)
test("a red command that passes on its second run is flaky: both runs are kept", async () => {
  const dir = repo();
  const r = registryOver(dir, { own: false });
  r.checks.push(() => ({ exit: 1, output: "timing out", stopped: false }), () => ({ exit: 0, output: "ok", stopped: false }));
  const fl = /** @type {any} */ (await r.registry.checkFolder("c1", ["npm test"], { id: "check-t1" }));
  assert.deepEqual(fl.runs.map((/** @type {any} */ x) => [x.exit, x.first?.exit, x.output]), [[0, 1, "ok"]]);
  assert.equal(r.ran[0].root, r.ran[1].root, "the second run is in the same copy");
  assert.notEqual(r.ran[0].root, dir);
});

// (fails before: yes — case 10: nothing said why no check ran)
test("no check of the folder runs outside git, in a read-only session, or where a rule came since — each said", async () => {
  const plain = mkdtempSync(join(tmpdir(), "filament-checked-plain-"));
  made.push(plain);
  assert.deepEqual(await registryOver(plain).registry.checkFolder("c1", ["npm test"], { id: "check-t1" }), { ran: false, words: "this folder is not in git, so Filament has no copy of it to run the check in" });
  const dir = repo();
  const r = registryOver(dir);
  r.doc.loop.permissions = "read-only";
  assert.deepEqual(await r.registry.checkFolder("c1", ["npm test"], { id: "check-t1" }), { ran: false, words: "the session is read-only, so Filament runs no check in it" });
  r.doc.loop.permissions = "edit";
  r.doc.loop.rules = [{ tool: "bash", pattern: "npm test", verdict: "deny" }];
  const ruled = /** @type {any} */ (await r.registry.checkFolder("c1", ["npm test"], { id: "check-t1" }));
  assert.equal(ruled.ran, false);
  assert.match(ruled.words, /^this session's rule .+ refuses `npm test`$/);
});

// (fails before: yes — no vetting of a graph task's check)
test("the registry vets a graph task's check as a brief's: an install, parts that hide a failure, a rule, the folder, a read-only session", () => {
  const dir = repo();
  const r = registryOver(dir);
  assert.equal(r.registry.checkProblem("c1", ["npm test"]), null);
  assert.match(String(r.registry.checkProblem("c1", ["npm ci"])), /^check's `npm ci` installs packages/);
  assert.match(String(r.registry.checkProblem("c1", ["npm test; echo ok"])), /^check's `npm test; echo ok` joins its parts with ;/);
  assert.match(String(r.registry.checkProblem("c1", [`node ${join(dir, "check.js")}`])), /names your folder/);
  r.doc.loop.rules = [{ tool: "bash", pattern: "npm test", verdict: "ask" }];
  assert.match(String(r.registry.checkProblem("c1", ["npm test"])), /^check's `npm test` asks first by this session's rule .+, which a check does not lift: leave it out$/);
  r.doc.loop.rules = [];
  r.doc.loop.permissions = "read-only";
  assert.equal(r.registry.checkProblem("c1", ["npm test"]), "this session is read-only, so Filament runs no check in it: leave check out");
});

/** A graph task's worker over `dir`, with a check: launched as the runner launches one. @param {ReturnType<typeof registryOver>} r @param {string} dir */
const graphWorker = (r, dir) =>
  r.registry.launch({ origin: "agent", chainId: "c1", prompt: "THE BRIEF OF t3", description: "t3: Fix the parser", worker: "builder", background: true, cwd: dir, mode: null, parentModel: "m", thinking: null, task: { id: "t3", review: false }, requestId: "turn-1", files: { writes: ["parse.js"] }, grants: { check: ["node check.js"], mayRun: [] } });

// (fails before: yes — Filament ran no check of a graph task's worker: its met went to the graph as said)
test("a graph task's worker that reports done has its check run in its worktree: red goes back to it in the agent's words, twice, and the end carries the verdict and every exchange's spend", async () => {
  const dir = repo();
  // Its check answers as check.js does on the parser it never fixes, each red run twice: six runs of a shell, which a
  // full suite's load stretched past the minute (the check run for real: the tests before and after this one).
  const r = registryOver(dir, { own: false });
  for (let i = 0; i < 6; i++) r.checks.push(() => ({ exit: 1, output: "FAIL: 1", stopped: false }));
  for (let i = 0; i < 3; i++) r.runs.push(() => ({}));
  const l = graphWorker(r, dir);
  assert.equal(l.ok, true, l.ok ? "" : l.error);
  await until(() => r.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.equal(r.posts.length, 3, "two returns, then its end");
  assert.deepEqual(r.ran.map((x) => [x.command, x.root]), Array(6).fill(["node check.js", r.posts[0].host.workdir]), "each in its worktree");
  assert.match(String(r.posts[1].body.messages.at(-1).content.at(-1).text), /^\[Filament: you reported, and Filament ran your task's check in your worktree before the agent heard of it\. It failed:\n\n\$ node check\.js\nexit 1 after \d+ s — the end of its output:\nFAIL: 1\n\nThe agent hears your report once the check passes, or after Filament has sent it back to you twice — this is the first time\. /);
  const end = r.ends[0].task;
  assert.deepEqual([end.check.ran, end.check.bounces, end.check.runs[0].exit, end.check.runs[0].first?.exit], [true, 2, 1, 1]);
  assert.equal(end.spentUsd, 0.03, "the returns' spend is the task's");
  assert.equal(end.toolCalls, 6);
  assert.deepEqual(end.roundIds, ["run-1", "run-2", "run-3"]);
});

// (fails before: yes — the same: nothing ran)
test("a graph task's worker whose check passes ends with it, once; one that reported blocked has none run", async () => {
  const dir = repo();
  const r = registryOver(dir);
  r.runs.push(({ host }) => {
    writeFileSync(join(host.workdir, "parse.js"), FIXED);
    return {};
  });
  const l = graphWorker(r, dir);
  assert.equal(l.ok, true);
  await until(() => r.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.deepEqual([r.posts.length, r.ends[0].task.check.ran, r.ends[0].task.check.runs[0].exit], [1, true, 0]);
  assert.match(String(r.posts[0].body.messages.at(-1).content.map((/** @type {any} */ c) => c.text).join("\n")), /When you report, Filament runs your check — `node check\.js` — in your worktree before the agent hears of it/);
  const r2 = registryOver(dir);
  r2.runs.push(() => ({ taskReport: { status: "blocked", did: "Could not.", met: false, evidence: "none", left: "the spec" } }));
  graphWorker(r2, dir);
  await until(() => r2.ends.length === 1, "the task's end", { timeoutMs: 60_000 });
  assert.equal(r2.ends[0].task.check, null);
});

// ---- case 12: the tool, its words, the prompt's version ------------------------------------------------------------

// (fails before: yes — the tasks tool had no check)
test("every tasks tool has check, its words say it, and the prompt is version 33 or later (34: TG2-D63, 35: V2-3)", () => {
  for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL, CODER_TASKS_TOOL]) {
    const props = /** @type {any} */ (tool.input_schema.properties.tasks).items.properties;
    assert.deepEqual(props.check.type, "array", tool.name);
    assert.equal(props.check.maxItems, 5);
  }
  for (const words of [TOOL_TEXT.tasks, TOOL_TEXT.tasksReads, TOOL_TEXT.leadTasks]) assert.match(words, /check \(one to five commands that prove it done, which Filament runs itself in a copy of the folder/);
  // A coding agent's tool text names check in short (the owner's tool plan of 11-08); its field says one to five.
  assert.match(TOOL_TEXT.coderTasks, /check \(commands Filament runs itself in a copy of the folder once you mark the task done, so done means they passed\)/);
  assert.match(/** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.tasks).items.properties.check.description, /^One to five commands that prove it done; Filament runs them in a copy of the folder/);
  assert.equal(PROMPT_VERSION, 129);
  assert.ok(readFileSync(new URL("../src/core/task-graph.js", import.meta.url), "utf8").includes('"checking"'));
});
