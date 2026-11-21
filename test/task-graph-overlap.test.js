// @ts-check
// g1, the owner's of 11-09: "if all builders are running in their own worktree then at the end it would simply be
// resolving merge conflicts and that is the standard way of working in teams … if there is conflicts simply resolve and
// merge." Writes are a forecast: two tasks that could run at once may write one file, and the graph says where they
// meet — a merge point where one works in a copy of its own (whichever lands second merges three-way at its apply), the
// one folder where another hand works there beside it, nothing for two of the planner's own, which it does one at a
// time — once a set in an add's or a change's answer, whenever a show reads the graph, and on each task of the page's
// view (`mergesWith`, computed, never kept). The one guard is where it happens: the developer's side run refuses two in
// their folder at once that write one file. A running task of the planner's own may change its needs and who does it.
// And `needed_by` on an add makes existing tasks need the new one in the same call, checked with it as one graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTasks, graphView, helperTook, launched, showText, sideRun, whereText } from "../src/core/task-graph.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { MEMBERS as LED } from "./helpers/roster.js";

const AT = 1_000;
/** @param {Record<string, any>} [o] @returns {any} */
const opts = (o = {}) => ({ at: AT, crew: "agent", ...o });
/** One call that must go through. @param {any} g @param {any} input @param {Record<string, any>} [o] @returns {{ ok: true, graph: any, text: string, changed: boolean }} */
const ok = (g, input, o) => {
  const r = applyTasks(g, input, opts(o));
  assert.ok(r.ok, r.ok ? "" : r.error);
  return /** @type {any} */ (r);
};
/** One call that must be refused: its words, the graph left as it was. @param {any} g @param {any} input @param {Record<string, any>} [o] */
const no = (g, input, o) => {
  const before = JSON.stringify(g);
  const r = applyTasks(g, input, opts(o));
  assert.equal(r.ok, false, "refused");
  assert.equal(JSON.stringify(g), before, "the graph is left as it was");
  return r.ok ? "" : r.error;
};
/** @param {string} id @param {string[]} writes @param {Record<string, any>} [more] */
const own = (id, writes, more = {}) => ({ id, name: id.toUpperCase(), writes, ...more });
const BRIEF = { goal: "It is done", steps: ["Do it"], acceptance: "the check passes" };
/** A sub-agent's task, its brief a line each. @param {string} id @param {string[]} writes @param {Record<string, any>} [more] */
const sub = (id, writes, more = {}) => own(id, writes, { by: "sub-agent", ...BRIEF, ...more });
/** @param {any} g @param {string} id */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** Each task's merge points as the page reads them: id → [other, files, folder?]. @param {any} g */
const merges = (g) =>
  Object.fromEntries(/** @type {any} */ (graphView(g)).tasks.filter((/** @type {any} */ t) => t.mergesWith).map((/** @type {any} */ t) => [t.id, t.mergesWith.map((/** @type {any} */ m) => (m.folder ? [m.task, m.files, "folder"] : [m.task, m.files]))]));
const MERGES = ": whichever lands second merges three-way at its apply.";

// (fails before: yes — any two tasks that could run at once writing one file were refused, whoever did them)
test("two sub-agents' tasks may both write a file: they meet at a merge point, said once in the answer and on each task of the page's view", () => {
  const r = ok(null, { action: "add", goal: "g", tasks: [sub("t3", ["src/a.js", "src/b.js"]), sub("t5", ["src/a.js"])] });
  assert.ok(r.text.endsWith(`\nt3 and t5 both write src/a.js${MERGES}`), r.text);
  assert.deepEqual(merges(r.graph), { t3: [["t5", ["src/a.js"]]], t5: [["t3", ["src/a.js"]]] });
  assert.equal(task(r.graph, "t3").mergesWith, undefined, "computed for the page, never kept on the task");
  // A glob that names the file, and a folder: the narrower is what they share; two globs, both, and "may".
  const g = ok(null, { action: "add", goal: "g", tasks: [sub("t1", ["src/*.js"]), sub("t2", ["src/a.js"]), sub("t4", ["docs/"]), own("t6", ["docs/guide.md"])] });
  assert.ok(g.text.endsWith("\nt1 and t2 both write src/a.js; t4 and t6 both write docs/guide.md: whichever of each two lands second merges three-way at its apply."), g.text);
  const globs = ok(null, { action: "add", goal: "g", tasks: [sub("t1", ["src/*.js"]), sub("t2", ["src/**"])] });
  assert.ok(globs.text.endsWith(`\nt1 and t2 may both write src/*.js and src/**${MERGES}`), globs.text);
});

// (fails before: yes — the same)
test("the agent's own task and a sub-agent's meet; one that needs the other does not; a set is said once until it changes, and a show says it whenever it holds", () => {
  const g = ok(null, { action: "add", goal: "g", tasks: [own("t1", ["src/a.js"]), sub("t2", ["src/a.js"]), sub("t3", ["src/a.js"], { needs: ["t1"] })] });
  assert.deepEqual(merges(g.graph), { t1: [["t2", ["src/a.js"]]], t2: [["t1", ["src/a.js"]], ["t3", ["src/a.js"]]], t3: [["t2", ["src/a.js"]]] });
  assert.ok(g.text.endsWith("\nt1 and t2 both write src/a.js; t2 and t3 both write src/a.js: whichever of each two lands second merges three-way at its apply."), g.text);
  const later = ok(g.graph, { action: "add", tasks: [own("t9", ["README.md"])] });
  assert.doesNotMatch(later.text, /merges three-way/, "the same set: said once");
  assert.match(showText(later.graph, "agent"), /\nt1 and t2 both write src\/a\.js; t2 and t3 both write src\/a\.js: whichever of each two lands second merges three-way at its apply\.\n/);
  // (fails before: yes — FabeleHelper's of 11-10: a new meeting said every meeting again) A new one: said, with the
  // meetings over the files it touches alone.
  const more = ok(later.graph, { action: "add", tasks: [sub("t8", ["README.md"])] });
  assert.ok(more.text.endsWith(`\nt9 and t8 both write README.md${MERGES}`), more.text);
  assert.deepEqual(more.graph.told.filter((/** @type {string} */ m) => m.startsWith("meets:")), ["meets:t1+t2,t2+t3,t9+t8"]);
  // Done, a task is out of the way.
  const done = ok(ok(g.graph, { action: "start", ids: ["t1"] }).graph, { action: "done", id: "t1", summary: "s" });
  assert.deepEqual(merges(done.graph).t2, [["t3", ["src/a.js"]]]);
});

// (fails before: yes — the review of 67038d835, its finding 8: the mark kept every pair an answer ever said, so it only
// grew, and two tasks that met again after they had stopped meeting were never said to)
test("the mark of the meetings said keeps the pairs that still meet: one that stopped goes, and is said again where it meets again", () => {
  /** @param {any} g */
  const marks = (g) => (g.told || []).filter((/** @type {string} */ m) => m.startsWith("meets:"));
  const g = ok(null, { action: "add", goal: "g", tasks: [sub("t1", ["src/a.js"]), sub("t2", ["src/a.js"]), sub("t3", ["src/b.js"]), sub("t4", ["src/b.js"])] });
  assert.deepEqual(marks(g.graph), ["meets:t1+t2,t3+t4"]);
  const apart = ok(g.graph, { action: "change", tasks: [{ id: "t2", writes: ["src/c.js"] }] });
  assert.doesNotMatch(apart.text, /merges three-way/);
  assert.deepEqual(marks(apart.graph), ["meets:t3+t4"], "t1 and t2 meet no more");
  const again = ok(apart.graph, { action: "change", tasks: [{ id: "t2", writes: ["src/a.js"] }] });
  assert.ok(again.text.endsWith(`\nt1 and t2 both write src/a.js${MERGES}`), again.text);
  assert.deepEqual(marks(again.graph), ["meets:t3+t4,t1+t2"]);
  const none = ok(again.graph, { action: "change", tasks: [{ id: "t2", writes: ["src/c.js"] }, { id: "t4", writes: ["src/d.js"] }] });
  assert.deepEqual(marks(none.graph), [], "none meets: no mark is kept");
});

// (fails before: yes — FabeleHelper's of 11-10: every two tasks a line, with no end to it)
test("an answer says tasks that all meet over a file in one line, and three groups at most (TAIL_MOST), the rest counted; a show says them all", () => {
  const four = ok(null, { action: "add", goal: "g", tasks: ["s1", "s2", "s3", "s4"].map((id) => sub(id, ["src/index.js"])) });
  assert.ok(four.text.endsWith(`\ns1, s2, s3 and s4 all write src/index.js: whichever of each two lands second merges three-way at its apply.`), four.text);
  const pairs = Array.from({ length: 7 }, (_, i) => [sub(`a${i + 1}`, [`f${i + 1}.js`]), sub(`b${i + 1}`, [`f${i + 1}.js`])]).flat();
  const seven = ok(null, { action: "add", goal: "g", tasks: pairs });
  const line = seven.text.split("\n").at(-1);
  assert.equal(line, "a1 and b1 both write f1.js; a2 and b2 both write f2.js; a3 and b3 both write f3.js: whichever of each two lands second merges three-way at its apply. And 4 more groups of tasks that meet over files: tasks show names them.");
  assert.match(showText(seven.graph, "agent"), /a7 and b7 both write f7\.js: whichever of each two lands second merges three-way at its apply\.\n/, "a show is not capped");
});

// (fails before: yes — two of the agent's own were refused one file)
test("two of the agent's own tasks may write one file: it does them one at a time, so nothing is said; handed to a sub-agent, one meets the other", () => {
  const g = ok(null, { action: "add", goal: "g", tasks: [own("t3", ["src/parse.js"]), own("t5", ["src/parse.js"]), own("t6", ["src/*.js"])] });
  assert.doesNotMatch(g.text, /both write/);
  assert.deepEqual(merges(g.graph), {});
  assert.doesNotMatch(showText(g.graph, "agent"), /both write/);
  const handed = ok(g.graph, { action: "change", tasks: [{ id: "t5", by: "sub-agent", ...BRIEF }] });
  // The add said t3, t5 and t6 may run side by side, a shared file keeping none out (g3b): the two left its own are not
  // said again (FabeleHelper's of 11-10: each task once).
  assert.match(g.text, /\nThe graph lets t3, t5 and t6 run side by side: /);
  assert.ok(handed.text.endsWith("\nt3 and t5 both write src/parse.js; t5 and t6 both write src/parse.js: whichever of each two lands second merges three-way at its apply."), handed.text);
});

// (fails before: yes — a helper's copy changed nothing: two of a coding agent's tasks were refused whoever worked on them)
test("a coding agent's task a helper took: in its own copy, a merge point; in the folder beside another of its own, said as such, and its box says so", () => {
  const solo = { solo: true };
  const g = ok(null, { action: "add", goal: "g", tasks: [own("a", ["src/x.js"]), own("b", ["src/x.js"])] }, solo).graph;
  const copied = /** @type {any} */ (helperTook(g, "a", { agent: "sa-1", model: "m", copy: true, at: AT }));
  assert.ok(ok(copied, { action: "change", tasks: [{ id: "b", name: "B again" }] }, solo).text.endsWith(`\na and b both write src/x.js${MERGES}`));
  const folder = /** @type {any} */ (helperTook(g, "a", { agent: "sa-1", model: "m", copy: false, at: AT }));
  const said = ok(folder, { action: "change", tasks: [{ id: "b", name: "B again" }] }, solo);
  assert.ok(said.text.endsWith("\na and b both write src/x.js, in your folder at once: one may write over the other's edits — have one need the other, or work one in its own copy."), said.text);
  assert.deepEqual(merges(folder), { a: [["b", ["src/x.js"], "folder"]], b: [["a", ["src/x.js"], "folder"]] });
  // Its box on the Plan: who works on it, where, and — in the folder — the task it writes beside there.
  const box = (/** @type {any} */ g) => textOf(drawGraph(graphView(g), { h: fakeH, now: AT + 60_000 }).el);
  assert.match(box(folder), /\|m · your folder · sa-1 · writes beside b there\|/);
  assert.match(box(copied), /\|m · its copy · sa-1\|/);
  assert.doesNotMatch(box(copied), /writes beside/);
});

// (fails before: yes — a side run's picks were never weighed against each other: the graph refused their writes already)
test("the developer's side run refuses two in their folder at once that write one file — the one guard writes keep; in its own copy, one may", () => {
  const g = ok(null, { action: "add", goal: "g", tasks: [own("t1", ["src/a.js"]), own("t2", ["src/a.js", "src/b.js"]), own("t3", ["src/*.md"])] }).graph;
  /** @param {any} graph @param {[string, "copy" | "yours"][]} picks */
  const run = (graph, picks) => sideRun(graph, picks.map(([id, folder]) => ({ id, model: "m", folder })), { at: AT, crew: "agent", starts: "now" });
  assert.deepEqual(run(g, [["t1", "yours"], ["t2", "yours"]]), { ok: false, error: "t1 and t2 both write src/a.js, both in your folder at once: one would write over the other's edits — run one in its own copy, or one at a time" });
  assert.ok(run(g, [["t1", "yours"], ["t2", "copy"]]).ok);
  assert.ok(run(g, [["t1", "yours"], ["t3", "yours"]]).ok, "other files: both may work there");
  const first = run(g, [["t1", "yours"]]);
  assert.ok(first.ok);
  assert.deepEqual(run(/** @type {any} */ (first).graph, [["t2", "yours"]]), { ok: false, error: "t2 and t1 both write src/a.js, both in your folder at once: one would write over the other's edits — run one in its own copy, or one at a time" });
});

// (fails before: yes — the same: a lead's builders were refused one file)
test("a team's writing workers meet at merge points; where the session's sub-agents share its folder, the answer says they write there at once", () => {
  const built = (/** @type {string} */ id) => own(id, ["src/a.js"], { by: "builder", ...BRIEF });
  const r = ok(null, { action: "add", goal: "g", tasks: [built("t1"), built("t2")] }, { crew: LED });
  assert.ok(r.text.endsWith(`\nt1 and t2 both write src/a.js${MERGES}`), r.text);
  const shared = ok(null, { action: "add", goal: "g", tasks: [built("t1"), built("t2")] }, { crew: LED, shared: true });
  assert.ok(shared.text.endsWith("\nt1 and t2 both write src/a.js, in the folder at once: one may write over the other's edits — have one need the other, or work one in its own copy."), shared.text);
});

// (fails before: yes — a running task's needs and who does it could not change)
test("the agent's own running task may change its needs — it runs on — and who does it — it waits for its worker — the answer saying which", () => {
  const g = ok(ok(null, { action: "add", goal: "g", tasks: [own("t1", ["a.js"]), own("t2", [])] }).graph, { action: "start", ids: ["t1"] }).graph;
  const needs = ok(g, { action: "change", tasks: [{ id: "t1", needs: ["t2"] }] });
  assert.match(needs.text, /^Changed t1\. t1 runs on, needing t2 now: t2 is not done, and a need holds back a start, not work begun\. /);
  assert.deepEqual([task(needs.graph, "t1").state, task(needs.graph, "t1").needs], ["running", ["t2"]]);
  const handed = ok(g, { action: "change", tasks: [{ id: "t1", by: "sub-agent", ...BRIEF }] });
  assert.match(handed.text, /^Changed t1\. t1 was running, and is a sub-agent's task now: it waits, and Filament starts it once its needs are done\. /);
  assert.deepEqual([task(handed.graph, "t1").state, task(handed.graph, "t1").startedAt], ["waiting", null]);
  // A loop is refused still.
  assert.match(no(ok(g, { action: "change", tasks: [{ id: "t2", needs: ["t1"] }] }).graph, { action: "change", tasks: [{ id: "t1", needs: ["t2"] }] }), /^the needs go round in a loop/);
});

// (fails before: yes — needed_by was no field of a task: making an existing task need a new one took an add, then a change)
test("needed_by on an add: the existing tasks named need the new one, checked with it as one graph; a running one of the agent's own runs on", () => {
  const g = ok(null, { action: "add", goal: "g", tasks: [own("t1", ["src/a.js"]), own("t2", ["docs/x.md"])] }).graph;
  const r = ok(g, { action: "add", tasks: [own("t0", ["src/a.js"], { needed_by: ["T1", "t2"] })] });
  assert.deepEqual([task(r.graph, "t1").needs, task(r.graph, "t2").needs, task(r.graph, "t0").needed_by], [["t0"], ["t0"], undefined]);
  assert.match(r.text, /^Added t0\. t1 and t2 now need t0\. /);
  // A task added in the same call may be named too.
  assert.deepEqual(task(ok(g, { action: "add", tasks: [own("t7", []), own("t8", [], { needed_by: ["t7"] })] }).graph, "t7").needs, ["t8"]);
  const running = ok(g, { action: "start", ids: ["t1"] }).graph;
  assert.match(ok(running, { action: "add", tasks: [own("t9", [], { needed_by: ["t1"] })] }).text, /^Added t9\. t1 now needs t9\. t1 runs on, needing t9 now: t9 is not done, and a need holds back a start, not work begun\. /);
});

// (fails before: yes — the same)
test("needed_by is refused in words as change refuses a need: no task, the new task itself, one a sub-agent has, done or dropped, a loop, and it is add's alone", () => {
  const g = ok(null, { action: "add", goal: "g", tasks: [own("t1", []), own("t2", [], { needs: ["t1"] }), own("t3", [])] }).graph;
  assert.equal(no(g, { action: "add", tasks: [own("t9", [], { needed_by: ["t8"] })] }), "t9's needed_by: t8 is no task in the graph");
  assert.equal(no(g, { action: "add", tasks: [own("t9", [], { needed_by: ["t9"] })] }), "t9 needs itself");
  assert.equal(no(g, { action: "add", tasks: [own("t9", [], { needed_by: "t1" })] }), "t9: needed_by is a list of task ids: the tasks that then need it");
  const done = ok(ok(g, { action: "start", ids: ["t1"] }).graph, { action: "done", id: "t1", summary: "s" }).graph;
  assert.equal(no(done, { action: "add", tasks: [own("t9", [], { needed_by: ["t1"] })] }), "t9's needed_by: t1 is done — start it to reopen it, or add a new task for other work");
  const dropped = ok(g, { action: "drop", ids: ["t3"], reason: "gone" }).graph;
  assert.equal(no(dropped, { action: "add", tasks: [own("t9", [], { needed_by: ["t3"] })] }), "t9's needed_by: t3 was dropped (gone) — add a new task for that work");
  assert.equal(no(g, { action: "add", tasks: [own("t9", [], { needs: ["t2"], needed_by: ["t1"] })] }), "the needs go round in a loop: t1 needs t9, t9 needs t2, and t2 needs t1 — one of these needs must go");
  assert.equal(no(g, { action: "change", tasks: [{ id: "t3", needed_by: ["t1"] }] }), "t3: needed_by is add's, for a new task — to have t1 need t3, change t1's needs");
  // A sub-agent's task at work keeps its needs.
  const s = ok(null, { action: "add", goal: "g", tasks: [sub("w", ["a.js"])] }).graph;
  assert.equal(no(launched(s, "w", "sa-1", AT, "sub-agent"), { action: "add", tasks: [own("t9", [], { needed_by: ["w"] })] }), "t9's needed_by: w is with its sub-agent now — wait for its end, or drop it");
});

// (fails before: yes — g3b dropped the overlap filter everywhere: where the session's sub-agents share its folder, two that
// write one file were offered to run at once there, Parallelize's words saying to start them now, and the last write won)
test("where the session's sub-agents share its folder, two of the agent's own that write one file are not offered side by side: they would write there at once; in copies of their own they are", () => {
  const tasks = [own("t1", ["src/parse.js"]), own("t2", ["src/parse.js"]), own("t3", ["src/lex.js"])];
  const apart = ok(null, { action: "add", goal: "g", tasks }, { parallel: true });
  assert.match(apart.text, /\nThe graph lets t1, t2 and t3 run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, Parallelize tasks is on/);
  const shared = ok(null, { action: "add", goal: "g", tasks }, { parallel: true, shared: true });
  assert.match(shared.text, /\nThe graph lets t1 and t3 run side by side: none needs another's work\. Whether they should is your call[^\n]* If so, Parallelize tasks is on/);
  // Its standing block says the same set.
  assert.match(String(whereText(shared.graph, { crew: "agent", shared: true })), /\n- Side by side now: t1, t3(\n|$)/);
  assert.match(String(whereText(apart.graph, { crew: "agent" })), /\n- Side by side now: t1, t2, t3(\n|$)/);
});
