// @ts-check
// HarnessV3-TaskGraph G1: the task graph alone (core/task-graph.js — plain JSON and pure logic, no loop). Each
// tasks action and its words; every refusal in words with the graph left as it was; the graph as the agent reads it
// and as a page draws it; and what comes back after a summary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TASKS, TASK_CALLS, applyPlan, applyTasks, endHeard, endSaid, endText, graphView, openGraphText, showText, whereText } from "../src/core/task-graph.js";

const AT = 1_000;
/**
 * One call that must go through, and the graph it left (null only for a show before any add).
 * @param {any} g @param {any} input @param {number} [at] @returns {{ ok: true, graph: any, text: string, changed: boolean }}
 */
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
/** The parser's graph: t1 first, t2 and t3 side by side on it, t4 on both. */
const base = () =>
  ok(null, {
    action: "add",
    goal: "Ship the parser",
    tasks: [T("t1", "Map the parser"), T("t2", "Write the tests", ["t1"], { writes: ["test/parse.test.js"] }), T("t3", "Fix the parser", ["t1"], { writes: ["src/parse.js"], acceptance: "the tests pass" }), T("t4", "Update the docs", ["t2", "t3"], { writes: ["docs/"] })],
  }).graph;
/** A graph moved along by these calls, each of which must go through. @param {any} g @param {any[]} calls */
const walk = (g, calls) => calls.reduce((acc, c) => ok(acc, c).graph, g);

// (fails before: yes — the old graph.js had no applyTasks: a team's lead's graph, never the agent's own)
test("add starts the graph with its goal: tasks wait, ids are lower-cased, and the input is left alone", () => {
  const input = { action: "add", goal: "  Ship   the parser ", tasks: [T("T1", "Map the parser"), T("t2", " Write  the tests ", ["T1"], { writes: ["test/parse.test.js"], acceptance: "they fail first" })] };
  const copy = structuredClone(input);
  const r = ok(null, input, 5_000);
  assert.deepEqual(input, copy, "the tool's input is not changed");
  assert.equal(r.changed, true);
  assert.equal(r.text, "Added t1, t2. 0 of 2 done · ready: t1. Critical path still to go: t1 → t2.");
  const mine = { check: [], verdict: null, by: "you", goal: "", steps: [], state: "waiting", summary: "", why: "", addedAt: 5_000, startedAt: null, endedAt: null, agent: null, tries: 0, resume: null, failures: null, unreviewed: "", note: "", report: null, earlier: null, merged: null, stopped: false, spentUsd: 0, review: false, ranAs: null, reviews: [], reviewer: null, step: null, overruled: "", gate: null };
  assert.deepEqual(r.graph, {
    version: 1,
    goal: "Ship the parser",
    startedAt: 5_000,
    closed: null,
    held: null,
    rev: 0,
    tasks: [
      { id: "t1", name: "Map the parser", needs: [], writes: [], acceptance: "", ...mine },
      { id: "t2", name: "Write the tests", needs: ["t1"], writes: ["test/parse.test.js"], acceptance: "they fail first", ...mine },
    ],
  });
  // A later add joins the graph; its goal, when given, restates the graph's.
  const more = ok(r.graph, { action: "add", goal: "Ship the parser and its docs", tasks: [T("t3", "Write the docs", ["t2"])] }, 6_000);
  assert.equal(more.graph.goal, "Ship the parser and its docs");
  assert.equal(more.graph.startedAt, 5_000);
  assert.deepEqual(more.graph.tasks.map((t) => [t.id, t.addedAt]), [["t1", 5_000], ["t2", 5_000], ["t3", 6_000]]);
  assert.equal(ok(more.graph, { action: "add", tasks: [T("t4", "Check it")] }).graph.goal, "Ship the parser and its docs", "a goal left out stays");
});

// (fails before: yes — the same: there was no tasks call to refuse)
test("a task's own parts are refused in words, each naming the task", () => {
  const g = base();
  assert.equal(no(null, { action: "add", tasks: [T("t1", "Map it")] }), `add starts the graph, so it needs goal: what the work is for, in a sentence\nThe call: ${TASK_CALLS.add}`);
  assert.equal(no(null, { action: "add", goal: "g" }), `add needs tasks: a list of one or more, each with an id, a name, and the ids of the tasks it needs\nThe call: ${TASK_CALLS.add}`);
  // (fails before: no — a guard the mutation pass asked for: no add gave an empty list, which would start a graph of no task)
  assert.equal(no(null, { action: "add", goal: "g", tasks: [] }), `add needs tasks: a list of one or more, each with an id, a name, and the ids of the tasks it needs\nThe call: ${TASK_CALLS.add}`);
  assert.equal(no(null, { action: "add", goal: "g", tasks: ["t1"] }), `each task is an object: its id, its name, and the ids of the tasks it needs\nThe call: ${TASK_CALLS.add}`);
  assert.equal(no(null, { action: "add", goal: "g", tasks: [{ name: "Map it" }] }), `each task needs an id: a short name of your own, like t1 or parser-fix (a letter, then letters, digits, - or _; up to 24 characters)\nThe call: ${TASK_CALLS.add}`);
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("1st", "Map it")] }), `"1st" is no task id: a letter, then letters, digits, - or _ (up to 24 characters), like t1 or parser-fix\nThe call: ${TASK_CALLS.add}`);
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "Map it", [], { role: "builder" })] }), `t1: role is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under\nThe call: ${TASK_CALLS.add}`);
  assert.equal(no(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "  " }] }), "t1: name is required: a few words naming the task");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "Map it", needs: "t0" }] }), "t1: needs is a list of task ids");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "Map it", [], { writes: [""] })] }), "t1: writes is a list of files or globs");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "Map it", [], { writes: ["../other/x.js"] })] }), "t1: writes names files inside the project, relative to its folder — ../other/x.js is not");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "Map it", [], { writes: ["C:/x.js"] })] }), "t1: writes names files inside the project, relative to its folder — C:/x.js is not");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "Map it", [], { acceptance: 5 })] }), "t1: acceptance is text: what shows the task done");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "Map it"), T("T1", "Map it again")] }), "Nothing of this call changed: t1 is given twice");
  assert.equal(no(g, { action: "add", tasks: [T("T2", "Another")] }), "t2 is a task in the graph already — give the new one another id, or change t2");
  const many = Array.from({ length: MAX_TASKS - 3 }, (_, k) => T(`x${k}`, `Task ${k}`));
  assert.equal(no(g, { action: "add", tasks: many }), `Nothing of this call changed: a graph holds at most ${MAX_TASKS} tasks, and this would make ${MAX_TASKS + 1} — make them fewer and larger, or close this graph and start another`);
  assert.equal(no(g, { action: "frob" }), `action must be one of add, start, pause, done, change, drop, close, show, keep, read, find, offer, parallel\n${TASK_CALLS.show} reads the graph; ${TASK_CALLS.add} starts one.`);
  assert.equal(no(g, "add"), `action must be one of add, start, pause, done, change, drop, close, show, keep, read, find, offer, parallel\n${TASK_CALLS.show} reads the graph; ${TASK_CALLS.add} starts one.`);
  // (fails before: yes — the G2 drive's graph lost the end of its goal: what the agent wrote past a length was cut, an
  // ellipsis saying so) The agent's words are kept whole up to their length, and refused past it in words.
  const whole = ok(null, { action: "add", goal: "g".repeat(1000), tasks: [T("t1", "n".repeat(120), [], { acceptance: "a".repeat(1000) })] }).graph;
  assert.deepEqual([whole.goal.length, whole.tasks[0].name.length, whole.tasks[0].acceptance.length], [1000, 120, 1000]);
  assert.equal(no(null, { action: "add", goal: "g".repeat(1001), tasks: [T("t1", "Map it")] }), "goal is up to 1,000 characters (this one has 1,001)");
  assert.equal(no(g, { action: "change", goal: "g".repeat(1001) }), "goal is up to 1,000 characters (this one has 1,001)");
  assert.equal(no(null, { action: "add", goal: "g", tasks: [T("t1", "n".repeat(121))] }), "t1: name is up to 120 characters (this one has 121)");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t1", acceptance: "a".repeat(1001) }] }), "t1: acceptance is up to 1,000 characters (this one has 1,001)");
  const started = walk(base(), [{ action: "start", id: "t1" }]);
  assert.equal(ok(started, { action: "done", id: "t1", summary: "s".repeat(4000) }).graph.tasks[0].summary.length, 4000);
  assert.equal(no(started, { action: "done", id: "t1", summary: "s".repeat(4001) }), "summary is up to 4,000 characters (this one has 4,001)");
  assert.equal(ok(g, { action: "drop", ids: ["t4"], reason: "r".repeat(1000) }).graph.tasks[3].why.length, 1000);
  assert.equal(no(g, { action: "drop", ids: ["t4"], reason: "r".repeat(1001) }), "reason is up to 1,000 characters (this one has 1,001)");
  const shut = ok(g, { action: "close", reason: "r".repeat(1000) }).graph;
  assert.deepEqual([shut.closed.reason.length, shut.tasks[0].why], [1000, `closed: ${"r".repeat(1000)}`]);
  assert.equal(no(g, { action: "close", reason: "r".repeat(1001) }), "reason is up to 1,000 characters (this one has 1,001)");
});

/** A sub-agent's task, its brief a line each. @param {string} id @param {string} name @param {string[]} needs @param {string[]} writes */
const S = (id, name, needs, writes) => T(id, name, needs, { by: "sub-agent", writes, goal: "It is done", steps: ["Do it"], acceptance: "the check passes" });
const MERGES = ": whichever lands second merges three-way at its apply.";

// (fails before: yes — the same; two writers of one file at once were refused until g1, the owner's of 11-09: writes are
// a forecast, and where they meet is said)
test("the graph's own refusals: an unknown need, a loop, a need that was dropped — two writers of one file at once go through", () => {
  const g = base();
  assert.equal(no(g, { action: "add", tasks: [T("t5", "Check", ["t9"])] }), "t5 needs t9, which is no task in the graph");
  assert.equal(no(g, { action: "add", tasks: [T("t5", "Check", ["t5"])] }), "t5 needs itself");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t1", needs: ["t4"] }] }), "the needs go round in a loop: t1 needs t4, t4 needs t2, and t2 needs t1 — one of these needs must go");
  // (fails before: no — a guard the mutation pass asked for: no change named a need that is no task, or itself)
  assert.equal(no(g, { action: "change", tasks: [{ id: "t2", needs: ["t9"] }] }), "t2 needs t9, which is no task in the graph");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t2", needs: ["t2"] }] }), "t2 needs itself");
  // The planner's own two it does one at a time: nothing to say. A sub-agent's beside one: where they meet.
  for (const writes of [["src/parse.js"], ["src/*.js"], ["src"]]) assert.doesNotMatch(ok(g, { action: "add", tasks: [T("t5", "Patch", ["t1"], { writes })] }).text, /merges three-way/);
  assert.doesNotMatch(ok(g, { action: "add", tasks: [T("t5", "Guide", ["t1"], { writes: ["docs/guide.md"] })] }).text, /merges three-way/);
  assert.ok(ok(g, { action: "add", tasks: [S("t5", "Patch", ["t1"], ["./SRC/Parse.js"])] }).text.endsWith(`\nt3 and t5 both write src/parse.js${MERGES}`));
  assert.ok(ok(g, { action: "add", tasks: [S("t5", "Patch", ["t1"], ["src/*.js"])] }).text.endsWith(`\nt3 and t5 both write src/parse.js${MERGES}`));
  assert.ok(ok(g, { action: "add", tasks: [S("t5", "Guide", ["t1"], ["docs/guide.md"])] }).text.endsWith(`\nt4 and t5 both write docs/guide.md${MERGES}`));
  // (fails before: no — a guard the mutation pass asked for: no folder named without its slash met a glob under it,
  // and no two globs differed only in their tails)
  assert.ok(ok(g, { action: "add", tasks: [S("t5", "Lib", [], ["lib"]), S("t6", "Types", [], ["lib/**/*.ts"])] }).text.endsWith(`\nt5 and t6 both write lib/**/*.ts${MERGES}`));
  assert.doesNotMatch(ok(g, { action: "add", tasks: [S("t5", "Styles", [], ["styles/*.css"]), S("t6", "Scripts", [], ["styles/*.js"])] }).text, /merges three-way/);
  // One that needs the other never runs beside it; one done is out of the way; other files never clash.
  ok(g, { action: "add", tasks: [T("t5", "Guide", ["t4"], { writes: ["docs/guide.md"] })] });
  ok(g, { action: "add", tasks: [T("t5", "Lint", ["t1"], { writes: ["src/lint.js", "lib/**/*.ts"] })] });
  const t3Done = walk(g, [{ action: "start", ids: ["t1"] }, { action: "done", id: "t1", summary: "mapped" }, { action: "start", id: "t3" }, { action: "done", id: "t3", summary: "fixed", evidence: "npm test: 40 passed" }]);
  ok(t3Done, { action: "add", tasks: [T("t5", "Patch again", [], { writes: ["src/parse.js"] })] });
  const dropped = ok(g, { action: "drop", ids: ["t4"], reason: "not needed" }).graph;
  assert.equal(no(dropped, { action: "add", tasks: [T("t5", "Check", ["t4"])] }), "t5 needs t4, which was dropped (not needed) — leave it out, or add a task in its place");
});

// (fails before: yes — a path counted as everything under it only against a glob's literal head, and nothing a glob
// matched counted as a folder: a folder without its slash and a glob that runs into it, or a glob that names a folder
// and a file in it, ran at once; and a star in braces threw)
// (g1: writers that may touch one file meet at a merge point now, said in the answer, where they were refused)
test("writers that may touch one file meet: a folder without its slash and a glob that names something in it, a glob that names a folder and a file in it, braces as the glob tools read them", () => {
  /** Two sub-agents' writers side by side in a new graph: whether its answer says they meet. @param {string} a @param {string} b */
  const meet = (a, b) => /\nt5 and t6 (may )?both write .*: whichever lands second merges three-way at its apply\.$/.test(ok(null, { action: "add", goal: "g", tasks: [S("t5", "One", [], [a]), S("t6", "Two", [], [b])] }).text);
  const clashes = [["src/lib", "src/**/*.js"], ["src/lib", "src/li*/x.js"], ["lib", "**/*.ts"], ["packages/*", "packages/core/index.js"], ["src/lib", "src/{lib,util}/**"], ["src/{*.js,*.ts}", "src/lex.js"]];
  for (const [a, b] of clashes) assert.ok(meet(a, b), `${a} and ${b} meet`);
  for (const [a, b] of [["src/lib", "src/*.js"], ["lib", "*.ts"], ["src/lib", "src/{util,app}/**"], ["packages/*", "apps/web/index.js"], ["src/{*.js,*.ts}", "src/lex.md"]]) assert.ok(!meet(a, b), `${a} and ${b} do not`);
  // Past 64 spellings of its braces, a glob may name anything.
  assert.ok(meet("docs/x.md", `src/${"{a,b}".repeat(7)}.js`));
  assert.ok(!meet("docs/x.md", `src/${"{a,b}".repeat(6)}.js`));
});

// (fails before: yes — the same: nothing started or finished a task but its worker)
test("start and done keep the order: a task starts once its needs are done, several side by side, and done says what became ready", () => {
  const g = base();
  assert.equal(no(g, { action: "start", ids: ["t2"] }), "t2 can't start yet: it needs t1 (waiting) done first");
  assert.equal(no(g, { action: "start" }), `start needs ids: the tasks to start\nThe call: ${TASK_CALLS.start}`);
  assert.equal(no(g, { action: "start", ids: ["t9"] }), "t9 is no task in the graph");
  const before = JSON.stringify(g);
  const s1 = ok(g, { action: "start", ids: ["T1"] }, 2_000);
  assert.equal(JSON.stringify(g), before, "a call that goes through leaves its input graph alone too");
  assert.equal(s1.text, "Started t1: yours, so you do it now. 0 of 4 done · running: t1.");
  assert.deepEqual([s1.graph.tasks[0].state, s1.graph.tasks[0].startedAt], ["running", 2_000]);
  assert.equal(no(s1.graph, { action: "start", id: "t1" }), "t1 is running already");
  assert.equal(no(s1.graph, { action: "start", ids: ["t2", "t3"] }), "2 problems, so nothing of this call changed — one call can fix them all:\n- t2 can't start yet: it needs t1 (running) done first\n- t3 can't start yet: it needs t1 (running) done first");
  // (fails before: yes — E40's first cut offered the example's t2, which a model copying it whole would have ended) The
  // call to copy names the task the call named.
  assert.equal(no(s1.graph, { action: "done", id: "t1" }), 'done needs summary: what was done, in a line or two\nThe call: {"action":"done","id":"t1","summary":"what was done, in a line or two"}');
  assert.equal(no(s1.graph, { action: "done", summary: "x" }), `done needs id: the task that is done, with its summary\nThe call: ${TASK_CALLS.done}`);
  // Several go as tasks entries, each with its own summary (11-09, task-graph-rounds.test.js).
  assert.equal(no(s1.graph, { action: "done", ids: ["t1", "t2"], summary: "x" }), 'done takes each task with its own summary — tasks: [{"id": …, "summary": …}, …] marks several in one call, or call it once a task\nThe call: {"action":"done","id":"t1","summary":"what was done, in a line or two"}');
  assert.equal(no(s1.graph, { action: "done", id: "t2", summary: "x" }), "t2 can't be done yet: it needs t1 (running) done first");
  const d1 = ok(s1.graph, { action: "done", ids: ["t1"], summary: "Mapped: parse() in src/parse.js:12." }, 3_000);
  // Two writers made ready, their writes apart, say they can run side by side (E41 P3 case 16, task-graph-parallel.test.js).
  // (the owner's of 11-10: a done that leaves tasks able to run at once says to suggest them on a card, which answers
  // itself in 60 seconds, the owner's of 11-14) — these two
  // have no steps, which a card's sub-agent is briefed with, so the words say that and print no call (the review of
  // 67038d835; side-offer.test.js has the call). Each is named there, once.
  assert.equal(d1.text, `Done: t1. 1 of 4 done.\nThe graph lets t2 and t3 run side by side: none needs another's work. Whether they should is your call — truly independent, each worth a sub-agent of its own, none you are working on yourself. If so, t2 and t3 have no steps, which the sub-agent a card starts is briefed with: give each goal and steps (tasks change), then suggest them to the person with parallel and their ids, which puts a card in the chat that starts each on a sub-agent on their Accept, or by itself after 60 seconds; a builder you launch for one yourself is held on a card the same way. If not, do them yourself, in order.`);
  assert.deepEqual(d1.graph.tasks[0], { ...s1.graph.tasks[0], state: "done", summary: "Mapped: parse() in src/parse.js:12.", endedAt: 3_000 });
  assert.equal(no(d1.graph, { action: "done", id: "t1", summary: "again" }), "t1 is done already");
  // A start of a done task reopens it for another round (11-09, task-graph-rounds.test.js).
  assert.equal(ok(d1.graph, { action: "start", id: "t1" }).text, "Reopened t1 for round 2: yours, so you do it now — its done record is kept as the round before. t2 and t3 wait again, for t1's new round. 0 of 4 done · running: t1.");
  const s23 = ok(d1.graph, { action: "start", ids: ["t2", "t3", "t2"] });
  assert.equal(s23.text, "Started t2, t3: yours, so you do them now. t2 and t3 both read as at work now: one task of yours at a time — the one you are on. Pause the others until you take them up (tasks pause, one call a task, each with its checkpoint), unless a sub-agent or a command works one meanwhile. 1 of 4 done · running: t2, t3.");
  // (fails before: no — a guard the mutation pass asked for: no done left a task ready that was ready before it)
  assert.equal(ok(d1.graph, { action: "done", id: "t2", summary: "Tests written." }).text, 'Done: t2. Next of yours: t3 "Fix the parser" — start it as you take it up. 2 of 4 done.');
  // (fails before: no — a guard the mutation pass asked for: no graph was added deeper tasks first, so the order a
  // task may start in was always the order it was added in)
  const late = walk(null, [{ action: "add", goal: "g", tasks: [T("b", "B", ["c"]), T("c", "C"), T("a", "A")] }]);
  assert.equal(ok(late, { action: "done", id: "c", summary: "x" }).text, 'Done: c. Ready now: b. Next of yours: a "A" — start it as you take it up. 1 of 3 done.');
  const d2 = ok(s23.graph, { action: "done", id: "t2", summary: "Tests written." });
  assert.equal(d2.text, "Done: t2. 2 of 4 done · running: t3.");
  const d3 = ok(d2.graph, { action: "done", id: "t3", summary: "Parser fixed.", evidence: "npm test: 40 passed" });
  assert.equal(d3.text, 'Done: t3. Next of yours: t4 "Update the docs" — start it as you take it up. 3 of 4 done.');
  // A task whose needs are done may be marked done straight from waiting: it started when it ended.
  const d4 = ok(d3.graph, { action: "done", id: "t4", summary: "Docs updated." }, 9_000);
  assert.equal(d4.text, `Done: t4. ${WEIGH("All 4 tasks are done", "Ship the parser")}`);
  assert.deepEqual([d4.graph.tasks[3].startedAt, d4.graph.tasks[3].endedAt], [9_000, 9_000]);
});

// (fails before: yes — the review of 67038d835, its finding 10: a done named the task that comes next up to four times —
// "Ready now", "Next of yours", the line's "ready:" and the side-by-side line)
test("a done names each task it leaves ready once, in the place that says the most of it", () => {
  // The set the graph lets run side by side, said in this answer: in its line, and in no other place of the answer.
  const d1 = ok(walk(base(), [{ action: "start", ids: ["t1"] }]), { action: "done", id: "t1", summary: "Mapped." });
  assert.deepEqual([d1.text.split("\n")[0], d1.text.split("\n")[1].slice(0, 57)], ["Done: t1. 1 of 4 done.", "The graph lets t2 and t3 run side by side: none needs ano"]);
  // What comes next of the agent's own, by name: there, and not in the line of how the work stands.
  assert.equal(ok(d1.graph, { action: "done", id: "t2", summary: "Tests written." }).text, 'Done: t2. Next of yours: t3 "Fix the parser" — start it as you take it up. 2 of 4 done.');
  // What the done made ready, where another comes next: each once.
  const late = walk(null, [{ action: "add", goal: "g", tasks: [T("b", "B", ["c"]), T("c", "C"), T("a", "A")] }]);
  assert.equal(ok(late, { action: "done", id: "c", summary: "x" }).text, 'Done: c. Ready now: b. Next of yours: a "A" — start it as you take it up. 1 of 3 done.');
  // One of its own runs, so nothing comes next: what the done made ready is said as that, once.
  const busy = walk(null, [{ action: "add", goal: "g", tasks: [T("z", "Z"), T("y", "Y", ["z"]), T("x", "X")] }, { action: "start", ids: ["x"] }]);
  assert.equal(ok(busy, { action: "done", id: "z", summary: "x" }).text, "Done: z. Ready now: y. 1 of 3 done · running: x.");
  // A ready task no other place of the answer names stays in the line.
  const wide = walk(null, [{ action: "add", goal: "g", tasks: [T("d", "D"), T("a", "A"), T("b", "B"), T("c", "C")] }]);
  assert.equal(ok(wide, { action: "done", id: "d", summary: "x" }).text, 'Done: d. Next of yours: a "A" — start it as you take it up. 1 of 4 done · ready: b, c.');
});

/** What the answer that makes every task done says (the owner's of 11-10). @param {string} head @param {string} goal @param {boolean} [asked] */
const WEIGH = (head, goal, asked = false) =>
  `${head}. Before you close, weigh what was done against the goal "${goal}"${asked ? " and what the person asked since the graph began" : ""}: what was asked that no task did goes in as tasks (tasks add); if nothing is left, close the graph with its outcome (tasks close).`;

// (fails before: yes — the review of 67038d835, its finding 4: the answer was written with the goal alone and then
// rewritten by String.replace, the graph's goal in the replacement — where "$&", "$'" and "$1" are patterns, so a goal
// that holds one came out with the answer's own words spliced into it)
test("all done, the person wrote since: a goal that holds $& or $' is said as it is, by a call's answer and a tick's", () => {
  const goal = "Escape $& and $' in sed's replacement, and $1 too";
  const g = walk(null, [{ action: "add", goal, tasks: [T("a", "A"), T("b", "B")] }, { action: "start", ids: ["a"] }, { action: "done", id: "a", summary: "x" }, { action: "start", ids: ["b"] }]);
  const o = { at: AT, crew: /** @type {const} */ ("agent"), personAt: AT + 1 };
  const done = /** @type {any} */ (applyTasks(g, { action: "done", id: "b", summary: "y" }, o));
  assert.equal(done.text, `Done: b. ${WEIGH("All 2 tasks are done", goal, true)}`);
  assert.deepEqual(done.graph.told.filter((/** @type {string} */ m) => m.startsWith("end")), ["end"]);
  // Every action that leaves all done weighs with what the person asked since: a drop here.
  const dropped = /** @type {any} */ (applyTasks(g, { action: "drop", ids: ["b"], reason: "not needed" }, o));
  assert.ok(dropped.text.endsWith(` ${WEIGH("Its one task is done", goal, true)}`), dropped.text);
  // A tick of the checklist that names the task: its words, and its part that says how the work stands.
  const tick = applyPlan(g, [{ text: "B", status: "done" }], o);
  assert.ok(tick.text.endsWith(WEIGH("All 2 tasks are done", goal, true)), tick.text);
  assert.equal(tick.parts?.now, WEIGH("All 2 tasks are done", goal, true));
});

// (fails before: yes — the owner's of 11-10: an agent that drifted in a long context hears only its tools' answers, and at
// all done they said "close" alone — never what the work was for, nor what the person asked since; a check's verdict, a
// worker's or a command's end said "Now: 4 of 4 done"; a turn's start said nothing of a graph left open with all done,
// nor of a task whose check still runs; and one task was "All 1 task are done")
test("all done: the answer that makes it so weighs the work against the goal — and what the person asked since, where they wrote — once each time it comes; later answers say close; a turn's start once more", () => {
  const d3 = walk(base(), [{ action: "done", id: "t1", summary: "a" }, { action: "done", id: "t2", summary: "b" }, { action: "done", id: "t3", summary: "c", evidence: "npm test" }]);
  const d4 = ok(d3, { action: "done", id: "t4", summary: "Docs updated." });
  assert.equal(d4.text, `Done: t4. ${WEIGH("All 4 tasks are done", "Ship the parser")}`);
  /** The marks of all done a graph keeps. @param {any} g */
  const ends = (g) => (g.told || []).filter((/** @type {string} */ m) => m.startsWith("end"));
  assert.deepEqual(ends(d4.graph), ["end"]);
  const renamed = ok(d4.graph, { action: "change", goal: "Ship the parser, documented" });
  assert.ok(renamed.text.endsWith(" All 4 tasks are done — close the graph with its outcome (tasks close)."), renamed.text);
  // Reopened, its marks go; done again, it weighs again.
  const again = ok(d4.graph, { action: "start", id: "t4" }).graph;
  assert.deepEqual(ends(again), [], "its mark goes as the graph opens again");
  assert.equal(ok(again, { action: "done", id: "t4", summary: "Docs again." }).text, `Done: t4. ${WEIGH("All 4 tasks are done", "Ship the parser")}`);
  // The person wrote since the graph began (when they last wrote, `personAt`): the answer says what they asked too.
  /** @param {number} personAt */
  const lastAt = (personAt) => applyTasks(d3, { action: "done", id: "t4", summary: "Docs." }, { at: AT, crew: "agent", personAt });
  assert.equal(/** @type {any} */ (lastAt(AT + 1)).text, `Done: t4. ${WEIGH("All 4 tasks are done", "Ship the parser", true)}`);
  assert.equal(/** @type {any} */ (lastAt(AT - 1)).text, `Done: t4. ${WEIGH("All 4 tasks are done", "Ship the parser")}`, "they wrote before it began: the goal alone");
  // One task: said as one.
  const one = walk(null, [{ action: "add", goal: "Fix it", tasks: [T("a", "A")] }]);
  assert.equal(ok(one, { action: "done", id: "a", summary: "x" }).text, `Done: a. ${WEIGH("Its one task is done", "Fix it")}`);
  // Filament's own words of an end — a check's verdict here — say it as a call's answer does, and once.
  const checked = { ...d4.graph, told: undefined };
  assert.equal(endText(checked, "t4", { crew: "agent" }), `[Filament: task t4 "Update the docs" is done.\n${WEIGH("All 4 tasks are done", "Ship the parser")}]`);
  const said = /** @type {any} */ (endSaid(checked));
  assert.deepEqual(said.told, ["end"]);
  assert.equal(endSaid(said), null, "said once");
  assert.equal(endText(said, "t4", { crew: "agent" }), `[Filament: task t4 "Update the docs" is done.\nAll 4 tasks are done — close the graph with its outcome (tasks close).]`);
  assert.equal(endSaid(d3), null, "not all done: nothing to mark");
  // A turn's start: once more, while it stays open; then nothing.
  const where = String(whereText(said, { crew: "agent", personAt: AT + 1 }));
  assert.equal(where, `[Filament: where you are — your task graph "Ship the parser": all 4 tasks are done, and it is still open. Weigh what was done against its goal and what the person asked since it began: what was asked that no task did goes in as tasks (tasks add); if nothing is left, close it with its outcome (tasks close).]`);
  const heard = /** @type {any} */ (endHeard(said));
  assert.deepEqual(heard.told, ["end", "end:turn"]);
  assert.equal(whereText(heard, { crew: "agent" }), null, "said once more, then not");
  assert.equal(endHeard(heard), null);
  assert.equal(whereText({ ...heard, closed: { at: AT, reason: "shipped" } }, { crew: "agent" }), null, "closed");
  // (fails before: yes — FabeleHelper's of 11-10: after a compaction the loop's fold, a switch and a coding agent heard
  // nothing of a graph left open with all done, though the summary may have lost it — the very agent this is for)
  // After a compaction it is said again, whoever heard it at a turn's start; the graph's block is that.
  assert.equal(whereText(heard, { crew: "agent", again: true }), where.replace(" and what the person asked since it began", ""));
  assert.equal(openGraphText(heard, "agent", null, whereText(heard, { crew: "agent", again: true }), { done: true }), whereText(heard, { crew: "agent", again: true }));
  assert.equal(openGraphText({ ...heard, closed: { at: AT, reason: "shipped" } }, "agent", null, "WHERE", { done: true }), null, "closed: nothing comes back");
  // Only to its own planner, where the caller asks (`done`): one reading another's chat has nothing open to read.
  assert.equal(openGraphText(heard, "agent", null, "WHERE"), null);
  // A task whose check still runs is at work: the block says it.
  const checking = { ...d3, tasks: d3.tasks.map((/** @type {any} */ t) => (t.id === "t4" ? { ...t, state: "checking" } : t)) };
  assert.match(String(whereText(checking, { crew: "agent" })), /\n- On it: t4 "Update the docs" — /);
});

// (fails before: yes — the same: a change rewrote a team task's brief)
test("change: a waiting task any field, a running one too, a finished one never — and a goal restated", () => {
  const g = walk(base(), [{ action: "start", id: "t1" }]);
  const c = ok(g, { action: "change", tasks: [{ id: "T2", name: "Write the failing tests", acceptance: "they fail", needs: ["t1"], writes: ["test/parse.test.js", "test/fixtures/"] }] });
  assert.equal(c.text, "Changed t2. 0 of 4 done · running: t1.");
  assert.deepEqual(c.graph.tasks[1], { ...g.tasks[1], name: "Write the failing tests", acceptance: "they fail", writes: ["test/parse.test.js", "test/fixtures/"] });
  assert.equal(ok(g, { action: "change", tasks: [{ id: "t1", name: "Map the parser and its callers" }] }).graph.tasks[0].name, "Map the parser and its callers");
  // A running task's needs may change (g1, the owner's of 11-09): the same needs say nothing more.
  assert.equal(ok(g, { action: "change", tasks: [{ id: "t1", needs: [] }] }).text, "Changed t1. 0 of 4 done · running: t1.");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t2" }] }), "change t2 how? Give the fields that change");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t9", name: "x" }] }), "t9 is no task in the graph");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t2", name: "a" }, { id: "t2", name: "b" }] }), "Nothing of this call changed: t2 is given twice");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t2", owner: "me" }] }), `t2: owner is no field of a task — its fields are id, name, needs, writes, acceptance, check, by, goal, steps, run, items, thread, found_by, under\nThe call: ${TASK_CALLS.change}`);
  assert.equal(no(g, { action: "change" }), `change needs tasks: each with the id of a task to change and the fields that change — or goal, to restate the graph's\nThe call: ${TASK_CALLS.change}`);
  const goal = ok(g, { action: "change", goal: "Ship the parser, tested" });
  assert.deepEqual([goal.text, goal.graph.goal], ["Changed the goal. 0 of 4 done · running: t1.", "Ship the parser, tested"]);
  const finished = walk(g, [{ action: "done", id: "t1", summary: "mapped" }, { action: "drop", ids: ["t4"], reason: "later" }]);
  assert.equal(no(finished, { action: "change", tasks: [{ id: "t1", name: "x" }] }), "t1 is done — start it to reopen it, or add a new task for other work");
  assert.equal(no(finished, { action: "change", tasks: [{ id: "t4", name: "x" }] }), "t4 was dropped (later) — add a new task for that work");
});

// (fails before: yes — the same)
test("drop takes its reason and the tasks that need what goes; close drops what is open and the next add starts a new graph", () => {
  const g = walk(base(), [{ action: "start", id: "t1" }, { action: "done", id: "t1", summary: "mapped" }]);
  assert.equal(no(g, { action: "drop", ids: ["t3"] }), `drop needs reason: why the tasks go\nThe call: ${TASK_CALLS.drop}`);
  // What needed it loses that need, and is named (11-09, task-graph-rounds.test.js).
  const cut = ok(g, { action: "drop", ids: ["t3"], reason: "the parser is fine" });
  assert.deepEqual([cut.text, cut.graph.tasks[3].needs], ["Dropped t3. t4 needed it: that need is cut. 1 of 3 done · ready: t2.", ["t2"]]);
  assert.equal(no(g, { action: "drop", ids: ["t1"], reason: "x" }), "t1 is done, so there is nothing to drop");
  // (fails before: no — a guard the mutation pass asked for: no drop came after the task that needed it was dropped)
  assert.equal(ok(walk(g, [{ action: "drop", ids: ["t4"], reason: "later" }]), { action: "drop", ids: ["t3"], reason: "the parser is fine" }).text, "Dropped t3. 1 of 2 done · ready: t2.");
  const d = ok(g, { action: "drop", ids: ["t3", "T4"], reason: "the parser is fine" }, 4_000);
  assert.equal(d.text, "Dropped t3, t4. 1 of 2 done · ready: t2.");
  assert.deepEqual([d.graph.tasks[2].state, d.graph.tasks[2].why, d.graph.tasks[2].endedAt], ["dropped", "the parser is fine", 4_000]);
  assert.equal(no(d.graph, { action: "drop", ids: ["t3"], reason: "x" }), "t3 is dropped already");
  assert.equal(no(d.graph, { action: "start", id: "t4" }), "t4 was dropped (the parser is fine)");
  assert.equal(ok(walk(base(), []), { action: "drop", ids: ["t1", "t2", "t3", "t4"], reason: "wrong plan" }).text, "Dropped t1, t2, t3, t4. No task is left: close the graph with its outcome (tasks close), or add more.");
  assert.equal(no(d.graph, { action: "close" }), `close needs reason: the outcome in a sentence — what was done, and why anything left goes\nThe call: ${TASK_CALLS.close}`);
  const c = ok(d.graph, { action: "close", reason: "Mapped; the fix was not needed" }, 7_000);
  assert.equal(c.text, "Closed the graph: 1 done, 1 still open dropped with it.");
  assert.deepEqual(c.graph.closed, { at: 7_000, reason: "Mapped; the fix was not needed" });
  assert.deepEqual(c.graph.tasks.map((t) => [t.id, t.state, t.why]), [["t1", "done", ""], ["t2", "dropped", "closed: Mapped; the fix was not needed"], ["t3", "dropped", "the parser is fine"], ["t4", "dropped", "the parser is fine"]]);
  // A closed graph stays readable and takes no edit; the next add starts another, which needs its goal.
  for (const call of [{ action: "start", id: "t2" }, { action: "close", reason: "again" }, { action: "drop", ids: ["t2"], reason: "x" }])
    assert.equal(no(c.graph, call), "the graph is closed (Mapped; the fix was not needed) — tasks add starts a new one, with its goal");
  assert.match(ok(c.graph, { action: "show" }).text, /^The task graph — Ship the parser\nClosed: Mapped; the fix was not needed \(1 done, 3 dropped\)\.\n/);
  assert.equal(no(c.graph, { action: "add", tasks: [T("n1", "Next")] }), `add starts a new graph, since this one is closed, so it needs goal: what the work is for, in a sentence\nThe call: ${TASK_CALLS.add}`);
  const fresh = ok(c.graph, { action: "add", goal: "Ship the lexer", tasks: [T("t1", "Map the lexer")] }, 8_000).graph;
  assert.deepEqual([fresh.goal, fresh.startedAt, fresh.closed, fresh.tasks.map((t) => t.id)], ["Ship the lexer", 8_000, null, ["t1"]]);
  for (const call of [{ action: "start", id: "t1" }, { action: "done", id: "t1", summary: "x" }, { action: "change", goal: "x" }, { action: "drop", ids: ["t1"], reason: "x" }, { action: "close", reason: "x" }])
    assert.equal(no(null, call), "there is no graph yet — tasks add starts one, with its goal");
});

// (fails before: yes — the same: show spoke of a team's roles, workers and spend)
test("show: the whole graph — the goal, every task in a line, what waits on what and the critical path — or one task whole", () => {
  const g = base();
  assert.equal(ok(null, { action: "show" }).text, "No graph yet: tasks add starts one, with its goal.");
  const whole = ok(g, { action: "show" });
  assert.equal(whole.changed, false);
  assert.equal(whole.graph, g, "show hands the graph back untouched");
  assert.equal(
    whole.text,
    [
      "The task graph — Ship the parser",
      "0 of 4 done · ready: t1.",
      '- t1 "Map the parser" — ready',
      '- t2 "Write the tests" — waiting · needs t1 · writes test/parse.test.js',
      '- t3 "Fix the parser" — waiting · needs t1 · writes src/parse.js',
      '- t4 "Update the docs" — waiting · needs t2, t3 · writes docs/',
      "Waiting on others: t2 on t1 (waiting); t3 on t1 (waiting); t4 on t2 (waiting), t3 (waiting).",
      "Critical path still to go: t1 → t2 → t4.",
      "A task whole: tasks show with its id.",
    ].join("\n"),
  );
  assert.equal(showText(g, "agent"), whole.text);
  const later = walk(g, [{ action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Mapped: parse() in src/parse.js:12." }, { action: "start", id: "t3" }, { action: "change", tasks: [{ id: "t4", needs: ["t3"] }] }, { action: "drop", ids: ["t2"], reason: "tests exist" }]);
  assert.equal(
    showText(later, "agent"),
    [
      "The task graph — Ship the parser",
      "1 of 3 done · running: t3 · 1 dropped.",
      '- t1 "Map the parser" — done: Mapped: parse() in src/parse.js:12.',
      '- t2 "Write the tests" — dropped: tests exist · needs t1 · writes test/parse.test.js',
      '- t3 "Fix the parser" — running · needs t1 · writes src/parse.js',
      '- t4 "Update the docs" — waiting · needs t3 · writes docs/',
      "Waiting on others: t4 on t3 (running).",
      "Critical path still to go: t3 → t4.",
      "A task whole: tasks show with its id.",
    ].join("\n"),
  );
  assert.equal(
    ok(later, { action: "show", id: "T3" }).text,
    ['t3 "Fix the parser" — running · needs t1 · writes src/parse.js', "Needs: t1 (done)", "Needed by: t4", "Writes: src/parse.js", "Acceptance: the tests pass"].join("\n"),
  );
  // A task done with no check says so (HarnessV3-TaskGraph-v2 V2-1).
  assert.equal(ok(later, { action: "show", id: "t1" }).text, ['t1 "Map the parser" — done: Mapped: parse() in src/parse.js:12.', "Needed by: t3", "Unchecked: the task has no check.", "Done: Mapped: parse() in src/parse.js:12."].join("\n"));
  assert.equal(no(later, { action: "show", id: "t9" }), "t9 is no task in the graph");
});

// (fails before: yes — the old graph.js had no view: nothing drew a graph)
test("the view a page draws: each task's layer by its needs, ready and critical, and the counts", () => {
  assert.equal(graphView(null), null);
  const g = walk(base(), [{ action: "start", id: "t1" }, { action: "done", id: "t1", summary: "mapped" }, { action: "start", id: "t2" }]);
  const v = /** @type {NonNullable<ReturnType<typeof graphView>>} */ (graphView(g));
  assert.deepEqual(v.tasks.map((t) => [t.id, t.layer, t.ready, t.critical, t.state]), [["t1", 0, false, false, "done"], ["t2", 1, false, true, "running"], ["t3", 1, true, false, "waiting"], ["t4", 2, false, true, "waiting"]]);
  assert.deepEqual(v.critical, ["t2", "t4"]);
  assert.deepEqual(v.counts, { total: 4, waiting: 1, ready: 1, running: 1, paused: 0, checking: 0, review: 0, merging: 0, done: 1, failed: 0, dropped: 0 });
  assert.deepEqual([v.version, v.goal, v.closed, v.startedAt], [1, "Ship the parser", null, AT]);
  assert.deepEqual(v.tasks[1], { ...g.tasks[1], layer: 1, ready: false, critical: true }, "every stored field rides beside the derived ones");
  // (fails before: no — a guard the mutation pass asked for: no two chains tied for the critical path)
  const tie = ok(null, { action: "add", goal: "Two lines", tasks: [T("a1", "A one"), T("a2", "A two", ["a1"]), T("b1", "B one"), T("b2", "B two", ["b1"])] });
  assert.deepEqual(graphView(tie.graph)?.critical, ["a1", "a2"], "a tie goes to the first added");
  assert.match(tie.text, /Critical path still to go: a1 → a2\.$/);
});

// (fails before: yes — the same: nothing brought a graph back after a summary)
test("what comes back after a summary", () => {
  const g = base();
  assert.equal(openGraphText(g, "agent"), showText(g, "agent"), "an open graph comes back whole");
  assert.equal(openGraphText(null, "agent"), null);
  const allDone = walk(g, [{ action: "start", id: "t1" }, ...["t1", "t2", "t3", "t4"].map((id) => ({ action: "done", id, summary: "ok", ...(id === "t3" ? { evidence: "npm test: 40 passed" } : {}) }))]);
  assert.equal(openGraphText(allDone, "agent"), null, "nothing open, nothing to carry");
  assert.equal(openGraphText(ok(g, { action: "close", reason: "stopped" }).graph, "agent"), null, "a closed graph is not carried");
});
