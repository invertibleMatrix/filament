// @ts-check
// HarnessV3-TaskGraph G2: tasks a sub-agent does, in the core alone (core/task-graph.js — pure, nothing runs). Who
// does a task and the brief it needs; Filament's starts and the sub-agent's end — merging, done or failed, its try
// kept — and the agent's answers to a failure; the developer's Stop and a restart's cut; the brief a sub-agent reads,
// its report, and the words the agent hears as a task ends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TASK_CALLS, agentsToStop, applyAsked, applyTasks, briefText, busy, endText, graphView, hold, jobs, launched, launchRefused, mergeNext, readReport, release, restartCut, resumed, resumeRefused, resumeText, runsAs, showText, startedText, taskEnded, taskMerged, taskMergeFailed } from "../src/core/task-graph.js";
import { MEMBERS as LED } from "./helpers/roster.js";

const AT = 1_000;
/** One call that must go through. @param {any} g @param {any} input @param {number} [at] @returns {{ ok: true, graph: any, text: string, changed: boolean }} */
const ok = (g, input, at = AT) => {
  const r = applyTasks(g, input, { at, crew: "agent" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r;
};
/** One call that must be refused: its words, the graph left as it was. @param {any} g @param {any} input */
const no = (g, input) => {
  const before = JSON.stringify(g);
  const r = applyTasks(g, input, { at: AT, crew: "agent" });
  assert.equal(r.ok, false, "refused");
  assert.equal(JSON.stringify(g), before, "the graph is left as it was");
  return r.ok ? "" : r.error;
};
/** @param {string} id @param {string} name @param {string[]} [needs] @param {Record<string, any>} [more] */
const T = (id, name, needs = [], more = {}) => ({ id, name, needs, ...more });
/** A sub-agent's task with a brief of one line each. @param {string} id @param {string[]} needs @param {string[]} writes */
const S = (id, needs, writes) => T(id, id.toUpperCase(), needs, { by: "sub-agent", writes, goal: "It is done", steps: ["Do it"], acceptance: "the check passes" });
/** A graph moved along by these calls, each of which must go through. @param {any} g @param {any[]} calls */
const walk = (g, calls) => calls.reduce((acc, c) => ok(acc, c).graph, g);

/** The parser's graph, the sub-agents' way: an explorer maps it, two sub-agents write the tests and fix the parser
 *  side by side, and the agent updates the docs. */
const subs = () =>
  ok(null, {
    action: "add",
    goal: "Ship the parser",
    tasks: [
      T("t1", "Map the parser", [], { by: "explorer", goal: "Every caller of parse() is known", steps: ["Search for parse(", "List each caller with its line"], acceptance: "each caller is listed with its file and line" }),
      T("t2", "Write the tests", ["t1"], { by: "sub-agent", writes: ["test/parse.test.js"], goal: "Tests cover each caller's input", steps: ["Write a test for each caller's input"], acceptance: "the new tests fail on the old parser" }),
      T("t3", "Fix the parser", ["t1"], { by: "sub-agent", writes: ["src/parse.js"], goal: "parse() takes every caller's input", steps: ["Fix parse()", "Run npm test"], acceptance: "npm test passes" }),
      T("t4", "Update the docs", ["t2", "t3"], { writes: ["docs/"] }),
    ],
  }).graph;

/** A sub-agent's end as the registry hands it over: its run done, its report done with the check passed, nothing
 *  changed. @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (agent, more = {}) => ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "the check passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
/** A task launched as the agent's crew runs it. @param {any} g @param {string} id @param {string} agent @param {number} [at] @returns {any} */
const launch = (g, id, agent, at = AT) => {
  const r = launched(g, id, agent, at, String(runsAs(g.tasks.find((/** @type {any} */ t) => t.id === id), "agent")));
  assert.ok(r, `${id} launches`);
  return r;
};
/** What Filament may start for the graph now — G2's, each a start: the ids. @param {any} g */
const starts = (g) => jobs(g).map((j) => (assert.equal(j.kind, "start"), j.id));
/** The planner's next tasks call lets a held graph go, its stopped tasks' last sub-agents able to go on. @type {{ crew: import("../src/core/task-graph.js").Crew, resumable: import("../src/core/task-graph.js").Resumable }} */
const LET_GO = { crew: "agent", resumable: () => null };
/** @param {any} g @param {string} id @param {any} end @param {number} [at] @returns {{ graph: any, state: string }} */
const ended = (g, id, end, at = AT) => {
  const r = taskEnded(g, id, end, at);
  assert.ok(r, `${id} ends`);
  return r;
};
const MAP_REPORT = { status: "done", did: "Three callers:\n- a.js:3\n- b.js:9", met: true, evidence: "rg 'parse(' lists three", left: "" };
/** The graph once the explorer mapped the parser: t2 and t3 ready. */
const mapped = () => ended(launch(subs(), "t1", "sa-1", 2_000), "t1", END("sa-1", { report: MAP_REPORT, ran: [{ command: "rg parse(", exit: 0 }] }), 5_000).graph;
/** A merge's files, as git counts them. */
const FIX = [{ path: "src/parse.js", added: 12, removed: 3 }];
const FIX_REPORT = { status: "done", did: "parse() takes trailing commas.", met: true, evidence: "npm test: 41 passed", left: "" };
const NOT_MET = { ...FIX_REPORT, did: "Fixed it.", met: false, evidence: "npm test: 2 failed." };
const CHOICES = "Your choices: send it back — tasks start with its id and a note: its sub-agent goes on where it stopped, in its own conversation, or with fresh: true a new one starts from your folder as it stands; take it on yourself — tasks change it to by: you, then start and done; re-plan around it — change, add or drop tasks; or drop it.";
const WAITS3 = 'Its change is not in your folder: it waits in sub-agent sa-3\'s own worktree — call agent with agent_id "sa-3" and apply_changes: true to apply it as it is.';
// A change that did not merge: applied again once its overlap is settled, the developer resolves it from Changes, or it
// starts again on a new sub-agent.
const UNMERGED3 = "It waits in its worker's copy: apply it again once the files it overlaps in the folder are as its change needs them, or the developer resolves it from Changes — their choice for each file that overlaps theirs, or Send back to rebase, which redoes it on the folder as it is now and gives it back to its worker.";
const UNMERGED_CHOICES = "Your choices: leave it to the developer — you hear when it is in your folder, or when its sub-agent goes on with it; start it again — tasks start with its id and a note: a new sub-agent starts from the folder as it stands, the earlier try in its brief; take it on yourself — tasks change it to by: you, then start and done; re-plan around it — change, add or drop tasks; or drop it.";

// (fails before: yes — G1's tasks had no by, goal or steps: every task was the agent's own)
test("who does a task: by, and the brief a sub-agent's task needs — each refused in words naming the task", () => {
  /** @param {any} task */
  const add = (task) => no(null, { action: "add", goal: "g", tasks: [task] });
  const brief = { goal: "Every caller is known", steps: ["Search for parse("], acceptance: "each caller listed" };
  assert.equal(add(T("t1", "Map it", [], { by: "robot" })), "t1: by is who does the task — you, sub-agent, explorer — or command, for a task Filament runs itself");
  assert.equal(add(T("t1", "Map it", [], { goal: 5 })), "t1: goal is text: what must be true when the task is done");
  assert.equal(add(T("t1", "Map it", [], { steps: "Search" })), "t1: steps is a list of what to do, in order — one step per item");
  assert.equal(add(T("t1", "Map it", [], { steps: ["Search", " "] })), "t1: steps is a list of what to do, in order — one step per item");
  assert.equal(add(T("t1", "Map it", [], { steps: Array.from({ length: 21 }, (_, k) => `Step ${k}`) })), "t1: steps holds at most 20 — make them fewer and larger");
  assert.equal(add(T("t1", "Map it", [], { ...brief, by: "explorer", goal: " " })), "t1: an explorer's task needs goal: what must be true when it is done");
  assert.equal(add(T("t1", "Map it", [], { ...brief, by: "explorer", steps: [] })), "t1: an explorer's task needs steps: what to do, in order");
  assert.equal(add(T("t1", "Fix it", [], { goal: "Fixed", steps: ["Fix it"], by: "sub-agent", writes: ["src/a.js"] })), "t1: a sub-agent's task needs acceptance: the check that proves it done");
  assert.equal(add(T("t1", "Fix it", [], { ...brief, by: "sub-agent" })), "t1: a sub-agent's task needs writes: the files it changes, so tasks that run at once stay apart");
  assert.equal(add(T("t1", "Map it", [], { ...brief, by: "explorer", writes: ["src/a.js"] })), "t1: an explorer changes nothing, so it names no writes — give the task to a sub-agent to change files");
  assert.equal(add(T("t1", "Map it", [], { role: "scout" })), `t1: role is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under\nThe call: ${TASK_CALLS.add}`);
  // Every task carries who does it and what its sub-agents did; the graph carries the Stop's hold and its revision.
  const r = ok(null, { action: "add", goal: "Ship the parser", tasks: [T("t1", "Map the parser", [], { by: "explorer", goal: " Every  caller is known ", steps: [" Search for  parse( ", "List each caller"], acceptance: "each caller listed" }), T("t2", "Fix the parser", ["t1"], { writes: ["src/parse.js"] })] }, 5_000);
  const fresh = { check: [], verdict: null, state: "waiting", summary: "", why: "", addedAt: 5_000, startedAt: null, endedAt: null, agent: null, tries: 0, resume: null, failures: null, unreviewed: "", note: "", report: null, earlier: null, merged: null, stopped: false, spentUsd: 0, review: false, ranAs: null, reviews: [], reviewer: null, step: null, overruled: "", gate: null };
  assert.deepEqual(r.graph, {
    version: 1,
    goal: "Ship the parser",
    startedAt: 5_000,
    closed: null,
    held: null,
    rev: 0,
    tasks: [
      { id: "t1", name: "Map the parser", needs: [], writes: [], acceptance: "each caller listed", by: "explorer", goal: "Every caller is known", steps: ["Search for parse(", "List each caller"], ...fresh },
      { id: "t2", name: "Fix the parser", needs: ["t1"], writes: ["src/parse.js"], acceptance: "", by: "you", goal: "", steps: [], ...fresh },
    ],
  });
  assert.equal(r.text, "Added t1, t2. t2 writes files and says no done-when: give it acceptance or a check, so its done can prove it. 0 of 2 done · ready: t1. Critical path still to go: t1 → t2.");
  // (fails before: yes — the G2 drive's brief lost the end of t2's grammar step: a task's goal and each step past a
  // length were cut)
  const whole = ok(null, { action: "add", goal: "g", tasks: [T("t1", "Map", [], { ...brief, by: "explorer", goal: "g".repeat(2000), steps: ["s", "s".repeat(2000)] })] }).graph.tasks[0];
  assert.deepEqual([whole.goal.length, whole.steps[1].length], [2000, 2000]);
  assert.equal(add(T("t1", "Map it", [], { ...brief, by: "explorer", goal: "g".repeat(2001) })), "t1: goal is up to 2,000 characters (this one has 2,001)");
  assert.equal(add(T("t1", "Map it", [], { ...brief, by: "explorer", steps: ["s", "s".repeat(2001)] })), "t1: step 2 is up to 2,000 characters (this one has 2,001)");
  assert.equal(ok(null, { action: "add", goal: "g", tasks: [T("t1", "Map", [], { steps: Array.from({ length: 20 }, (_, k) => `Step ${k}`) })] }).graph.tasks[0].steps.length, 20);
  // A change gives a task to a sub-agent with its brief, to an explorer without its files, or back to the agent.
  const g = r.graph;
  assert.equal(no(g, { action: "change", tasks: [{ id: "t2", by: "sub-agent" }] }), "3 problems, so nothing of this call changed — one call can fix them all:\n- t2: a sub-agent's task needs goal: what must be true when it is done\n- t2: a sub-agent's task needs steps: what to do, in order\n- t2: a sub-agent's task needs acceptance: the check that proves it done");
  const c = ok(g, { action: "change", tasks: [{ id: "t2", by: "sub-agent", goal: "parse() takes every input", steps: ["Fix it"], acceptance: "npm test passes" }] });
  assert.equal(c.text, "Changed t2. 0 of 2 done · ready: t1.");
  assert.deepEqual([c.graph.tasks[1].by, c.graph.tasks[1].goal, c.graph.tasks[1].steps, c.graph.tasks[1].writes], ["sub-agent", "parse() takes every input", ["Fix it"], ["src/parse.js"]]);
  assert.equal(no(c.graph, { action: "change", tasks: [{ id: "t2", by: "explorer" }] }), "t2: an explorer changes nothing, so it names no writes — give the task to a sub-agent to change files");
  assert.deepEqual([ok(c.graph, { action: "change", tasks: [{ id: "t2", by: "explorer", writes: [] }] }).graph.tasks[1].by, ok(c.graph, { action: "change", tasks: [{ id: "t2", by: "you" }] }).graph.tasks[1].by], ["explorer", "you"]);
  assert.equal(no(g, { action: "change", tasks: [{ id: "t1", by: "sub-agent" }] }), "t1: a sub-agent's task needs writes: the files it changes, so tasks that run at once stay apart");
  assert.deepEqual(ok(g, { action: "change", tasks: [{ id: "t2", goal: "Parsed", steps: ["Fix"] }] }).graph.tasks[1].steps, ["Fix"], "the agent's own task may carry a brief, and needs none");
});

// (fails before: yes — each call was refused at its first problem: team_test's lead sent a 13k-character add three
// times, one problem a time — HarnessV3-FailurePoints §8 item 1)
test("a call's checks say every problem at once: each task's fields and keys, its ids, its needs, and each clash", () => {
  const brief = { goal: "Done", steps: ["Do it"], acceptance: "the check passes" };
  // An add: every task of the list, each with all it lacks; a need on a task the call gave, refused or not, is no
  // unknown need; and one given twice.
  assert.equal(
    no(null, { action: "add", goal: "g", tasks: [T("t1", "Map", [], { by: "explorer" }), { name: "no id" }, T("t2", "", ["t1", "t9"], { by: "sub-agent", role: "builder", steps: "Fix", ...{ goal: 5 } }), T("t3", "Fix", ["t2"], { ...brief, by: "sub-agent", writes: ["../out.js", "/abs.js"] }), T("t1", "Again")] }),
    [
      "12 problems, so nothing of this call changed — one call can fix them all:",
      "- t1: an explorer's task needs goal: what must be true when it is done",
      "- t1: an explorer's task needs steps: what to do, in order",
      "- t1: an explorer's task needs acceptance: the check that proves it done",
      "- task 2 of the list: each task needs an id: a short name of your own, like t1 or parser-fix (a letter, then letters, digits, - or _; up to 24 characters)",
      "- t2: role is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under",
      "- t2: name is required: a few words naming the task",
      "- t2: goal is text: what must be true when the task is done",
      "- t2: steps is a list of what to do, in order — one step per item",
      "- t2: a sub-agent's task needs acceptance: the check that proves it done",
      "- t2: a sub-agent's task needs writes: the files it changes, so tasks that run at once stay apart",
      "- t3: writes names files inside the project, relative to its folder — ../out.js, /abs.js are not",
      "- t1 is given twice",
      `The call: ${TASK_CALLS.add}`,
    ].join("\n"),
  );
  // Fields that are fine leave only the needs: each one that is no task, and one on itself.
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "A", ["t1"]), T("t2", "B", ["t8", "t9"])] }), "3 problems, so nothing of this call changed — one call can fix them all:\n- t1 needs itself\n- t2 needs t8, which is no task in the graph\n- t2 needs t9, which is no task in the graph");
  // Each pair of tasks that could write one file at once refuses nothing (g1): where they meet is said.
  assert.ok(
    ok(null, { action: "add", goal: "g", tasks: [S("t1", [], ["src/a.js"]), S("t2", [], ["src/a.js", "src/b.js"]), S("t3", [], ["src/*.js"])] }).text.endsWith(
      // (fails before: yes — FabeleHelper's of 11-10: every two a line) Those that each meet every other over a file, together.
      "\nt1, t2 and t3 all write src/a.js; t2 and t3 both write src/b.js: whichever of each two lands second merges three-way at its apply.",
    ),
  );
  // A change: every task it names, the state each is in, and the fields of the ones it may change.
  const g = subs();
  const running = launch(g, "t1", "sa-1");
  assert.equal(
    no(running, { action: "change", tasks: [{ id: "t1", name: "Map more" }, { id: "t7", name: "X" }, { id: "t2", by: "explorer" }, { id: "t3" }, { id: "t3", name: "Y" }] }),
    "5 problems, so nothing of this call changed — one call can fix them all:\n- t1 is with its sub-agent now — wait for its end, or drop it\n- t7 is no task in the graph\n- t2: an explorer changes nothing, so it names no writes — give the task to a sub-agent to change files\n- change t3 how? Give the fields that change\n- t3 is given twice",
  );
  // A drop: each task it can't drop — a task left needing one it could loses that need instead (11-09).
  const done = walk(null, [{ action: "add", goal: "g", tasks: [T("t1", "A"), T("t2", "B", ["t1"]), T("t3", "C"), T("t4", "D", ["t3"])] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "A." }]);
  assert.equal(no(done, { action: "drop", ids: ["t1", "t3", "t9"], reason: "r" }), "2 problems, so nothing of this call changed — one call can fix them all:\n- t1 is done, so there is nothing to drop\n- t9 is no task in the graph");
  // A key the planner may not give is said once, as no field: none of that field's rules come with it — a coding
  // agent's by is no sub-agent's task, and the agent's review no review.
  /** @param {any} input @param {boolean} solo */
  const refusal = (input, solo) => {
    const r = applyTasks(null, input, { at: AT, crew: "agent", solo });
    return r.ok ? "" : r.error;
  };
  assert.equal(refusal({ action: "add", goal: "g", tasks: [T("a", "A", [], { by: "sub-agent" })] }, true), `a: by is no field of a task — its fields are id, name, needs, writes, acceptance, check, goal, steps, thread, found_by, under\nThe call: ${TASK_CALLS.add}`);
  assert.equal(refusal({ action: "add", goal: "g", tasks: [T("a", "A", [], { by: "robot", goal: 5 })] }, true), `2 problems, so nothing of this call changed — one call can fix them all:\n- a: by is no field of a task — its fields are id, name, needs, writes, acceptance, check, goal, steps, thread, found_by, under\n- a: goal is text: what must be true when the task is done\nThe call: ${TASK_CALLS.add}`);
  assert.equal(refusal({ action: "add", goal: "g", tasks: [T("a", "A", [], { review: "yes" })] }, false), `a: review is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under\nThe call: ${TASK_CALLS.add}`);
  const mine = ok(null, { action: "add", goal: "g", tasks: [T("a", "A")] }).graph;
  const own = applyTasks(mine, { action: "change", tasks: [{ id: "a", name: "B", by: "sub-agent" }] }, { at: AT, crew: "agent", solo: true });
  assert.deepEqual(own, { ok: false, error: `a: by is no field of a task — its fields are id, name, needs, writes, acceptance, check, goal, steps, thread, found_by, under\nThe call: ${TASK_CALLS.change}` });
  // Running, the same: no word that who does it can't change.
  const begun = applyTasks(mine, { action: "start", ids: ["a"] }, { at: AT, crew: "agent", solo: true });
  assert.ok(begun.ok);
  assert.deepEqual(applyTasks(begun.graph, { action: "change", tasks: [{ id: "a", name: "B", by: "sub-agent" }] }, { at: AT, crew: "agent", solo: true }), { ok: false, error: `a: by is no field of a task — its fields are id, name, needs, writes, acceptance, check, goal, steps, thread, found_by, under\nThe call: ${TASK_CALLS.change}` });
});

// (fails before: yes — G1 had no sub-agent's task to refuse a start or a done for)
test("a sub-agent's task is Filament's to start and its report's to end; change by: you takes it on, failed or not", () => {
  const g = subs();
  assert.equal(no(g, { action: "start", id: "t1" }), "t1 is an explorer's task: Filament starts it by itself once its needs are done");
  assert.equal(no(g, { action: "start", ids: ["t3"] }), "t3 is a sub-agent's task: Filament starts it by itself once its needs are done");
  assert.equal(no(g, { action: "done", id: "t1", summary: "Mapped." }), "t1 is an explorer's task: its report ends it — to finish it yourself, change it to by: you");
  const running = launch(g, "t1", "sa-1", 2_000);
  assert.equal(no(running, { action: "start", id: "t1" }), "t1 is running already");
  // At work, it can't change (the bug report of 11-10): the refusal names no change.
  assert.equal(no(running, { action: "done", id: "t1", summary: "Mapped." }), "t1 is an explorer's task: its report ends it — it is with its sub-agent now: wait for its end, or drop it");
  // Taken on before it ran: the agent's own from then on, and what needs it starts by itself once it is done.
  const mine = walk(g, [{ action: "change", tasks: [{ id: "t1", by: "you" }] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Mapped.", evidence: "grep parse( found 3 callers" }]);
  assert.deepEqual([mine.tasks[0].by, mine.tasks[0].state, starts(mine)], ["you", "done", ["t2", "t3"]]);
  // Taken on after its sub-agent failed it: started again, or done straight away.
  const failed = ended(running, "t1", END("sa-1", { report: null }), 3_000).graph;
  const takeOn = ok(failed, { action: "change", tasks: [{ id: "t1", by: "you" }] });
  assert.equal(takeOn.text, "Changed t1. 0 of 4 done · failed: t1.");
  const s = ok(takeOn.graph, { action: "start", id: "t1" }, 4_000);
  assert.equal(s.text, "Started t1: yours, so you do it now. 0 of 4 done · running: t1.");
  assert.deepEqual([s.graph.tasks[0].state, s.graph.tasks[0].why, s.graph.tasks[0].startedAt], ["running", "", 4_000]);
  assert.equal(ok(takeOn.graph, { action: "done", id: "t1", summary: "Mapped it myself.", evidence: "grep parse( found 3 callers" }).text, "Done: t1. Ready now: t2, t3. 1 of 4 done.");
  // A failed task's needs are checked as a waiting one's are.
  const t3Failed = ended(launch(mapped(), "t3", "sa-3"), "t3", END("sa-3", { report: null })).graph;
  const later = walk(t3Failed, [{ action: "add", tasks: [T("t5", "Agree the grammar")] }, { action: "change", tasks: [{ id: "t3", by: "you", needs: ["t1", "t5"] }] }]);
  assert.equal(no(later, { action: "start", id: "t3" }), "t3 can't start yet: it needs t5 (waiting) done first");
  assert.equal(no(later, { action: "done", id: "t3", summary: "x" }), "t3 can't be done yet: it needs t5 (waiting) done first");
});

// (fails before: yes — every done of a sub-agent's task named change with by: you, which change refuses while its
// sub-agent works on it, while its change waits for its apply, and always to a coding agent — the bug report of 11-10)
test("a done of a sub-agent's task names only a way that works: its apply or a mark while its change waits, a task of its own for a coding agent", () => {
  /** A tasks call that must be refused, from a coding agent (`solo`) or the agent: its words. @param {any} g @param {any} input @param {boolean} solo */
  const refusal = (g, input, solo) => {
    const r = applyTasks(g, input, { at: AT, crew: "agent", solo });
    assert.equal(r.ok, false, "refused");
    return r.ok ? "" : r.error;
  };
  const DONE = { action: "done", id: "t3", summary: "Fixed it myself." };
  // Ready: its change waits in its copy for an apply — and a change of it is refused, so the way names none.
  const ready = ended(launch(mapped(), "t3", "sa-3", 5_000), "t3", END("sa-3", { files: FIX, wrote: true }), 6_000);
  assert.equal(ready.state, "yours");
  const waits = 't3 is a sub-agent\'s task: its report ends it — its change waits in sa-3\'s own copy: apply it — agent with agent_id "sa-3" and apply_changes: true — or, where you brought it into your folder yourself, mark it applied — the same with mark_applied: true in apply_changes\' place';
  assert.equal(refusal(ready.graph, DONE, false), waits);
  assert.equal(refusal(ready.graph, DONE, true), waits);
  assert.match(refusal(ready.graph, { action: "change", tasks: [{ id: "t3", by: "you" }] }, false), /^t3's change is ready and waits for its apply — it can't change now/);
  // Failed with its change in its copy: the same.
  const failed = ended(launch(mapped(), "t3", "sa-3", 5_000), "t3", END("sa-3", { files: FIX, wrote: true, report: NOT_MET }), 6_000);
  assert.equal(failed.state, "failed");
  assert.equal(refusal(failed.graph, DONE, true), waits);
  // Waiting with nothing of it to apply: the agent's change takes by: you; a coding agent's takes no by, so it drops it
  // and adds its own.
  const waiting = mapped();
  assert.equal(refusal(waiting, DONE, false), "t3 is a sub-agent's task: its report ends it — to finish it yourself, change it to by: you");
  assert.equal(refusal(waiting, DONE, true), "t3 is a sub-agent's task: its report ends it — to do it yourself, drop it and add a task of your own for the work");
  assert.match(refusal(waiting, { action: "change", tasks: [{ id: "t3", by: "you" }] }, true), /^t3: by is no field of a task/);
});

// (fails before: yes — nothing started a task but the agent's own call)
test("Filament starts what is ready: its jobs in the order tasks may start, launched, and a launch refused", () => {
  assert.deepEqual(starts(null), []);
  const g = subs();
  assert.deepEqual(starts(g), ["t1"], "the explorer is ready; the agent's own task is never Filament's");
  const before = JSON.stringify(g);
  const r = launch(g, "t1", "sa-1", 2_000);
  assert.equal(JSON.stringify(g), before, "the graph it was given is left alone");
  assert.deepEqual(r.tasks[0], { ...g.tasks[0], state: "running", agent: "sa-1", ranAs: "explorer", tries: 1, startedAt: 2_000 });
  assert.deepEqual([starts(r), busy(g), busy(r), busy(null)], [[], false, true, false]);
  assert.equal(launched(r, "t1", "sa-2", 2_100, "explorer"), null, "a running task is not launched again");
  assert.equal(launched(g, "t4", "sa-2", 2_100, "sub-agent"), null, "the agent's own task is never a sub-agent's");
  assert.equal(launched(g, "t9", "sa-2", 2_100, "sub-agent"), null);
  assert.deepEqual(starts(mapped()), ["t2", "t3"]);
  // By depth first, then as added: a deeper task added first starts after a shallower one added later.
  const deep = walk(null, [{ action: "add", goal: "g", tasks: [S("b", ["c"], ["b.js"]), T("c", "C"), S("a", [], ["a.js"])] }, { action: "start", id: "c" }, { action: "done", id: "c", summary: "x" }]);
  assert.deepEqual(starts(deep), ["a", "b"]);
  // A refused launch fails the task in the launch's words; only a waiting task can be refused.
  const refused = launchRefused(g, "t1", "the session runs 4 sub-agents already", 2_000, "explorer");
  assert.deepEqual([refused?.tasks[0].state, refused?.tasks[0].why, refused?.tasks[0].endedAt], ["failed", "Filament could not start its sub-agent: the session runs 4 sub-agents already", 2_000]);
  assert.equal(launchRefused(r, "t1", "x", 2_000, "explorer"), null);
  assert.deepEqual(starts(refused), []);
  assert.equal(busy(walk(g, [{ action: "change", tasks: [{ id: "t1", by: "you" }] }, { action: "start", id: "t1" }])), false, "the agent's own running task is no sub-agent's work");
});

// (fails before: yes — nothing ended a task but the agent's own done)
test("a sub-agent's end moves its task on from what Filament saw: done, or ready, then merging once applied, then merged — its try and its spend kept", () => {
  const g = launch(subs(), "t1", "sa-1", 2_000);
  const e = ended(g, "t1", END("sa-1", { report: MAP_REPORT, ran: [{ command: "rg parse(", exit: 0 }] }), 5_000);
  assert.equal(e.state, "done");
  assert.deepEqual(e.graph.tasks[0], {
    ...g.tasks[0],
    state: "done",
    summary: "Three callers:\n- a.js:3\n- b.js:9",
    endedAt: 5_000,
    spentUsd: 0.25,
    report: { status: "done", did: "Three callers:\n- a.js:3\n- b.js:9", met: true, evidence: "rg 'parse(' lists three", left: "", words: "", files: [], unnamed: [], ran: [{ command: "rg parse(", exit: 0 }], calls: [], callsMade: 0, inFolder: false, written: [], wrote: false, spentUsd: 0.25, ms: 60_000, endedAt: 5_000, provider: null },
  });
  assert.equal(
    endText(e.graph, "t1", { crew: "agent" }),
    ['[Filament: task t1 "Map the parser" is done: sub-agent sa-1 reported it done with its acceptance check passed.', "Did: Three callers:", "- a.js:3", "- b.js:9", "Acceptance: met — rg 'parse(' lists three", "Ran: rg parse( (exit 0)", "Now: 1 of 4 done · ready: t2, t3.]"].join("\n"),
  );
  // A writing sub-agent's change is ready first, waiting in its copy for its apply (the owner's of 11-02): nothing merges
  // it and nothing holds the turn on it; applied, it merges, then is done with what merged.
  const run3 = launch(e.graph, "t3", "sa-3", 6_000);
  const r = ended(run3, "t3", END("sa-3", { report: FIX_REPORT, files: [{ ...FIX[0], status: "modified" }], ran: [{ command: "npm test", exit: 0 }] }), 9_000);
  assert.equal(r.state, "yours");
  assert.deepEqual([r.graph.tasks[2].state, r.graph.tasks[2].step, mergeNext(r.graph), busy(r.graph)], ["merging", "yours", null, false]);
  assert.match(showText(r.graph, "agent"), /\n1 of 4 done · ready to apply: t3 · ready: t2\.\n/);
  const m = /** @type {any} */ (applyAsked(r.graph, "sa-3"));
  assert.equal(m.id, "t3");
  const t3 = m.graph.tasks[2];
  assert.deepEqual([t3.state, t3.step, t3.summary, t3.endedAt, t3.report.files, mergeNext(m.graph), busy(m.graph)], ["merging", null, "", null, FIX, "t3", true]);
  assert.match(showText(m.graph, "agent"), /\n1 of 4 done · merging: t3 · ready: t2\.\n/);
  assert.equal(taskMerged(run3, "t3", FIX, 9_500), null, "only a merging task merges");
  const done3 = /** @type {any} */ (taskMerged(m.graph, "t3", FIX, 9_500));
  assert.deepEqual([done3.tasks[2].state, done3.tasks[2].summary, done3.tasks[2].merged, done3.tasks[2].endedAt, busy(done3)], ["done", "parse() takes trailing commas.", { files: 1, added: 12, removed: 3 }, 9_500, false]);
  assert.equal(
    endText(done3, "t3", { crew: "agent" }),
    ['[Filament: task t3 "Fix the parser" is done: sub-agent sa-3 reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — and its change is merged into your folder.', "Did: parse() takes trailing commas.", "Acceptance: met — npm test: 41 passed", "Files: 1 file (+12 −3): src/parse.js", "Ran: npm test (exit 0)", "Now: 2 of 4 done · ready: t2.]"].join("\n"),
  );
  // Nothing to merge: a change of nothing, or one made in the session's own folder — no repository, so no worktree.
  const run2 = launch(e.graph, "t2", "sa-2", 6_000);
  const plain = ended(run2, "t2", END("sa-2"), 7_000);
  assert.equal(plain.state, "done");
  assert.equal(endText(plain.graph, "t2", { crew: "agent" }), ['[Filament: task t2 "Write the tests" is done: sub-agent sa-2 reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — it changed nothing.', "Did: Did it.", "Acceptance: met — the check passed", "Now: 2 of 4 done · ready: t3.]"].join("\n"));
  const inFolder = ended(run2, "t2", END("sa-2", { shared: true, wrote: true }), 7_000);
  assert.deepEqual([inFolder.state, inFolder.graph.tasks[1].report.inFolder, inFolder.graph.tasks[1].report.wrote, inFolder.graph.tasks[1].merged], ["done", true, true, null]);
  assert.equal(
    endText(inFolder.graph, "t2", { crew: "agent" }),
    ['[Filament: task t2 "Write the tests" is done: sub-agent sa-2 reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — it worked in your folder, so what it changed is there already.', "Did: Did it.", "Acceptance: met — the check passed", "Now: 2 of 4 done · ready: t3.]"].join("\n"),
  );
  assert.match(endText(ended(run2, "t2", END("sa-2", { shared: true })).graph, "t2", { crew: "agent" }), / — it changed nothing\.\n/, "in the folder, its hands changed nothing");
  // An end that is no longer the task's changes nothing.
  assert.equal(taskEnded(run3, "t3", END("sa-9"), 9_000), null, "another sub-agent's end");
  assert.equal(taskEnded(run3, "t2", END("sa-3"), 9_000), null, "a task no sub-agent runs now");
  assert.equal(taskEnded(run3, "t9", END("sa-3"), 9_000), null);
  // What a try keeps: its newest commands, its first files, its last words with their lines.
  const many = ended(run3, "t3", END("sa-3", { report: null, words: "Ran out of ideas.  \n\n\n\nSorry.  ", ran: Array.from({ length: 35 }, (_, k) => ({ command: k === 34 ? `npm   test ${"x".repeat(300)}` : `step ${k}`, exit: k === 33 ? null : 0 })), files: Array.from({ length: 55 }, (_, k) => ({ path: `src/f${k}.js`, added: 1, removed: 0 })) }), 9_000).graph.tasks[2].report;
  assert.deepEqual([many.ran.length, many.ran[0].command, many.ran[28].exit, many.ran[29].command.length, many.ran[29].command.slice(0, 9), many.ran[29].command.at(-1), many.files.length, many.files[49].path, many.words], [30, "step 5", null, 200, "npm test ", "…", 50, "src/f49.js", "Ran out of ideas.\n\nSorry."]);
  assert.equal(ended(run3, "t3", END("sa-3", { report: null, words: "w".repeat(1200) })).graph.tasks[2].report.words.length, 1000);
  // Each try's spend adds to the task's.
  const back = walk(ended(run3, "t3", END("sa-3", { report: null })).graph, [{ action: "start", id: "t3" }]);
  const twice = ended(launch(back, "t3", "sa-4"), "t3", END("sa-4", { spentUsd: 0.125 })).graph;
  assert.deepEqual([twice.tasks[2].spentUsd, twice.tasks[2].tries, graphView(twice)?.spentUsd], [0.375, 2, 0.625]);
});

// (fails before: yes — the same: no task could fail)
test("anything else fails the task, in words that say why — and the agent hears each with its choices", () => {
  const run3 = launch(mapped(), "t3", "sa-3", 6_000);
  /** @param {Record<string, any>} more */
  const why = (more) => {
    const r = ended(run3, "t3", END("sa-3", more), 9_000);
    assert.equal(r.state, "failed");
    assert.equal(r.graph.tasks[2].endedAt, 9_000);
    return r.graph.tasks[2].why;
  };
  assert.equal(why({ cut: true, status: "aborted", error: "the client disconnected" }), "cut by a Filament restart");
  assert.equal(why({ cut: true, status: "stopped", stoppedBy: "harness" }), "cut by a Filament restart", "a restart's stop is no developer's");
  assert.equal(why({ status: "failed", error: "the model call  failed: 529\noverloaded" }), "its run failed (the model call failed: 529 overloaded)");
  assert.equal(why({ status: "aborted" }), "its run was cut off before it finished");
  assert.equal(why({ status: "budget-stopped" }), "its run stopped at a budget");
  // A stop that is nobody's who plans — Filament's own — fails it; the agent's own sets it aside (ag-stop, below).
  assert.equal(why({ status: "stopped", stoppedBy: "filament" }), "its run was stopped");
  assert.equal(why({ status: "paused" }), "its run paused");
  assert.equal(why({ report: null }), "it ended without its report");
  assert.equal(why({ report: { status: "blocked", did: "Read the grammar.", met: false, evidence: "not run", left: "the grammar file is missing" } }), "it reported blocked: the grammar file is missing");
  assert.equal(why({ report: { status: "failed", did: "Tried twice.", met: false, evidence: "npm test: 2 failed", left: "" } }), "it reported failed");
  assert.equal(why({ report: NOT_MET }), "its acceptance check did not pass: npm test: 2 failed.");
  assert.equal(why({ workError: "git add failed" }), "its work could not be captured (git add failed)");
  const notMet = ended(run3, "t3", END("sa-3", { report: NOT_MET, files: FIX, ran: [{ command: "npm test", exit: 1 }] }), 9_000).graph;
  const words = [
    '[Filament: task t3 "Fix the parser" failed: its acceptance check did not pass: npm test: 2 failed.',
    "Did: Fixed it.",
    "Acceptance: not met — npm test: 2 failed.",
    "Files: 1 file (+12 −3): src/parse.js",
    "Ran: npm test (exit 1)",
    WAITS3,
    CHOICES,
    "Now: 1 of 4 done · failed: t3 · ready: t2.]",
  ];
  assert.equal(endText(notMet, "t3", { crew: "agent" }), words.join("\n"));
  const inFolder = ended(run3, "t3", END("sa-3", { report: null, words: "I gave up.", shared: true, wrote: true }), 9_000).graph;
  assert.equal(endText(inFolder, "t3", { crew: "agent" }), ['[Filament: task t3 "Fix the parser" failed: it ended without its report.', "Its last words: I gave up.", "It worked in your folder, so what it changed is there already — check it before you go on.", CHOICES, "Now: 1 of 4 done · failed: t3 · ready: t2.]"].join("\n"));
  assert.equal(endText(ended(run3, "t3", END("sa-3", { report: null, words: "I gave up.", shared: true }), 9_000).graph, "t3", { crew: "agent" }).split("\n")[2], CHOICES, "in the folder, its hands changed nothing");
  // A merge that fails: the change waits in its worktree, as the words say.
  const m = /** @type {any} */ (applyAsked(ended(run3, "t3", END("sa-3", { report: FIX_REPORT, files: FIX }), 9_000).graph, "sa-3")).graph;
  assert.equal(taskMergeFailed(run3, "t3", "x", 9_500), null, "only a merging task's merge fails");
  const mf = /** @type {any} */ (taskMergeFailed(m, "t3", "src/parse.js changed in your folder too, and the changes overlap", 9_500));
  assert.deepEqual([mf.tasks[2].state, mf.tasks[2].why, mf.tasks[2].endedAt, mf.tasks[2].merged, busy(mf)], ["failed", "its change did not merge: src/parse.js changed in your folder too, and the changes overlap", 9_500, null, false]);
  assert.equal(
    endText(mf, "t3", { crew: "agent" }),
    ['[Filament: task t3 "Fix the parser" failed: its change did not merge: src/parse.js changed in your folder too, and the changes overlap.', "Did: parse() takes trailing commas.", "Acceptance: met — npm test: 41 passed", "Files: 1 file (+12 −3): src/parse.js", UNMERGED3, UNMERGED_CHOICES, "Now: 1 of 4 done · failed: t3 · ready: t2.]"].join("\n"),
  );
  // A launch refused: no try to tell of.
  const refused = /** @type {any} */ (launchRefused(mapped(), "t3", "the session runs 4 sub-agents already", 6_000, "sub-agent"));
  assert.equal(endText(refused, "t3", { crew: "agent" }), ['[Filament: task t3 "Fix the parser" failed: Filament could not start its sub-agent: the session runs 4 sub-agents already.', CHOICES, "Now: 1 of 4 done · failed: t3 · ready: t2.]"].join("\n"));
  // (fails before: yes — f5's follow-up of 11-10: a coding agent, whose change takes no by, was offered by: you)
  const take = "take it on yourself — drop it and add a task of your own for the work; ";
  assert.equal(endText(refused, "t3", { crew: "agent", solo: true }).split("\n")[1], CHOICES.replace("take it on yourself — tasks change it to by: you, then start and done; ", take), "a coding agent's: a task of its own");
  assert.equal(endText(mf, "t3", { crew: "agent", solo: true }).split("\n")[5], UNMERGED_CHOICES.replace("take it on yourself — tasks change it to by: you, then start and done; ", take));
  assert.doesNotMatch(endText(notMet, "t3", { crew: "agent", solo: true }), /by: you/);
});

// (fails before: yes — the same: nothing sent a task back, nor let a sub-agent go. And HarnessV3-FailurePoints §6
// item 2: a send-back went to a new sub-agent, its last one's work lost but for its report — now it goes on with it)
test("the agent's answers: a failed task sent back with a note; a drop or a close lets its sub-agent go; nothing changes under a merge", () => {
  const run3 = launch(mapped(), "t3", "sa-3", 6_000);
  const failed = ended(run3, "t3", END("sa-3", { report: NOT_MET, files: FIX }), 9_000).graph;
  const back = ok(failed, { action: "start", id: "t3", note: " Run  the whole suite, not one file. " }, 10_000);
  assert.equal(back.text, "Sent t3 back: sub-agent sa-3 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads what failed and your note. 1 of 4 done · ready: t2, t3.");
  assert.deepEqual(back.graph.tasks[2], { ...failed.tasks[2], state: "waiting", report: null, why: "", note: "Run the whole suite, not one file.", resume: "sa-3", startedAt: null, endedAt: null, earlier: { agent: "sa-3", ranAs: "sub-agent", report: failed.tasks[2].report, why: "its acceptance check did not pass: npm test: 2 failed.", reviews: [] } });
  assert.deepEqual(jobs(back.graph), [{ id: "t2", kind: "start" }, { id: "t3", kind: "resume" }]);
  const again = /** @type {any} */ (resumed(back.graph, "t3", 11_000));
  assert.deepEqual([again.tasks[2].state, again.tasks[2].agent, again.tasks[2].tries, again.tasks[2].resume, again.tasks[2].note, again.tasks[2].earlier?.agent, again.tasks[2].startedAt], ["running", "sa-3", 2, null, "Run the whole suite, not one file.", "sa-3", 11_000]);
  assert.equal(startedText(again, ["t3"]), "Filament started t3 again on its sub-agent sa-3, in its own conversation. Now: 1 of 4 done · running: t3 · ready: t2.");
  // Fresh: a new sub-agent, as before.
  const anew = ok(failed, { action: "start", id: "t3", note: "Run the whole suite.", fresh: true }, 10_000);
  assert.equal(anew.text, "Sent t3 back: a new sub-agent takes it once its needs are done and a slot is free, with the earlier try and your note in its brief. 1 of 4 done · ready: t2, t3.");
  assert.deepEqual(starts(anew.graph), ["t2", "t3"]);
  const other = launch(anew.graph, "t3", "sa-4", 11_000);
  assert.deepEqual([other.tasks[2].agent, other.tasks[2].tries, other.tasks[2].note, other.tasks[2].earlier?.agent], ["sa-4", 2, "Run the whole suite.", "sa-3"]);
  assert.equal(startedText(other, ["t3"]), "Filament started t3 on a sub-agent (sa-4). Now: 1 of 4 done · running: t3 · ready: t2.");
  assert.equal(ok(failed, { action: "start", id: "t3" }).text, "Sent t3 back: sub-agent sa-3 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads what failed. 1 of 4 done · ready: t2, t3.");
  const withMine = walk(failed, [{ action: "add", tasks: [T("t5", "Lint")] }]);
  assert.equal(ok(withMine, { action: "start", ids: ["t5", "t3"], fresh: true }).text, "Started t5: yours, so you do it now. Sent t3 back: a new sub-agent takes it once its needs are done and a slot is free, with the earlier try in its brief. 1 of 5 done · running: t5 · ready: t2, t3.");
  assert.equal(ok(failed, { action: "change", tasks: [{ id: "t3", steps: ["Fix parse()", "Run the whole suite"] }] }).text, "Changed t3. 1 of 4 done · failed: t3 · ready: t2.", "a failed task may change before it goes back");
  // A ready change may not change, and may be dropped — it stays in its copy (the owner's of 11-02).
  const ready = ended(run3, "t3", END("sa-3", { report: FIX_REPORT, files: FIX }), 9_000).graph;
  assert.equal(no(ready, { action: "change", tasks: [{ id: "t3", name: "x" }] }), "t3's change is ready and waits for its apply — it can't change now: apply it, send it back with a note (tasks start with its id and note), or drop it");
  assert.equal(ok(ready, { action: "drop", ids: ["t3", "t4"], reason: "x" }).graph.tasks[2].state, "dropped");
  // Under a merge — its apply under way — nothing changes; a running sub-agent's task may only be dropped.
  const merging = /** @type {any} */ (applyAsked(ready, "sa-3")).graph;
  const both = launch(merging, "t2", "sa-2", 9_100);
  assert.equal(no(both, { action: "change", tasks: [{ id: "t3", name: "x" }] }), "t3 is merging into the folder — it can't change now");
  assert.equal(no(both, { action: "change", tasks: [{ id: "t2", name: "x" }] }), "t2 is with its sub-agent now — wait for its end, or drop it");
  assert.equal(no(both, { action: "drop", ids: ["t3"], reason: "x" }), "t3 is merging into the folder — it can't be dropped now");
  assert.equal(no(both, { action: "close", reason: "x" }), "t3 is merging into the folder — close the graph once it is done");
  assert.equal(no(both, { action: "start", id: "t3" }), "t3 is merging already");
  const dropped = ok(both, { action: "drop", ids: ["t2", "t4"], reason: "the tests exist" });
  assert.deepEqual([agentsToStop(both, dropped.graph), agentsToStop(both, both), agentsToStop(null, dropped.graph), agentsToStop(both, null)], [["sa-2"], [], [], []]);
  assert.deepEqual(agentsToStop(run3, ok(run3, { action: "close", reason: "enough" }).graph), ["sa-3"]);
  // The agent's own running task has no sub-agent to stop; handed to one, it waits for it (g1, the owner's of 11-09).
  const mine = walk(subs(), [{ action: "change", tasks: [{ id: "t1", by: "you" }] }, { action: "start", id: "t1" }]);
  assert.match(ok(mine, { action: "change", tasks: [{ id: "t1", by: "explorer" }] }).text, /^Changed t1\. t1 was running, and is an explorer's task now: it waits, and Filament starts it once its needs are done\. /);
  assert.equal(ok(mine, { action: "change", tasks: [{ id: "t1", by: "you", name: "Map it all" }] }).graph.tasks[0].name, "Map it all");
  assert.deepEqual(agentsToStop(mine, ok(mine, { action: "drop", ids: ["t1", "t2", "t3", "t4"], reason: "x" }).graph), []);
});

// (fails before: yes — the same: nothing held a graph, nor cut one)
test("the developer's Stop: the task waits again with its try, the graph held until the agent's next tasks call; a restart fails what it cut", () => {
  const run3 = launch(mapped(), "t3", "sa-3", 6_000);
  const st = ended(run3, "t3", END("sa-3", { status: "stopped", stoppedBy: "harness", report: null, words: "I was fixing parse().", files: [{ path: "src/parse.js", added: 2, removed: 1 }] }), 9_000);
  assert.equal(st.state, "stopped");
  assert.deepEqual(st.graph.tasks[2], {
    ...run3.tasks[2],
    state: "waiting",
    stopped: "developer",
    startedAt: null,
    spentUsd: 0.25,
    report: null,
    earlier: { agent: "sa-3", ranAs: "sub-agent", reviews: [], why: "stopped by the developer", stopped: "developer", report: { status: null, did: "", met: null, evidence: "", left: "", words: "I was fixing parse().", files: [{ path: "src/parse.js", added: 2, removed: 1 }], unnamed: [], ran: [], calls: [], callsMade: 0, inFolder: false, written: [], wrote: false, spentUsd: 0.25, ms: 60_000, endedAt: 9_000, provider: null } },
  });
  assert.deepEqual(starts(st.graph), ["t2"], "a stopped task waits for the agent's next tasks call");
  const words = [
    '[Filament: the developer stopped sub-agent sa-3 on task t3 "Fix the parser". The task waits again: after your next tasks call sa-3 goes on with it where it stopped, in its own conversation — or a new sub-agent takes it, with what this one did in its brief: tasks start with its id and fresh: true.',
    "Its last words: I was fixing parse().",
    "Files: 1 file (+2 −1): src/parse.js",
    WAITS3,
    "Now: 1 of 4 done · stopped: t3 · ready: t2.]",
  ];
  assert.equal(endText(st.graph, "t3", { crew: "agent" }), words.join("\n"));
  assert.match(showText(st.graph, "agent"), /\n- t3 "Fix the parser" — stopped by the developer · by sub-agent · needs t1 · writes src\/parse\.js\n/);
  // The hold: nothing of the graph's starts until the agent's next tasks call releases it, and the stopped tasks.
  const h = hold(st.graph, 9_000);
  assert.deepEqual([h.held, st.graph.held, starts(h), graphView(h)?.held], [{ at: 9_000 }, null, [], { at: 9_000 }]);
  assert.match(showText(h, "agent"), /\nHeld since the developer's stop: Filament starts no sub-agent's task until your next tasks call\.\n/);
  const rel = /** @type {any} */ (release(h, LET_GO));
  assert.deepEqual([rel.held, rel.tasks[2].stopped, jobs(rel).map((j) => j.id), h.tasks[2].stopped], [null, false, ["t2", "t3"], "developer"]);
  assert.equal(release(run3, LET_GO), run3, "nothing held: the graph itself");
  assert.equal(release(null, LET_GO), null);
  // (fails before: yes — B4, decision 4: a stopped task let go always went to a new sub-agent, its last one's
  // conversation and worktree left behind)
  assert.deepEqual([rel.tasks[2].resume, jobs(rel).find((j) => j.id === "t3"), h.tasks[2].resume], ["sa-3", { id: "t3", kind: "resume" }, null], "its last sub-agent goes on with it");
  assert.match(showText(rel, "agent"), /\n- t3 "Fix the parser" — ready — sa-3 goes on with it · by sub-agent · needs t1 · writes src\/parse\.js\n/);
  /** @type {string[]} */
  const asked = [];
  const cant = /** @type {any} */ (release(h, { crew: "agent", resumable: (a) => (asked.push(a), "Filament restarted since it ran, and its conversation went with it") }));
  assert.deepEqual([asked, cant.tasks[2].resume, jobs(cant).find((j) => j.id === "t3")], [["sa-3"], null, { id: "t3", kind: "start" }], "where it can't, a new one takes it");
  assert.equal(/** @type {any} */ (release(h, { crew: LED, resumable: () => null })).tasks[2].resume, null, "under a lead the task is a team's worker's: no sub-agent of the agent's goes on with it");
  // (fails before: no — a guard the mutation pass asked for: the developer stopped one sub-agent from its row, which
  // holds no graph — the agent's next tasks call lets its task go all the same)
  const one = /** @type {any} */ (release(st.graph, LET_GO));
  assert.deepEqual([one.held, one.tasks[2].stopped, jobs(one).map((j) => j.id), st.graph.tasks[2].stopped], [null, false, ["t2", "t3"], "developer"]);
  // A restart fails what ran or merged; nothing starts it again by itself. A change ready for its apply waits on through
  // it, in its copy (the owner's of 11-02).
  const ready = ended(launch(launch(mapped(), "t2", "sa-2", 6_000), "t3", "sa-3", 6_000), "t3", END("sa-3", { report: FIX_REPORT, files: FIX }), 9_000).graph;
  const kept = restartCut(ready, 20_000);
  assert.deepEqual([kept?.ids, kept?.graph.tasks[2].state, kept?.graph.tasks[2].step], [["t2"], "merging", "yours"]);
  const merging = /** @type {any} */ (applyAsked(ready, "sa-3")).graph;
  const cut = restartCut(merging, 20_000);
  assert.deepEqual(cut?.ids, ["t2", "t3"]);
  assert.deepEqual(
    cut?.graph.tasks.slice(1, 3).map((/** @type {any} */ t) => [t.state, t.why, t.endedAt]),
    [["failed", "cut by a Filament restart", 20_000], ["failed", "cut by a Filament restart as its change merged — check its files in the folder before you go on", 20_000]],
  );
  assert.deepEqual([starts(cut?.graph ?? null), busy(cut?.graph ?? null), merging.tasks[1].state], [[], false, "running"]);
  assert.equal(restartCut(subs(), 20_000), null);
  assert.equal(restartCut(walk(subs(), [{ action: "change", tasks: [{ id: "t1", by: "you" }] }, { action: "start", id: "t1" }]), 20_000), null, "the agent's own running task is the agent's");
  // Merges of applied changes go one at a time, the first in the order tasks may start; a ready one merges only once applied.
  const two = walk(null, [{ action: "add", goal: "g", tasks: [S("x", ["w"], ["x.js"]), T("w", "W"), S("y", [], ["y.js"])] }, { action: "start", id: "w" }, { action: "done", id: "w", summary: "ok" }]);
  const xReady = ended(launch(launch(two, "x", "sa-x"), "y", "sa-y"), "x", END("sa-x", { files: [{ path: "x.js", added: 1, removed: 0 }] })).graph;
  const xEnded = /** @type {any} */ (applyAsked(xReady, "sa-x")).graph;
  const xy = /** @type {any} */ (applyAsked(ended(xEnded, "y", END("sa-y", { files: [{ path: "y.js", added: 1, removed: 0 }] })).graph, "sa-y")).graph;
  assert.deepEqual([mergeNext(xReady), mergeNext(xEnded), mergeNext(xy), mergeNext(null), mergeNext(subs())], [null, "x", "y", null, null]);
});

// (fails before: yes — ag-stop, the owner's of 11-11: a stop in the agent's name failed the task — "its run was
// stopped", with a failed task's choices — where the developer's Stop set it aside)
test("the agent's own stop of a task's sub-agent sets the task aside as the developer's does: it waits, its try kept, said as the agent's stop — to the planner as its own, to its sub-agent as the agent's — through a save and a load", () => {
  const run3 = launch(mapped(), "t3", "sa-3", 6_000);
  const st = ended(run3, "t3", END("sa-3", { status: "stopped", stoppedBy: "agent", report: null, words: "I was fixing parse().", files: [{ path: "src/parse.js", added: 2, removed: 1 }] }), 9_000);
  assert.equal(st.state, "stopped");
  const t3 = st.graph.tasks[2];
  assert.deepEqual([t3.state, t3.stopped, t3.why, t3.failures, t3.report, t3.earlier.agent, t3.earlier.why, t3.earlier.stopped], ["waiting", "agent", "", null, null, "sa-3", "stopped by the agent", "agent"]);
  assert.deepEqual(starts(st.graph), ["t2"], "set aside: it waits for the agent's next tasks call");
  const words = [
    '[Filament: you stopped sub-agent sa-3 on task t3 "Fix the parser". The task waits again: after your next tasks call sa-3 goes on with it where it stopped, in its own conversation — or a new sub-agent takes it, with what this one did in its brief: tasks start with its id and fresh: true.',
    "Its last words: I was fixing parse().",
    "Files: 1 file (+2 −1): src/parse.js",
    WAITS3,
    "Now: 1 of 4 done · stopped: t3 · ready: t2.]",
  ];
  assert.equal(endText(st.graph, "t3", { crew: "agent" }), words.join("\n"));
  assert.match(showText(st.graph, "agent"), /\n- t3 "Fix the parser" — stopped by the agent · by sub-agent · needs t1 · writes src\/parse\.js\n/);
  // Kept and read again, as the archive keeps a graph: whose stop it was is the agent's still, never the developer's.
  const kept = JSON.parse(JSON.stringify(st.graph));
  assert.deepEqual([kept.tasks[2].stopped, kept.tasks[2].earlier.stopped, graphView(kept)?.tasks[2].stopped, restartCut(kept, 20_000)], ["agent", "agent", "agent", null]);
  assert.equal(endText(kept, "t3", { crew: "agent" }), words.join("\n"));
  // The agent's next tasks call lets it go: its sub-agent goes on, told whose stop it was; a new one reads the same.
  const rel = /** @type {any} */ (release(kept, LET_GO));
  assert.deepEqual([rel.tasks[2].stopped, rel.tasks[2].resume, jobs(rel).find((j) => j.id === "t3")], [false, "sa-3", { id: "t3", kind: "resume" }]);
  assert.match(resumeText(rel, "t3", "agent"), /^\[Filament: the agent stopped you on task t3\. The task is yours again: go on from where you stopped — your work so far is above\./);
  assert.ok(briefText(kept, "t3", "agent").includes("An earlier try at this task ended: stopped by the agent.\nIts last words: I was fixing parse()."), briefText(kept, "t3", "agent"));
});

// (fails before: yes — no brief was written from a graph)
// (fails before: yes — a graph started after a closed one began its revision at 0 again, so a page that drew the closed
// one never drew the new one)
test("a graph started after a closed one carries the session's revision on", () => {
  const closed = { ...ok(subs(), { action: "close", reason: "shipped" }).graph, rev: 7 };
  assert.equal(ok(closed, { action: "add", goal: "Next", tasks: [T("t1", "Do it")] }).graph.rev, 7);
  assert.equal(ok(null, { action: "add", goal: "First", tasks: [T("t1", "Do it")] }).graph.rev, 0);
});

test("the brief a sub-agent reads: the work, its task, its files, its steps and check, what its needs reported, an earlier try and the agent's note", () => {
  const HEAD = "You do one task of a larger piece of work, which the agent you work for planned as a task graph. Work on this task alone.\n\nThe work: Ship the parser";
  const EXPLORE = "When you have the answer — or cannot get it — call report once, then end: status done (the goal is met and the check passes), blocked (something outside your task stops you; say what in left) or failed; did: what you found, whole — the agent reads your report, not your work; met: whether the acceptance check passed, and evidence: the check you ran and what it showed; left: what is left, if anything.";
  const WRITE = "When the task is done — or you cannot finish it — call report once, then end: status done (the goal is met and the check passes), blocked (something outside your task stops you; say what in left) or failed; did: what you did; met: whether the acceptance check passed, and evidence: the check you ran and what it showed; left: what is left, if anything. Filament records the files you changed and the commands you ran; when you report done with the check passed, your change goes into the project. Your task has no check: in checked, name the commands that prove it done — the tests you ran, each exactly as you ran it. Filament runs them again in your worktree before the agent hears your report, sends the task back to you if one fails, and keeps them as your task's check, guarding the project after your change goes in. Leave checked out only where no command can check your change.";
  const g = subs();
  assert.equal(briefText(g, "t1", "agent"), [HEAD, "Your task: t1 — Map the parser", "Goal: Every caller of parse() is known", "You change nothing: read, search, and run only what reads.", "Steps:\n1. Search for parse(\n2. List each caller with its line", "Acceptance check: each caller is listed with its file and line", EXPLORE].join("\n\n"));
  const m = mapped();
  assert.equal(
    briefText(m, "t3", "agent"),
    [HEAD, "Your task: t3 — Fix the parser", "Goal: parse() takes every caller's input", "Files — change these alone:\n- src/parse.js", "Steps:\n1. Fix parse()\n2. Run npm test", "Acceptance check: npm test passes", 'What the tasks yours builds on reported:\n- t1 "Map the parser": Three callers:\n  - a.js:3\n  - b.js:9', WRITE].join("\n\n"),
  );
  // A need whose change merged says so, with its files.
  const merged = /** @type {any} */ (taskMerged(ended(launch(m, "t3", "sa-3"), "t3", END("sa-3", { report: FIX_REPORT, files: FIX })).graph, "t3", FIX, 9_500));
  const withT5 = ok(merged, { action: "add", tasks: [T("t5", "Check the callers", ["t1", "t3"], { by: "explorer", goal: "Each caller parses", steps: ["Run each caller"], acceptance: "no caller throws" })] }).graph;
  assert.equal(
    briefText(withT5, "t5", "agent").split("\n\n").find((p) => p.startsWith("What the tasks")),
    'What the tasks yours builds on reported — their changes are in the project you start from:\n- t1 "Map the parser": Three callers:\n  - a.js:3\n  - b.js:9\n- t3 "Fix the parser": parse() takes trailing commas.\n  Its change, merged: src/parse.js',
  );
  // Sent back: the earlier try and the agent's note.
  const failed = ended(launch(m, "t3", "sa-3"), "t3", END("sa-3", { report: NOT_MET, files: FIX, ran: [{ command: "npm test", exit: 1 }] })).graph;
  const back = ok(failed, { action: "start", id: "t3", note: "Run the whole suite, not one file." }).graph;
  assert.deepEqual(briefText(back, "t3", "agent").split("\n\n").slice(-3), [
    "An earlier try at this task ended: its acceptance check did not pass: npm test: 2 failed.\nDid: Fixed it.\nAcceptance: not met — npm test: 2 failed.\nFiles: 1 file (+12 −3): src/parse.js\nRan: npm test (exit 1)\nYou start from the project as it stands now, without that try's change: build on what it learned, and avoid what went wrong.",
    "The agent's note for you: Run the whole suite, not one file.",
    WRITE,
  ]);
  // Stopped, and its explorer can't go on: the new one's brief carries the try.
  const stoppedExplorer = /** @type {any} */ (release(ended(launch(g, "t1", "sa-1"), "t1", END("sa-1", { status: "stopped", stoppedBy: "harness", report: null, words: "Searching." })).graph, { crew: "agent", resumable: () => "Filament restarted since it ran, and its conversation went with it" }));
  assert.equal(briefText(stoppedExplorer, "t1", "agent").split("\n\n").at(-2), "An earlier try at this task ended: stopped by the developer.\nIts last words: Searching.\nBuild on what it learned, and avoid what went wrong.");
});

// (fails before: yes — the G2 drive's t2 changed a scratch test its task did not name, and it merged with the rest
// without a word: G2-5 had it said)
test("a file a sub-agent changed that its task did not name is said — in its end, its show and a send-back's brief — and merged with the rest, never refused", () => {
  const files = [...FIX, { path: "test/tmp.test.js", added: 3, removed: 0 }];
  const run3 = launch(mapped(), "t3", "sa-3", 6_000);
  const e = ended(run3, "t3", END("sa-3", { report: FIX_REPORT, files }), 9_000);
  assert.deepEqual([e.state, e.graph.tasks[2].report.unnamed], ["yours", ["test/tmp.test.js"]]);
  const done3 = /** @type {any} */ (taskMerged(e.graph, "t3", files, 9_500));
  assert.equal(
    endText(done3, "t3", { crew: "agent" }),
    ['[Filament: task t3 "Fix the parser" is done: sub-agent sa-3 reported it done with its acceptance check passed — unchecked: the task has no check, and its report named none — and its change is merged into your folder.', "Did: parse() takes trailing commas.", "Acceptance: met — npm test: 41 passed", "Files: 2 files (+15 −3): src/parse.js, test/tmp.test.js", "Outside its writes: test/tmp.test.js", "Now: 2 of 4 done · ready: t2.]"].join("\n"),
  );
  assert.match(ok(done3, { action: "show", id: "t3" }).text, /\nFiles: 2 files \(\+15 −3\): src\/parse\.js, test\/tmp\.test\.js\nOutside its writes: test\/tmp\.test\.js\n/);
  // Failed, it is said as well, and the next sub-agent's brief carries it with the earlier try.
  const failed = ended(run3, "t3", END("sa-3", { report: NOT_MET, files }), 9_000).graph;
  assert.ok(endText(failed, "t3", { crew: "agent" }).includes("\nFiles: 2 files (+15 −3): src/parse.js, test/tmp.test.js\nOutside its writes: test/tmp.test.js\n"));
  const back = ok(failed, { action: "start", id: "t3" }).graph;
  assert.ok(briefText(back, "t3", "agent").includes("\nFiles: 2 files (+15 −3): src/parse.js, test/tmp.test.js\nOutside its writes: test/tmp.test.js\n"));
  // A glob or a folder names what is under it; only what none of the writes names is said.
  const wide = ok(null, { action: "add", goal: "g", tasks: [S("t1", [], ["src/*.js", "docs/"])] }).graph;
  const wideEnd = ended(launch(wide, "t1", "sa-1"), "t1", END("sa-1", { files: [{ path: "src/lex.js", added: 1, removed: 0 }, { path: "docs/a/b.md", added: 1, removed: 0 }, { path: "README.md", added: 1, removed: 0 }] }));
  assert.deepEqual(wideEnd.graph.tasks[0].report.unnamed, ["README.md"]);
  assert.equal(ended(launch(wide, "t1", "sa-1"), "t1", END("sa-1", { files: [{ path: "src/lex.js", added: 1, removed: 0 }] })).graph.tasks[0].report.unnamed.length, 0);
  // (fails before: yes — a file in a folder a glob of its writes names was said to be outside them)
  // A file is named when a write names it or a folder it lies in — never because a write's glob runs into it.
  const pkgs = ok(null, { action: "add", goal: "g", tasks: [S("t1", [], ["packages/*", "src/**/*.js"])] }).graph;
  const pkgsEnd = ended(launch(pkgs, "t1", "sa-1"), "t1", END("sa-1", { files: ["packages/core/index.js", "src/lib", "README.md"].map((path) => ({ path, added: 1, removed: 0 })) }));
  assert.deepEqual(pkgsEnd.graph.tasks[0].report.unnamed, ["src/lib", "README.md"]);
  // (fails before: no — a guard the mutation pass asked for: many files outside its writes — each looked for among all
  // the files the try changed, the record keeping 50 of them, and the words naming eight with a count of the rest)
  /** @param {number} n @param {(k: number) => string} at */
  const each = (n, at) => Array.from({ length: n }, (_, k) => ({ path: at(k), added: 1, removed: 0 }));
  const lastOne = ended(launch(wide, "t1", "sa-1"), "t1", END("sa-1", { files: [...each(55, (k) => `src/f${k}.js`), { path: "README.md", added: 1, removed: 0 }] }));
  assert.deepEqual(lastOne.graph.tasks[0].report.unnamed, ["README.md"]);
  assert.equal(ended(launch(wide, "t1", "sa-1"), "t1", END("sa-1", { files: each(60, (k) => `notes/n${k}.md`) })).graph.tasks[0].report.unnamed.length, 50);
  const ten = ended(launch(wide, "t1", "sa-1"), "t1", END("sa-1", { files: each(10, (k) => `notes/n${k}.md`) })).graph;
  assert.match(ok(ten, { action: "show", id: "t1" }).text, /\nOutside its writes: notes\/n0\.md, notes\/n1\.md, notes\/n2\.md, notes\/n3\.md, notes\/n4\.md, notes\/n5\.md, notes\/n6\.md, notes\/n7\.md, and 2 more\n/);
});

// (fails before: yes — the G2 drive's explorer found more than 1,000 characters' worth, and the brief of each task after
// it carried its findings cut there)
test("what a task's sub-agent reported reaches the tasks after it whole, merged or not; the agent's note for a send-back is kept whole up to its length", () => {
  const found = `Callers:\n${Array.from({ length: 200 }, (_, k) => `- src/m${k}.js:${k + 1} calls parse() on a config line`).join("\n")}`;
  const m = ended(launch(subs(), "t1", "sa-1"), "t1", END("sa-1", { report: { ...MAP_REPORT, did: found } })).graph;
  assert.equal(m.tasks[0].summary, found);
  assert.equal(
    briefText(m, "t3", "agent").split("\n\n").find((p) => p.startsWith("What the tasks")),
    `What the tasks yours builds on reported:\n- t1 "Map the parser": ${found.replace(/\n/g, "\n  ")}`,
  );
  const fixed = "parse() takes trailing commas. ".repeat(200).trim();
  const merged = /** @type {any} */ (taskMerged(ended(launch(m, "t3", "sa-3"), "t3", END("sa-3", { report: { ...FIX_REPORT, did: fixed }, files: FIX })).graph, "t3", FIX, 9_500));
  assert.equal(merged.tasks[2].summary, fixed);
  const failed = ended(launch(m, "t3", "sa-3"), "t3", END("sa-3", { report: NOT_MET, files: FIX })).graph;
  assert.equal(ok(failed, { action: "start", id: "t3", note: "n".repeat(2000) }).graph.tasks[2].note.length, 2000);
  assert.equal(no(failed, { action: "start", id: "t3", note: "n".repeat(2001) }), "note is up to 2,000 characters (this one has 2,001)");
});

// (fails before: yes — there was no report)
test("a report is read whole or refused in the words the sub-agent reads", () => {
  assert.deepEqual(readReport({ status: "done", did: "  Fixed parse().\r\n\r\n\r\n- trailing commas  \n", met: true, evidence: "npm test: 41 passed" }), { ok: true, report: { status: "done", did: "Fixed parse().\n\n- trailing commas", met: true, evidence: "npm test: 41 passed", left: "" } });
  for (const bad of [null, "done", [], {}, { status: "maybe" }]) assert.deepEqual(readReport(bad), { ok: false, error: "report needs status: done, blocked or failed" });
  assert.deepEqual(readReport({ status: "done", did: " " }), { ok: false, error: "report needs did: what you did, in a few lines" });
  assert.deepEqual(readReport({ status: "done", did: "x", met: "yes" }), { ok: false, error: "report needs met: true when the acceptance check passed, false when it did not" });
  assert.deepEqual(readReport({ status: "done", did: "x", met: false, evidence: 5 }), { ok: false, error: "report needs evidence: the check you ran and what it showed" });
  assert.deepEqual(readReport({ status: "blocked", did: "x", met: false, evidence: "e", left: 5 }), { ok: false, error: "left is text: what is left — or leave it out" });
  assert.deepEqual(readReport({ status: "blocked", did: "x", met: false, evidence: "e", left: null }), { ok: true, report: { status: "blocked", did: "x", met: false, evidence: "e", left: "" } });
  // (fails before: yes — the G2 drive's explorer reported more than was kept: what it found past 2,000 characters never
  // reached the agent)
  const whole = /** @type {any} */ (readReport({ status: "failed", did: "d".repeat(8000), met: false, evidence: "e".repeat(2000), left: "l".repeat(2000) }));
  assert.deepEqual([whole.report.did.length, whole.report.evidence.length, whole.report.left.length], [8000, 2000, 2000]);
  const one = { status: "failed", did: "d", met: false, evidence: "e", left: "l" };
  assert.deepEqual(readReport({ ...one, did: "d".repeat(8001) }), { ok: false, error: "did is up to 8,000 characters (this one has 8,001)" });
  assert.deepEqual(readReport({ ...one, evidence: "e".repeat(2001) }), { ok: false, error: "evidence is up to 2,000 characters (this one has 2,001)" });
  assert.deepEqual(readReport({ ...one, left: "l".repeat(2001) }), { ok: false, error: "left is up to 2,000 characters (this one has 2,001)" });
});

// (fails before: yes — G1's show and view had no sub-agent, no merge, no failure and no spend)
test("show and the view: who does each task, its report, the merges and the failures, and what the sub-agents spent", () => {
  const ran = launch(launch(mapped(), "t2", "sa-2", 6_000), "t3", "sa-3", 6_000);
  const t3Failed = ended(ran, "t3", END("sa-3", { report: NOT_MET, files: FIX }), 8_000).graph;
  const t2Merging = ended(t3Failed, "t2", END("sa-2", { report: { status: "done", did: "Wrote 3 tests.", met: true, evidence: "they fail on the old parser", left: "" }, files: [{ path: "test/parse.test.js", added: 30, removed: 0 }] }), 9_000).graph;
  const g = launch(ok(t2Merging, { action: "start", id: "t3", note: "Run the whole suite, not one file." }).graph, "t3", "sa-4", 10_000);
  assert.equal(
    showText(g, "agent"),
    [
      "The task graph — Ship the parser",
      "1 of 4 done · running: t3 · ready to apply: t2.",
      "Its sub-agents spent $0.75.",
      '- t1 "Map the parser" — done: Three callers: - a.js:3 - b.js:9 · by explorer',
      `- t2 "Write the tests" — ready: its change waits in sa-2's copy for its apply · by sub-agent · needs t1 · writes test/parse.test.js`,
      '- t3 "Fix the parser" — running on sa-4 · by sub-agent · needs t1 · writes src/parse.js',
      '- t4 "Update the docs" — waiting · needs t2, t3 · writes docs/',
      "Waiting on others: t4 on t2 (ready to apply), t3 (running).",
      "Critical path still to go: t2 → t4.",
      "A task whole: tasks show with its id.",
    ].join("\n"),
  );
  assert.equal(
    ok(g, { action: "show", id: "t3" }).text,
    [
      't3 "Fix the parser" — running on sa-4 · by sub-agent · needs t1 · writes src/parse.js',
      "By: a sub-agent — Filament starts it once its needs are done",
      "Goal: parse() takes every caller's input",
      "Steps:\n1. Fix parse()\n2. Run npm test",
      "Needs: t1 (done)",
      "Needed by: t4",
      "Writes: src/parse.js",
      "Acceptance: npm test passes",
      "Your note for its sub-agent: Run the whole suite, not one file.",
      "Before that, sub-agent sa-3 ended: its acceptance check did not pass: npm test: 2 failed.",
      "Spent: $0.25 over 2 tries",
    ].join("\n"),
  );
  const merged = /** @type {any} */ (taskMerged(g, "t2", [{ path: "test/parse.test.js", added: 30, removed: 0 }], 11_000));
  assert.equal(
    ok(merged, { action: "show", id: "t2" }).text,
    [
      't2 "Write the tests" — done: Wrote 3 tests. · by sub-agent · needs t1 · writes test/parse.test.js',
      "By: a sub-agent — Filament starts it once its needs are done",
      "Goal: Tests cover each caller's input",
      "Steps:\n1. Write a test for each caller's input",
      "Needs: t1 (done)",
      "Needed by: t4",
      "Writes: test/parse.test.js",
      "Acceptance: the new tests fail on the old parser",
      "Unchecked: the task has no check.",
      "Sub-agent sa-2 reported done:",
      "Did: Wrote 3 tests.",
      "Acceptance: met — they fail on the old parser",
      "Files: 1 file (+30 −0): test/parse.test.js",
      "Merged: 1 file (+30 −0)",
      "Spent: $0.25 over 1 try",
    ].join("\n"),
  );
  assert.deepEqual(ok(t3Failed, { action: "show", id: "t3" }).text.split("\n").slice(-7), ["Acceptance: npm test passes", "Sub-agent sa-3 reported done:", "Did: Fixed it.", "Acceptance: not met — npm test: 2 failed.", "Files: 1 file (+12 −3): src/parse.js", "Failed: its acceptance check did not pass: npm test: 2 failed.", "Spent: $0.25 over 1 try"]);
  const v = /** @type {any} */ (graphView(g));
  assert.deepEqual([v.counts, v.spentUsd, v.held, v.rev], [{ total: 4, waiting: 1, ready: 0, running: 1, paused: 0, checking: 0, review: 0, merging: 1, done: 1, failed: 0, dropped: 0 }, 0.75, null, 0]);
  assert.deepEqual(graphView(t3Failed)?.counts, { total: 4, waiting: 1, ready: 0, running: 1, paused: 0, checking: 0, review: 0, merging: 0, done: 1, failed: 1, dropped: 0 });
  assert.equal(graphView({ ...g, rev: 7 })?.rev, 7);
  // A spend under a cent says so; none says nothing.
  assert.match(showText(ended(launch(subs(), "t1", "sa-1"), "t1", END("sa-1", { spentUsd: 0.004 })).graph, "agent"), /\nIts sub-agents spent under \$0\.01\.\n/);
  assert.doesNotMatch(showText(subs(), "agent"), /spent/);
});
