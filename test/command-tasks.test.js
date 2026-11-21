// @ts-check
// HarnessV3-TaskGraph-v2 V2-3 (TG2-D4; TG2-D65 to D71): command tasks. A task `by: "command"` is no model's: Filament runs
// its commands once for each of its items — `{item}` filled in — in copies of the folder, several at once on lanes of
// their own (no model slot), and its result is one table: done when every run passed, failed naming those that did not.
// A command that starts `! ` passes when it fails. The developer's Stop sets it aside; a start runs it whole again.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tg from "../src/core/task-graph.js";
import { createGraphRunner } from "../src/app/agent/graph-runner.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { PROMPT_VERSION, systemPromptFor } from "../src/app/agent/prompt.js";
import { CODER_TASKS_TOOL, LEAD_TASKS_TOOL, TASKS_READS_TOOL, TASKS_TOOL } from "../src/app/agent/tools.js";
import { createAgentCardStore } from "../src/services/agent-cards.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { copiesOf } from "./helpers/copies.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { membersOf } from "./helpers/roster.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const T0 = 1000;
const LED = membersOf({ scout: "Map what exists.", builder: "Build against the contract.", tester: "", reviewer: "Review against the contract." });
const MUT = { id: "mut", name: "Try the mutants", by: "command", run: ["node try.js {item}"], items: ["m01", "m02", "m03"] };
const FIXER = { id: "fix", name: "Kill the survivors", needs: ["mut"], by: "sub-agent", writes: ["test/more.test.js"], goal: "Every mutant killed", steps: ["Write tests"], acceptance: "npm test passes" };
/**
 * An add that starts a graph, under the agent unless `o` says another planner.
 * @param {any[]} tasks @param {Record<string, any>} [o] @returns {any}
 */
const add = (tasks, o = {}) => tg.applyTasks(null, { action: "add", goal: "A mutation pass", tasks }, { at: T0, crew: "agent", ...o });
/** A tasks call, its answer read as either kind. @param {any} graph @param {any} input @param {any} o @returns {any} */
const call = (graph, input, o) => tg.applyTasks(graph, input, o);
/** The refusal's words of an add. @param {any[]} tasks @param {Record<string, any>} [o] */
const refusal = (tasks, o = {}) => {
  const r = add(tasks, o);
  assert.equal(r.ok, false, `refused: ${JSON.stringify(tasks)}`);
  return /** @type {string} */ (r.error);
};
/**
 * One run as the registry hands it over.
 * @param {string | null} item @param {number | null} exit @param {Record<string, any>} [more]
 */
const RUN = (item, exit, more = {}) => ({ item, command: item ? `node try.js ${item}` : "npm test", invert: false, exit, ms: 1500, passed: exit === 0, output: exit === 0 ? "ok" : `FAIL ${item}`, ...more });

// (fails before: yes — a task was the agent's, a sub-agent's or an explorer's)
test("a command task is added with its run and items, and the add says Filament runs it — no model — once per item", () => {
  const r = add([MUT]);
  assert.equal(r.ok, true, r.error);
  const t = r.graph.tasks[0];
  assert.deepEqual([t.by, t.run, t.items, t.result, t.writes, t.check, t.goal, t.steps], ["command", ["node try.js {item}"], ["m01", "m02", "m03"], null, [], [], "", []]);
  assert.match(r.text, /mut is a command task: Filament runs `node try\.js \{item\}` once for each of its 3 items, in copies of your folder, as many at once as there is room for — no model — and its end says which runs did not pass\./);
  const one = add([{ id: "tsc", name: "Typecheck and test", by: "command", run: ["npx tsc --noEmit", "npm test"] }]);
  assert.match(one.text, /tsc is a command task: Filament runs `npx tsc --noEmit`, then `npm test` in a copy of your folder — no model — and its end says whether it passed\./);
  assert.deepEqual(one.graph.tasks[0].items, []);
  const led = add([MUT], { crew: LED });
  assert.equal(led.ok, true, led.error);
  assert.match(led.text, /in copies of the folder/);
});

// (fails before: yes)
test("an add refuses a command task's every problem in words: its run, its items, a worker's fields, run on another task", () => {
  const base = { id: "x", name: "X", by: "command" };
  assert.match(refusal([base]), /x: a command task needs run: one to five commands, in order — Filament runs them itself/);
  assert.match(refusal([{ ...base, run: ["a", "b", "c", "d", "e", "f"] }]), /x: run holds at most 5 commands/);
  assert.match(refusal([{ ...base, run: ["npm test", " "] }]), /x: run is a list of commands, one to five/);
  assert.match(refusal([{ ...base, run: ["npm test\nnpm run lint"] }]), /x: a command of run is one line: give each command its own entry/);
  assert.match(refusal([{ ...base, run: ["node try.js {item}"] }]), /x: run names \{item\}, and the task has no items: give items, or leave \{item\} out/);
  assert.match(refusal([{ ...base, run: ["npm test"], items: ["a"] }]), /x: items fill \{item\} in run, and no command of run names it: name \{item\} where each item goes, or leave items out/);
  assert.match(refusal([{ ...base, run: ["t {item}"], items: Array.from({ length: 501 }, (_, k) => `i${k}`) }]), /x: items holds at most 500/);
  assert.match(refusal([{ ...base, run: ["t {item}"], items: ["m01", "a b"] }]), /x: an item is one plain word — letters, digits and \. _ - \/ : @ \+ = , — so it fills \{item\} the same in any shell: "a b" is not/);
  assert.match(refusal([{ ...base, run: ["t {item}"], items: ["m01;rm"] }]), /"m01;rm" is not/);
  assert.match(refusal([{ ...base, run: ["t {item}"], items: ["m01", "M01"] }]), /x: item m01 is given twice/);
  assert.match(refusal([{ ...base, run: ["t {item}"], items: "m01" }]), /x: items is a list of plain words/);
  assert.match(refusal([{ ...base, run: ["npm test"], writes: ["a.js"] }]), /x: a command task takes name, needs, run and items — writes is a worker's: leave it out/);
  assert.match(refusal([{ ...base, run: ["npm test"], goal: "g", steps: ["s"], check: ["npm test"] }]), /x: a command task takes name, needs, run and items — goal, steps and check are a worker's: leave them out/);
  assert.match(refusal([{ ...FIXER, needs: [], run: ["npm test"] }]), /fix: run and items are a command task's — give it by: command, or leave them out/);
  assert.match(refusal([{ ...base, run: ["npm test"], review: true }], { crew: LED }), /x: a command task takes name, needs, run and items — review is a worker's: leave it out/);
});

// (fails before: yes)
test("each command is vetted with each item filled in — the run's own words — and a `! ` is Filament's to read, not the vet's", () => {
  /** @type {any[]} */
  const seen = [];
  const r = add([{ id: "mut", name: "Kill", by: "command", run: ["node apply.js {item}", "! node --test"], items: ["m01", "m02"] }], { vet: (/** @type {string[]} */ c, /** @type {string} */ field) => (seen.push([field, ...c]), null) });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(seen, [["run", "node apply.js m01", "node --test", "node apply.js m02"]]);
  assert.deepEqual(tg.commandRuns(r.graph.tasks[0]), [
    { item: "m01", steps: [{ command: "node apply.js m01", invert: false }, { command: "node --test", invert: true }] },
    { item: "m02", steps: [{ command: "node apply.js m02", invert: false }, { command: "node --test", invert: true }] },
  ]);
  const vet = (/** @type {string[]} */ c) => (c.includes("rm m02") ? "run's `rm m02` is refused by this session's rule Bash(rm:*): leave it out" : null);
  assert.match(refusal([{ id: "mut", name: "Kill", by: "command", run: ["rm {item}"], items: ["m01", "m02"] }], { vet }), /mut: run's `rm m02` is refused by this session's rule Bash\(rm:\*\): leave it out/);
  assert.deepEqual([tg.commandPassed(0, false), tg.commandPassed(1, false), tg.commandPassed(1, true), tg.commandPassed(0, true), tg.commandPassed(null, true), tg.commandPassed(null, false)], [true, false, true, false, false, false], "no exit never passes, inverted or not");
});

// (fails before: yes)
test("a ready command task is a command job — not while the graph is held — and a task that needs it waits for it", () => {
  const g = add([MUT, FIXER]).graph;
  assert.deepEqual(tg.jobs(g), [{ id: "mut", kind: "command" }]);
  assert.deepEqual(tg.jobs(tg.hold(g, T0)), []);
  const s = /** @type {any} */ (tg.commandStarted(g, "mut", 2000, 3));
  assert.deepEqual(tg.jobs(s), []);
  const done = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 0), RUN("m02", 0), RUN("m03", 0)], of: 3, lanes: 3, ms: 4200, cut: null }, 9000));
  assert.deepEqual(tg.jobs(done.graph), [{ id: "fix", kind: "start" }]);
});

// (fails before: yes)
test("a command task runs, keeps its progress, and ends done when every run passed — told with its table", () => {
  const g = add([MUT]).graph;
  assert.equal(tg.commandStarted(g, "nope", 2000, 1), null);
  const s = /** @type {any} */ (tg.commandStarted(g, "mut", 2000, 3));
  const t = s.tasks[0];
  assert.deepEqual([t.state, t.tries, t.startedAt, t.agent, t.progress], ["running", 1, 2000, null, { ran: 0, passed: 0, of: 3, lanes: 3 }]);
  assert.equal(tg.busy(s), true, "the turn owes it while it runs");
  assert.deepEqual(tg.agentsAtWork(s), []);
  const p = /** @type {any} */ (tg.commandProgress(s, "mut", { ran: 2, passed: 1, of: 3, lanes: 3 }));
  assert.deepEqual(p.tasks[0].progress, { ran: 2, passed: 1, of: 3, lanes: 3 });
  assert.match(call(p, { action: "show" }, { at: T0, crew: "agent" }).text ?? "", /mut "Try the mutants" — running: 2 of 3 runs, 1 passed · by command/);
  // (fails before: yes — d-send's third follow-up: "on 3 lanes", where the Plan page says "3 at a time": a lane is a
  // folder or worktree a chat works in, and nothing else)
  assert.match(call(p, { action: "show", id: "mut" }, { at: T0, crew: "agent" }).text ?? "", /^Runs: 2 of 3 so far, 1 passed, 3 at a time$/m);
  assert.match(tg.startedText(s, ["mut"]), /^Filament started mut's runs 3 at a time\. /);
  assert.match(tg.startedText(/** @type {any} */ (tg.commandStarted(g, "mut", 2000, 1)), ["mut"]), /^Filament started mut's runs one at a time\. /);
  const green = /** @type {any} */ (tg.commandEnded(p, "mut", { ran: true, runs: [RUN("m01", 0), RUN("m02", 0), RUN("m03", 0)], of: 3, lanes: 3, ms: 4200, cut: null }, 9000));
  assert.equal(green.state, "done");
  const d = green.graph.tasks[0];
  assert.deepEqual([d.state, d.endedAt, d.progress, d.result.runs.length, d.result.lanes, d.result.ms], ["done", 9000, null, 3, 3, 4200]);
  assert.deepEqual(d.result.runs.map((/** @type {any} */ r) => r.output), ["", "", ""], "a run that passed keeps no output");
  assert.match(tg.endText(green.graph, "mut", { crew: "agent" }), /^\[Filament: task mut "Try the mutants" is done: Filament ran it — 3 runs, 3 at a time, every one passed \(4 s\)\.\nIts one task is done\. Before you close, weigh what was done against the goal "A mutation pass": [^\n]*\(tasks close\)\.\]$/);
  const tsc = add([{ id: "tsc", name: "Typecheck", by: "command", run: ["npx tsc --noEmit", "npm test"] }]).graph;
  const one = /** @type {any} */ (tg.commandEnded(/** @type {any} */ (tg.commandStarted(tsc, "tsc", 2000, 1)), "tsc", { ran: true, runs: [RUN(null, 0, { ms: 8000 })], of: 1, lanes: 1, ms: 8000, cut: null }, 9000));
  assert.match(tg.endText(one.graph, "tsc", { crew: "agent" }), /is done: Filament ran it, and it passed: `npx tsc --noEmit`, then `npm test` \(8 s\)\./);
});

// (fails before: yes)
test("a command task with runs that did not pass fails, naming each, the end of the first one's output, and the planner's choices", () => {
  const s = /** @type {any} */ (tg.commandStarted(add([MUT]).graph, "mut", 2000, 3));
  const red = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 0), RUN("m02", 1), RUN("m03", 0, { command: "node --test", invert: true, passed: false, output: "all 9 passed" })], of: 3, lanes: 3, ms: 4200, cut: null }, 9000));
  assert.equal(red.state, "failed");
  const t = red.graph.tasks[0];
  assert.deepEqual([t.state, t.why, t.failures], ["failed", "2 of 3 runs did not pass: items m02 and m03", { cause: "runs", times: 1 }]);
  assert.deepEqual(t.result.runs.map((/** @type {any} */ r) => r.output), ["", "FAIL m02", "all 9 passed"]);
  const said = tg.endText(red.graph, "mut", { crew: "agent" });
  assert.equal(
    said,
    [
      '[Filament: task mut "Try the mutants" failed: 2 of 3 runs did not pass: items m02 and m03.',
      "Did not pass:",
      "- m02: `node try.js m02` exit 1 (2 s)",
      "- m03: `node --test` exit 0, where it was to fail (2 s)",
      "The end of m02's output:",
      "FAIL m02",
      "Your choices: take it as done — tasks done with its id and a summary — when the runs that did not pass are what you ran it to find (the mutants that survived, say): the tasks that need it start; run it again — tasks start with its id, and Filament runs every item again on your folder as it stands; change its run or items — tasks change (the items that did not pass, say), then start it; re-plan around it — change, add or drop tasks; or drop it.",
      "Now: 0 of 1 done · failed: mut.]",
    ].join("\n"),
  );
  const tsc = add([{ id: "tsc", name: "Typecheck", by: "command", run: ["npm test"] }]).graph;
  const one = /** @type {any} */ (tg.commandEnded(/** @type {any} */ (tg.commandStarted(tsc, "tsc", 2000, 1)), "tsc", { ran: true, runs: [RUN(null, 1, { ms: 6000, output: "1 failing" })], of: 1, lanes: 1, ms: 6000, cut: null }, 9000));
  assert.match(tg.endText(one.graph, "tsc", { crew: "agent" }), /^\[Filament: task tsc "Typecheck" failed: its run did not pass: `npm test` exit 1 \(6 s\)\.\nThe end of its output:\n1 failing\nYour choices: take it as done — tasks done with its id and a summary — when its failing is what you ran it to find: the tasks that need it start; run it again/);
  const not = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: false, words: "this folder is not in git, so Filament has no copy of it to run the commands in" }, 9000));
  assert.equal(not.graph.tasks[0].why, "Filament could not run it: this folder is not in git, so Filament has no copy of it to run the commands in");
  const cut = /** @type {any} */ (tg.restartCut(s, 9000));
  assert.deepEqual([cut.ids, cut.graph.tasks[0].state, cut.graph.tasks[0].why], [["mut"], "failed", "cut by a Filament restart"]);
});

// (fails before: yes — V2-3's drive (TG2-D73): a mutation pass's first run failed by its survivors, as such a run does;
// its planner's done was refused, and it dropped the task to start the work on them)
test("done takes a failed command task as done when what did not pass is what it was run to find: its table kept, the tasks that need it start — refused while it waits or runs, and when it did not run or its runs did not all end", () => {
  const g = add([MUT, FIXER]).graph;
  const s = /** @type {any} */ (tg.commandStarted(g, "mut", 2000, 3));
  const done = (/** @type {any} */ graph, /** @type {any} */ crew = "agent") => call(graph, { action: "done", id: "mut", summary: "m02 and m03 survived: the tests to write" }, { at: 9500, crew });
  assert.equal(done(g).error, "mut is a command task: Filament ends it by its runs — it has not run yet");
  assert.equal(done(s).error, "mut is a command task: Filament runs it now, and its runs end it");
  const red = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 0), RUN("m02", 1), RUN("m03", 1)], of: 3, lanes: 3, ms: 4200, cut: null }, 9000)).graph;
  assert.match(tg.endText(red, "mut", { crew: "agent" }), /\nYour choices: take it as done — tasks done with its id and a summary — when the runs that did not pass are what you ran it to find \(the mutants that survived, say\): the tasks that need it start; run it again — tasks start with its id/);
  assert.deepEqual(tg.jobs(red), [], "a task that needs a failed one waits");
  const took = done(red);
  assert.equal(took.ok, true, took.error);
  assert.match(took.text ?? "", /^Taken as done: mut — 2 of its 3 runs did not pass, kept in its table\. Ready now: fix\. /);
  const t = took.graph.tasks[0];
  assert.deepEqual([t.state, t.summary, t.why, t.endedAt, t.result.runs.filter((/** @type {any} */ r) => !r.passed).map((/** @type {any} */ r) => r.item)], ["done", "m02 and m03 survived: the tests to write", "", 9500, ["m02", "m03"]]);
  assert.deepEqual(tg.jobs(took.graph), [{ id: "fix", kind: "start" }]);
  const shown = call(took.graph, { action: "show", id: "mut" }, { at: T0, crew: "agent" }).text ?? "";
  assert.match(shown, /\nTaken as done: m02 and m03 survived: the tests to write\n/);
  assert.match(shown, /Runs: 3, 3 at a time, 1 passed, 2 not \(4 s\)/);
  assert.equal(done(took.graph).error, "mut is done already");
  // A lead takes one the same way.
  const led = /** @type {any} */ (tg.commandEnded(/** @type {any} */ (tg.commandStarted(add([MUT], { crew: LED }).graph, "mut", 2000, 3)), "mut", { ran: true, runs: [RUN("m01", 1), RUN("m02", 0), RUN("m03", 0)], of: 3, lanes: 3, ms: 4200, cut: null }, 9000)).graph;
  assert.equal(done(led, LED).ok, true);
  // Not run, or its runs short of its items: nothing to take.
  const not = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: false, words: "this folder is not in git, so Filament has no copy of it to run the commands in" }, 9000)).graph;
  assert.equal(done(not).error, "mut is a command task whose runs did not all end: start it to run it again, or drop it");
  const short = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 1)], of: 3, lanes: 3, ms: 4200, cut: null }, 9000)).graph;
  assert.equal(done(short).error, "mut is a command task whose runs did not all end: start it to run it again, or drop it");
  // A failure with no run that did not pass offers no such choice.
  assert.doesNotMatch(tg.endText(not, "mut", { crew: "agent" }), /take it as done/);
});

// (fails before: yes)
test("only the first twenty runs that did not pass keep the end of their output, twenty lines each; a show lists every run that did not pass", () => {
  const items = Array.from({ length: 30 }, (_, k) => `m${String(k + 1).padStart(2, "0")}`);
  const g = add([{ ...MUT, items }]).graph;
  const long = Array.from({ length: 30 }, (_, k) => `line ${k + 1}`).join("\n");
  const r = /** @type {any} */ (tg.commandEnded(/** @type {any} */ (tg.commandStarted(g, "mut", 2000, 8)), "mut", { ran: true, runs: items.map((i) => RUN(i, 1, { output: long })), of: 30, lanes: 8, ms: 120_000, cut: null }, 9000));
  const runs = r.graph.tasks[0].result.runs;
  assert.equal(runs.filter((/** @type {any} */ x) => x.output).length, 20);
  assert.equal(runs[0].output.split("\n").length, 20);
  assert.match(runs[0].output, /^line 11\n/);
  assert.equal(r.graph.tasks[0].why, "30 of 30 runs did not pass: items m01, m02, m03, m04, m05, m06, m07, m08, m09, m10 and 20 more");
  const shown = call(r.graph, { action: "show", id: "mut" }, { at: T0, crew: "agent" }).text ?? "";
  assert.match(shown, /By: Filament itself, no model: it runs the commands once for each item, in copies of your folder, once its needs are done/);
  assert.match(shown, /Run: `node try\.js \{item\}`/);
  assert.match(shown, /Items: 30 — m01, m02, m03, m04, m05, m06, m07, m08, m09, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, and 10 more/);
  assert.match(shown, /Runs: 30, 8 at a time, 0 passed, 30 not \(2 min\)/);
  assert.match(shown, /- m30: `node try\.js m30` exit 1 \(2 s\)/);
  assert.match(shown, /The end of m01's output:\nline 11/);
});

// (fails before: yes)
test("the developer's stop sets a command task aside with what ran so far; a start runs it whole again — a note or fresh refused — done is refused, and a change waits for its end", () => {
  const s = /** @type {any} */ (tg.commandStarted(add([MUT]).graph, "mut", 2000, 3));
  assert.match(call(s, { action: "change", tasks: [{ id: "mut", items: ["m01"] }] }, { at: T0, crew: "agent" }).error ?? "", /mut is being run by Filament now — wait for its end, or drop it/);
  assert.equal(call(s, { action: "done", id: "mut", summary: "x" }, { at: T0, crew: "agent" }).error, "mut is a command task: Filament runs it now, and its runs end it");
  const st = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 0), RUN("m02", 1)], of: 3, lanes: 3, ms: 900, cut: "developer" }, 9000));
  assert.equal(st.state, "stopped");
  const t = st.graph.tasks[0];
  assert.deepEqual([t.state, t.stopped, t.startedAt, t.result.cut, t.result.runs.length], ["waiting", "developer", null, true, 2]);
  assert.deepEqual(tg.jobs(st.graph), [], "stopped, it waits for the planner");
  assert.match(tg.endText(st.graph, "mut", { crew: "agent" }), /^\[Filament: the developer stopped task mut "Try the mutants" after 2 of 3 runs \(1 did not pass so far: item m02\)\. The task waits again: after your next tasks call Filament runs it whole again\.\n/);
  assert.match(call(st.graph, { action: "start", ids: ["mut"], note: "again" }, { at: T0, crew: "agent" }).error ?? "", /mut is a command task: no worker reads a note, and none is fresh — leave note and fresh out/);
  const again = call(st.graph, { action: "start", ids: ["mut"] }, { at: T0, crew: "agent" });
  assert.equal(again.ok, true, again.error);
  assert.match(again.text ?? "", /Started mut again: Filament runs every item again on your folder as it stands, once its needs are done and there is room\./);
  assert.deepEqual([again.graph?.tasks[0].state, again.graph?.tasks[0].stopped], ["waiting", false]);
  assert.deepEqual(tg.jobs(again.graph ?? null), [{ id: "mut", kind: "command" }]);
  const released = /** @type {any} */ (tg.release(st.graph, { crew: "agent", resumable: () => null }));
  assert.equal(released.tasks[0].stopped, false, "a tasks call lets go of the stop first");
  assert.match(call(released, { action: "start", ids: ["mut"] }, { at: T0, crew: "agent" }).text ?? "", /Started mut again: Filament runs every item again/);
  const failed = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 1)], of: 3, lanes: 3, ms: 900, cut: null }, 9000)).graph;
  const back = call(failed, { action: "start", ids: ["mut"] }, { at: T0, crew: "agent" });
  assert.match(back.text ?? "", /Set mut to run again: Filament runs every item again on your folder as it stands, once its needs are done and there is room\./);
  const changed = call(failed, { action: "change", tasks: [{ id: "mut", items: ["m01"] }] }, { at: T0, crew: "agent" });
  assert.equal(changed.ok, true, changed.error);
  assert.deepEqual(changed.graph?.tasks[0].items, ["m01"]);
  const away = call(failed, { action: "change", tasks: [{ id: "mut", by: "you" }] }, { at: T0, crew: "agent" });
  assert.equal(away.ok, true, away.error);
  const was = /** @type {any} */ (away.graph?.tasks[0]);
  assert.deepEqual([was.by, "run" in was, "items" in was, "result" in was], ["you", false, false, false], "a task that is no command task any more keeps none of its fields");
});

/**
 * Two sessions kept in memory, a registry whose command runs answer as the test resolves them, and the runner over both
 * with `lanes` lanes. @param {{ slots?: number, lanes?: number }} [o]
 */
function rig({ slots = 0, lanes = 4 } = {}) {
  /** @type {Map<string, any>} */
  const chains = new Map([["c1", { id: "c1", meta: {} }], ["c2", { id: "c2", meta: {} }]]);
  /** @type {any[]} */
  const told = [];
  /** @type {any[]} */
  const published = [];
  /** @type {{ chainId: string, runs: any[], o: any, done: (v: any) => void }[]} */
  const calls = [];
  const state = { t: 1000 };
  const registry = {
    launch: () => ({ ok: false, error: "no model here" }),
    slots: () => slots,
    resumable: () => null,
    /** @param {string} chainId @param {any} d */
    tell: (chainId, d) => told.push({ chainId, ...d }),
    stop: () => ({ ok: true }),
    guard: () => {},
    checkProblem: () => null,
    runProblem: () => null,
    /** @param {string} chainId @param {any[]} runs @param {any} o */
    runCommands: (chainId, runs, o) => new Promise((done) => calls.push({ chainId, runs, o, done })),
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
  const make = () => createGraphRunner({ archive, registry: /** @type {any} */ (registry), events: { publish: (topic, e) => published.push({ topic, e }) }, crew: () => "agent", log: () => {}, now: () => state.t, lanes });
  const runner = make();
  /** @param {string} chainId */
  const graph = (chainId) => chains.get(chainId).meta.graph;
  return { runner, calls, told, published, state, graph, chains, make };
}
/** @param {string} chainId */
const TURN = (chainId) => ({ runId: `turn-${chainId}`, cwd: "/p", mode: null, model: "m", thinking: null, team: null });

// (fails before: yes)
test("the runner starts a command task with no model slot free, on as many lanes as it has runs and the lanes left — shared by every session — and one with none left waits for a lane", async () => {
  const r = rig({ slots: 0, lanes: 4 });
  r.runner.attach("c1", TURN("c1"));
  r.runner.attach("c2", TURN("c2"));
  const a = r.runner.apply("c1", { action: "add", goal: "Mutants", tasks: [MUT] }, { crew: "agent" });
  assert.equal(a.ok, true);
  assert.equal(r.calls.length, 1);
  assert.deepEqual([r.calls[0].chainId, r.calls[0].o.lanes, r.calls[0].runs.map((/** @type {any} */ x) => x.item)], ["c1", 3, ["m01", "m02", "m03"]]);
  assert.match(r.calls[0].o.id, /^cmd-mut$/);
  assert.equal(r.graph("c1").tasks[0].state, "running");
  r.runner.apply("c2", { action: "add", goal: "Shards", tasks: [{ id: "shards", name: "Test shards", by: "command", run: ["node --test {item}"], items: ["a.test.js", "b.test.js", "c.test.js"] }] }, { crew: "agent" });
  assert.deepEqual([r.calls.length, r.calls[1].o.lanes], [2, 1], "one lane was left");
  r.runner.apply("c2", { action: "add", tasks: [{ id: "tsc", name: "Typecheck", by: "command", run: ["npx tsc --noEmit"] }] }, { crew: "agent" });
  assert.equal(r.calls.length, 2, "no lane is left: it waits");
  assert.equal(r.graph("c2").tasks[1].state, "waiting");
  r.calls[0].done({ ran: true, runs: [RUN("m01", 0), RUN("m02", 0), RUN("m03", 0)], of: 3, lanes: 3, ms: 4000, stopped: false });
  await until(() => r.calls.length === 3, "the waiting task to start on a lane the first let go");
  assert.deepEqual([r.calls[2].chainId, r.calls[2].o.lanes, r.calls[2].runs], ["c2", 1, [{ item: null, steps: [{ command: "npx tsc --noEmit", invert: false }] }]]);
  assert.equal(r.graph("c1").tasks[0].state, "done");
  assert.match(r.told.find((x) => x.chainId === "c1")?.text ?? "", /task mut "Try the mutants" is done: Filament ran it — 3 runs, 3 at a time, every one passed/);
});

// (fails before: yes)
test("while a command task runs its progress is kept, at most every two seconds, the turn owes it, and its end is told", async () => {
  const r = rig({ lanes: 2 });
  r.runner.attach("c1", TURN("c1"));
  r.runner.apply("c1", { action: "add", goal: "Mutants", tasks: [MUT, FIXER] }, { crew: "agent" });
  const owes = r.runner.owes("c1");
  assert.ok(owes, "the turn owes the running command task");
  const { o } = r.calls[0];
  o.progress(RUN("m01", 0));
  assert.deepEqual(r.graph("c1").tasks[0].progress, { ran: 0, passed: 0, of: 3, lanes: 2 }, "not two seconds yet");
  r.state.t += 2000;
  o.progress(RUN("m02", 1));
  assert.deepEqual(r.graph("c1").tasks[0].progress, { ran: 2, passed: 1, of: 3, lanes: 2 });
  r.calls[0].done({ ran: true, runs: [RUN("m01", 0), RUN("m02", 1), RUN("m03", 0)], of: 3, lanes: 2, ms: 4000, stopped: false });
  await owes;
  assert.equal(r.graph("c1").tasks[0].state, "failed");
  assert.match(r.told[0].text, /task mut "Try the mutants" failed: 1 of 3 runs did not pass: item m02\./);
  assert.deepEqual([r.told[0].task, r.told[0].from, r.told[0].spends], ["mut", "", []]);
});

// (fails before: yes)
test("the developer's stop cuts a command task's runs — it waits again, stopped — a drop or a close cuts them and keeps nothing, and Filament stopping fails it", async () => {
  const r = rig({ lanes: 2 });
  r.runner.attach("c1", TURN("c1"));
  r.runner.apply("c1", { action: "add", goal: "Mutants", tasks: [MUT] }, { crew: "agent" });
  r.runner.stop("c1");
  assert.equal(r.calls[0].o.signal.aborted, true);
  r.calls[0].done({ ran: true, runs: [RUN("m01", 0), RUN("m02", null, { output: "", stopped: true })], of: 3, lanes: 2, ms: 900, stopped: true });
  await until(() => r.told.length === 1, "the stop to be told");
  assert.deepEqual([r.graph("c1").tasks[0].state, r.graph("c1").tasks[0].stopped], ["waiting", "developer"]);
  assert.match(r.told[0].text, /the developer stopped task mut "Try the mutants" after 1 of 3 runs/);
  r.runner.apply("c1", { action: "start", ids: ["mut"] }, { crew: "agent" });
  assert.equal(r.calls.length, 2, "a start runs it whole again");
  assert.equal(r.calls[1].runs.length, 3);
  r.runner.apply("c1", { action: "drop", ids: ["mut"], reason: "not needed" }, { crew: "agent" });
  assert.equal(r.calls[1].o.signal.aborted, true);
  r.calls[1].done({ ran: true, runs: [], of: 3, lanes: 2, ms: 10, stopped: true });
  await new Promise((go) => setImmediate(go));
  assert.deepEqual([r.graph("c1").tasks[0].state, r.told.length], ["dropped", 1], "a dropped one's end keeps nothing and tells nothing");
  r.runner.apply("c1", { action: "add", tasks: [{ ...MUT, id: "mut2" }] }, { crew: "agent" });
  r.runner.apply("c1", { action: "close", reason: "done enough" }, { crew: "agent" });
  assert.equal(r.calls[2].o.signal.aborted, true, "a close cuts it too");
  r.calls[2].done({ ran: true, runs: [], of: 3, lanes: 2, ms: 10, stopped: true });
  const s = rig({ lanes: 2 });
  s.runner.attach("c1", TURN("c1"));
  s.runner.apply("c1", { action: "add", goal: "Mutants", tasks: [MUT] }, { crew: "agent" });
  s.runner.shutdown();
  assert.equal(s.calls[0].o.signal.aborted, true);
  s.calls[0].done({ ran: true, runs: [RUN("m01", 0)], of: 3, lanes: 2, ms: 900, stopped: true });
  await until(() => s.graph("c1").tasks[0].state === "failed", "Filament stopping to fail it");
  assert.equal(s.graph("c1").tasks[0].why, "Filament could not run it: Filament stopped as it ran it");
});

// (fails before: yes)
test("the developer's own Run again, from the page, runs a failed command task whole; one their stop set aside runs again at the next tasks call", async () => {
  const r = rig({ lanes: 2 });
  r.runner.attach("c1", TURN("c1"));
  r.runner.apply("c1", { action: "add", goal: "Mutants", tasks: [MUT] }, { crew: "agent" });
  r.calls[0].done({ ran: true, runs: [RUN("m01", 1), RUN("m02", 0), RUN("m03", 0)], of: 3, lanes: 2, ms: 900, stopped: false });
  await until(() => r.graph("c1").tasks[0].state === "failed", "the task to fail");
  const back = /** @type {any} */ (r.runner.sendBack("c1", "mut"));
  assert.equal(back.ok, true, back.error);
  assert.deepEqual([back.waits, back.resumes, r.calls.length], [null, null, 2]);
  assert.match(r.told.at(-1).text, /^\[Filament: the developer did this themselves, from the page — Set mut to run again: Filament runs every item again/);
  r.runner.stop("c1");
  r.calls[1].done({ ran: true, runs: [RUN("m01", 0)], of: 3, lanes: 2, ms: 900, stopped: true });
  await until(() => r.graph("c1").tasks[0].stopped === "developer", "the stop to set it aside");
  r.runner.apply("c1", { action: "show" }, { crew: "agent" });
  assert.equal(r.calls.length, 3, "a tasks call lets go of the stop, and it runs again by itself");
});

/** A repository whose try.js passes for an item but "bad", and says LEAK where an earlier item's file stayed. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cmdtask-"));
  made.push(dir);
  const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "core.autocrlf", "false");
  writeFileSync(
    join(dir, "try.js"),
    'const fs = require("fs");\nconst item = process.argv[2];\nif (fs.existsSync("leak.txt")) { console.log("LEAK " + fs.readFileSync("leak.txt", "utf8")); process.exit(3); }\nfs.writeFileSync("leak.txt", item);\nfs.writeFileSync("tracked.txt", item);\nconsole.log((fs.existsSync("extra.txt") ? "EXTRA " : "") + "tried " + item);\nprocess.exit(item === "bad" ? 1 : 0);\n',
  );
  writeFileSync(join(dir, "tracked.txt"), "as committed\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  writeFileSync(join(dir, "extra.txt"), "uncommitted work\n");
  return { dir, git };
};
/**
 * A registry over `dir`, its settings `doc`; with `own: false` each command is recorded and answered by `answer`.
 * @param {string} dir @param {{ own?: boolean, answer?: (command: string) => any }} [o]
 */
const registryOver = (dir, { own = true, answer = () => ({ exit: 0, output: "ok", stopped: false }) } = {}) => {
  /** @type {{ command: string, root: string }[]} */
  const ran = [];
  const doc = { subagents: { pool: [{ model: "", seats: 8 }] }, loop: { permissions: "edit", rules: /** @type {any[]} */ ([]) } };
  const registry = createSubagentRegistry({
    config: () => ({ agentLoop: {} }),
    log: () => {},
    events: { publish: () => {} },
    runs: null,
    ...(own ? {} : { runCheck: async (/** @type {string} */ command, /** @type {{ root: string }} */ { root }) => (ran.push({ command, root }), answer(command)) }),
    context: /** @type {any} */ ({
      settings: () => structuredClone(doc),
      session: () => ({ cwd: dir, model: "m-session", projectId: null, client: "harness" }),
      view: async () => null,
      brief: async () => null,
      modelProblem: () => null,
      mark: () => null,
      folderProblem: () => null,
      exchangeEnded: () => {},
    }),
    call: async () => ({ ok: false, status: 500, json: null, id: "x", upstream: "m", retryAfter: null, shouldRetry: null }),
  });
  return { registry, ran, doc };
};
/** @param {string} item @param {boolean} [invert] */
const TRY = (item, invert = false) => ({ item, steps: [{ command: `node try.js ${item}`, invert }] });

// (fails before: yes — the registry ran no command task)
test("the registry runs each item in a lane of one snapshot — uncommitted work in it — resetting the lane between items, the folder untouched and the lanes gone after", async () => {
  const { dir, git } = repo();
  const r = registryOver(dir);
  /** @type {any[]} */
  const seen = [];
  const out = /** @type {any} */ (await r.registry.runCommands("c1", [TRY("a"), TRY("bad"), TRY("c"), TRY("bad", true)], { id: "cmd-mut", lanes: 1, signal: new AbortController().signal, progress: (/** @type {any} */ x) => seen.push(x.item) }));
  assert.equal(out.ran, true);
  assert.deepEqual(out.runs.map((/** @type {any} */ x) => [x.item, x.command, x.exit, x.passed, x.invert]), [["a", "node try.js a", 0, true, false], ["bad", "node try.js bad", 1, false, false], ["c", "node try.js c", 0, true, false], ["bad", "node try.js bad", 1, true, true]]);
  assert.match(out.runs[2].output, /^EXTRA tried c/, "the lane went back to the snapshot: no leak, the uncommitted file there");
  assert.deepEqual([out.of, out.lanes, out.stopped], [4, 1, false]);
  assert.deepEqual(seen.sort(), ["a", "bad", "bad", "c"]);
  assert.equal(existsSync(join(dir, "leak.txt")), false);
  assert.equal(git("status", "--porcelain").trim(), "?? extra.txt", "the folder is as it was");
  assert.deepEqual(copiesOf(dir), [["cmd-mut-0-c1", "free"]], "the lane's copy is given back free after");
});

// (fails before: yes)
test("the registry's lanes share the items, each run's commands go in order and stop at the first that does not pass", async () => {
  const { dir } = repo();
  const r = registryOver(dir, { own: false, answer: (c) => ({ exit: c.includes("bad") ? 1 : 0, output: c, stopped: false }) });
  const two = (/** @type {string} */ item) => ({ item, steps: [{ command: `node try.js ${item}`, invert: false }, { command: `node after.js ${item}`, invert: false }] });
  const out = /** @type {any} */ (await r.registry.runCommands("c1", [two("a"), two("bad"), two("c"), two("d")], { id: "cmd-two", lanes: 2, signal: new AbortController().signal }));
  assert.deepEqual(out.runs.map((/** @type {any} */ x) => [x.item, x.command, x.passed]), [["a", "node after.js a", true], ["bad", "node try.js bad", false], ["c", "node after.js c", true], ["d", "node after.js d", true]]);
  assert.equal(r.ran.some((x) => x.command === "node after.js bad"), false, "nothing after the first that did not pass");
  const roots = [...new Set(r.ran.map((x) => x.root))];
  assert.equal(roots.length, 2, "two lanes");
  assert.equal(roots.includes(dir), false);
});

// (fails before: yes)
test("no command task runs outside git, in a read-only session, or where a rule came since — each said — and the registry vets a run's commands in its words", async () => {
  const plain = mkdtempSync(join(tmpdir(), "filament-cmdtask-plain-"));
  made.push(plain);
  const sig = new AbortController().signal;
  assert.deepEqual(await registryOver(plain).registry.runCommands("c1", [TRY("a")], { id: "cmd-x", lanes: 1, signal: sig }), { ran: false, words: "this folder is not in git, so Filament has no copy of it to run the commands in" });
  const { dir } = repo();
  const r = registryOver(dir);
  r.doc.loop.permissions = "read-only";
  assert.deepEqual(await r.registry.runCommands("c1", [TRY("a")], { id: "cmd-x", lanes: 1, signal: sig }), { ran: false, words: "the session is read-only, so Filament runs no command in it" });
  assert.equal(r.registry.runProblem("c1", ["npm test"]), "this session is read-only, so Filament runs no command in it: leave the command task out");
  r.doc.loop.permissions = "edit";
  r.doc.loop.rules = [{ tool: "bash", pattern: "node try.js a", verdict: "deny" }];
  const ruled = /** @type {any} */ (await r.registry.runCommands("c1", [TRY("a")], { id: "cmd-x", lanes: 1, signal: sig }));
  assert.equal(ruled.ran, false);
  assert.match(ruled.words, /^this session's rule .+ refuses `node try\.js a`$/);
  assert.match(r.registry.runProblem("c1", ["node try.js a"]) ?? "", /^run's `node try\.js a` is refused by this session's rule .+: leave it out$/);
  r.doc.loop.rules = [{ tool: "bash", pattern: "node try.js a", verdict: "ask" }];
  assert.match(r.registry.runProblem("c1", ["node try.js a"]) ?? "", /^run's `node try\.js a` asks first by this session's rule .+, and Filament runs a command task without asking: leave it out$/);
  r.doc.loop.rules = [];
  assert.match(r.registry.runProblem("c1", ["npm install left-pad"]) ?? "", /^run's `npm install left-pad` installs packages, and Filament's copies of the folder use its installed ones: leave it out/);
  assert.match(r.registry.runProblem("c1", ["node a.js; echo done"]) ?? "", /^run's `node a\.js; echo done` joins its parts with ;, where a part can fail and the run still pass: join parts with && alone, or give each command its own entry/);
  assert.match(r.registry.runProblem("c1", ["node a.js > out.txt"]) ?? "", /^run's `node a\.js > out\.txt` redirects or substitutes: name the command alone — Filament keeps the end of its output itself/);
  assert.match(r.registry.runProblem("c1", [`node ${join(dir, "try.js")} a`]) ?? "", /names your folder .+: Filament runs it in a copy of the folder, where the same files are at the same paths — use paths relative to the folder/);
  assert.equal(r.registry.runProblem("c1", ["node try.js a", 'node -e "a; b"']), null);
});

// (fails before: yes)
test("the tasks tool offers command tasks to the agent and a lead — by command, run and items — and a coding agent's own graph has none", () => {
  for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL]) {
    const p = /** @type {any} */ (tool.input_schema.properties.tasks.items.properties);
    assert.ok(p.by.enum.includes("command"), tool.description.slice(0, 40));
    assert.match(p.by.description, /command/);
    assert.deepEqual([p.run.type, p.run.maxItems, p.items.type, p.items.maxItems], ["array", 5, "array", 500]);
    assert.match(p.run.description, /\{item\}/);
  }
  const coder = /** @type {any} */ (CODER_TASKS_TOOL.input_schema.properties.tasks.items.properties);
  assert.deepEqual(["by" in coder, "run" in coder, "items" in coder], [false, false, false]);
  assert.match(call(null, { action: "add", goal: "g", tasks: [{ ...MUT }] }, { at: T0, crew: "agent", solo: true }).error ?? "", /by, run, items are no fields of a task/);
  assert.equal(PROMPT_VERSION, 129);
});

// (fails before: yes — V2-3's drive (TG2-D72): the tool's words named three who-does-its, by's field alone named command,
// and the planner gave the mutation pass to itself, its tries in six background shells)
test("the tasks tool's words and the graph's section say when a task is a command task — the agent's and a lead's — and a coding agent's say nothing of one", () => {
  for (const tool of [TASKS_TOOL, TASKS_READS_TOOL, LEAD_TASKS_TOOL]) {
    assert.match(tool.description, /or command, which Filament runs itself with no model, for mechanical work such as a mutation pass|Or command, which no worker does: Filament runs the task itself, for mechanical work such as a mutation pass/, tool.description.slice(0, 40));
    assert.match(tool.description, /A command task gives run \(one to five commands, in order\) and may give items \(up to 500 plain words, one run each, each filling \{item\} in run\)/);
    assert.match(tool.description, /its end names each run that did not pass, with the end of its output\./);
  }
  // And done takes a failed one as done (TG2-D73).
  for (const tool of [TASKS_TOOL, TASKS_READS_TOOL]) assert.match(tool.description, /done — id and summary, what was done, and evidence where the task has acceptance and no check: what shows that holds \(a test's output, a command you ran, what you saw\) \(a failed command task too, taken as done when what did not pass is what it was run to find\), or tasks, each an id with its own summary and evidence, to mark several;/);
  assert.match(LEAD_TASKS_TOOL.description, /done: id and summary, and evidence where the task has acceptance and no check: what shows that holds \(a test's output, a command you ran, what you saw\), only for a task the agent planned for itself before you led, or a failed command task, taken as done when what did not pass is what it was run to find\. keep: /);
  assert.doesNotMatch(CODER_TASKS_TOOL.description, /command task|or command|mutation/);
  const line = /^- Mechanical work — a mutation pass, test shards, a typecheck, builds — needs no model: give it to command\. .* When those are what you ran it to find — the mutants that survived, say — take it as done with tasks done, and the tasks that need it start\.$/m;
  const lead = { name: "Architect", persona: "You lead." };
  for (const args of [{ graph: true }, { graph: true, supervise: true }, { graph: true, lead }]) assert.match(systemPromptFor({ root: "/p", delegateRead: false, ...args }), line, JSON.stringify(args));
  for (const args of [{}, { lead }]) assert.doesNotMatch(systemPromptFor({ root: "/p", delegateRead: false, ...args }), line, `${JSON.stringify(args)}: no graph, no line`);
});

// (fails before: yes)
test("a saved agent's tag is never command: a team's graph names command tasks with it", () => {
  const store = createAgentCardStore({ dataDir: null });
  assert.throws(() => store.create({ tag: "command", name: "Runner", goodFor: "Running things", thinks: "You run things." }), (/** @type {any} */ e) => /`@command` names Filament's command tasks in a team's task graph; give the agent another tag\./.test(e.message));
});

// (fails before: yes)
test("the Plan view's card draws a command task: who runs it, its run and items, its runs as they go and as they ended, each that did not pass", () => {
  const g = add([MUT]).graph;
  // (fails before: yes — the card said "on 3 lanes" and "once … a lane is free" of how many runs go at once: a lane is
  // a folder or worktree a chat works in, on the Space's page, and nothing else — the owner's of 11-12)
  assert.match(textOf(drawGraph(tg.graphView(g), { h: fakeH, now: T0, chosen: "mut" }).el), /\|Filament runs it once its needs are done and there is room; its table shows here\.\|/);
  const s = /** @type {any} */ (tg.commandProgress(/** @type {any} */ (tg.commandStarted(g, "mut", T0, 3)), "mut", { ran: 1, passed: 1, of: 3, lanes: 3 }));
  const going = textOf(drawGraph(tg.graphView(s), { h: fakeH, now: T0 + 5000, chosen: "mut" }).el);
  // (E41 P4: who runs it is the card's line under its name; its runs come before its details)
  assert.match(going, /\|Filament runs its commands — no model · started just now\|/);
  assert.match(going, /\|Its runs\|Runs\|1 of 3 so far, 1 passed, 3 at a time\|Run\|/);
  const alone = /** @type {any} */ (tg.commandProgress(/** @type {any} */ (tg.commandStarted(g, "mut", T0, 3)), "mut", { ran: 1, passed: 1, of: 3, lanes: 1 }));
  assert.match(textOf(drawGraph(tg.graphView(alone), { h: fakeH, now: T0 + 5000, chosen: "mut" }).el), /\|Runs\|1 of 3 so far, 1 passed, one at a time\|/);
  assert.match(going, /\|Run\|node try\.js \{item\}\|/);
  assert.match(going, /\|Items\|3 — m01, m02, m03$/, "the card's last row: an empty one is not drawn");
  const red = /** @type {any} */ (tg.commandEnded(s, "mut", { ran: true, runs: [RUN("m01", 0), RUN("m02", 1), RUN("m03", 0)], of: 3, lanes: 3, ms: 4200, cut: null }, T0 + 9000)).graph;
  const ended = textOf(drawGraph(tg.graphView(red), { h: fakeH, now: T0 + 60_000, chosen: "mut" }).el);
  assert.match(ended, /\|Runs\|3 runs, 3 at a time, 2 passed, 1 not \(4 s\)\|/);
  assert.doesNotMatch(`${going}${ended}`, /\blanes?\b/, "no lane on the Plan page");
  assert.match(ended, /m02: node try\.js m02 → exit 1 \(2 s\)/);
  assert.match(ended, /FAIL m02/);
  // Taken as done (TG2-D73): the planner's line, and the runs that did not pass still listed.
  const took = call(red, { action: "done", id: "mut", summary: "m02 survived: a test to write" }, { at: T0 + 9500, crew: "agent" }).graph;
  const taken = textOf(drawGraph(tg.graphView(took), { h: fakeH, now: T0 + 60_000, chosen: "mut" }).el);
  assert.match(taken, /Taken as done/);
  assert.match(taken, /The agent took it as done, its runs as they ended: m02 survived: a test to write/);
  assert.match(taken, /m02: node try\.js m02 → exit 1 \(2 s\)/);
  assert.doesNotMatch(taken, /Run again/);
});
