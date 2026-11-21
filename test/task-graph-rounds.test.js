// @ts-check
// The graph-core half of the flexible graph's second round (g3a, the owner's of 11-09: "maximum efficiency, performance,
// correctness, persistency, remembrance of stuff, not getting agent forget stuff… keeping all the power and making it
// more flexible and efficient instead"), in the core alone (core/task-graph.js — pure, nothing runs): a done task
// reopened by a start as a new round; done, start and drop taking tasks entries, and a long name cut, not refused; a
// drop of a task others need cutting their need of it; the files beyond a task's writes without what the graph's merges
// brought in; the turns each task was added and changed in, and the titles of what is kept behind it, after a
// compaction, and a once-said word to keep the design; a merged change still uncommitted in the folder; and where a
// task's worker works, recorded at its launch.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { applyTasks, asMeant, briefText, carriedGraph, changedText, endText, graphView, jobs, launched, openGraphText, resumeText, runsAs, showText, sideApplied, spanClosed, spanOpened, taskEnded, taskMerged, threadEnded, threadsToClose, uncommittedRead, applyAsked } from "../src/core/task-graph.js";

const AT = 1_000;
/** @typedef {{ at?: number, crew?: import("../src/core/task-graph.js").Crew, resumable?: import("../src/core/task-graph.js").Resumable, turn?: number, kept?: any, threadOf?: any }} Opts */
/** One call that must go through. @param {any} g @param {any} input @param {Opts} [o] @returns {{ ok: true, graph: any, text: string, changed: boolean }} */
const ok = (g, input, o = {}) => {
  const r = applyTasks(g, input, { at: AT, crew: "agent", ...o });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return /** @type {any} */ (r);
};
/** One call that must be refused: its words, the graph left as it was. @param {any} g @param {any} input @param {Opts} [o] */
const no = (g, input, o = {}) => {
  const before = JSON.stringify(g);
  const r = applyTasks(g, input, { at: AT, crew: "agent", ...o });
  assert.equal(r.ok, false, "refused");
  assert.equal(JSON.stringify(g), before, "the graph is left as it was");
  return r.ok ? "" : r.error;
};
/** A graph moved along by these calls, each of which must go through. @param {any} g @param {any[]} calls @param {Opts} [o] */
const walk = (g, calls, o = {}) => calls.reduce((acc, c) => ok(acc, c, o).graph, g);
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** A sub-agent's end as the registry hands it over. @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (agent, more = {}) => ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Fixed parse().", met: true, evidence: "npm test passed", left: "" }, words: "Finished.", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 60_000, cut: false, ...more });
const FILES = [{ path: "src/parse.js", added: 12, removed: 3 }];
const BRIEF = { goal: "parse() takes trailing commas", steps: ["Fix parse()"], acceptance: "npm test passes" };

/** t1, a sub-agent's writer, merged and done; t2 of the planner's own needs it, and waits. */
const mergedGraph = () => {
  let g = ok(null, { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Fix the parser", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }, { id: "t2", name: "Document it", needs: ["t1"] }] }).graph;
  g = /** @type {any} */ (launched(g, "t1", "sa-1", 2_000, String(runsAs(task(g, "t1"), "agent"))));
  g = /** @type {any} */ (taskEnded(g, "t1", END("sa-1", { files: FILES }), 3_000)).graph;
  const asked = /** @type {any} */ (applyAsked(g, "sa-1"));
  return /** @type {any} */ (taskMerged(asked.graph, "t1", FILES, 4_000));
};

describe("1: a start on a done task reopens it as a new round", () => {
  // (fails before: yes — a start of a done task was refused "t1 is done already", and more work on it took a new task)
  test("the planner's own: it runs again, its done record kept as the round before, what waits on it waits again", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [{ id: "t1", name: "Map it" }, { id: "t2", name: "Fix it", needs: ["t1"] }, { id: "t3", name: "Docs", needs: ["t1"] }] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Mapped: three callers." }, { action: "start", id: "t2" }]);
    const r = ok(g, { action: "start", id: "t1" }, { at: 5_000 });
    assert.equal(r.text, "Reopened t1 for round 2: yours, so you do it now — its done record is kept as the round before. t3 waits again, for t1's new round. t1 and t2 both read as at work now: one task of yours at a time — the one you are on. Pause the others until you take them up (tasks pause, one call a task, each with its checkpoint), unless a sub-agent or a command works one meanwhile. 0 of 3 done · running: t1, t2.");
    const t1 = task(r.graph, "t1");
    assert.deepEqual([t1.state, t1.startedAt, t1.endedAt, t1.summary, t1.round], ["running", 5_000, null, "", 2]);
    assert.deepEqual(t1.earlier, { agent: null, ranAs: null, report: null, why: "it was done: Mapped: three callers.", reviews: [], done: { round: 1, summary: "Mapped: three callers.", at: AT } });
    // A running dependent is left as it is; a waiting one waits again.
    assert.deepEqual([task(r.graph, "t2").state, task(r.graph, "t3").state], ["running", "waiting"]);
    assert.deepEqual(graphView(r.graph)?.tasks.find((/** @type {any} */ t) => t.id === "t3")?.ready, false);
    // One box, with its rounds: the view says which round it is on.
    assert.deepEqual([graphView(r.graph)?.tasks.filter((/** @type {any} */ t) => t.id === "t1").length, graphView(r.graph)?.tasks[0].round], [1, 2]);
    assert.match(showText(r.graph, "agent"), /\n- t1 "Map it" — running · round 2\n/);
    // Done again, the second round's record is its own; a third round counts on.
    const again = walk(r.graph, [{ action: "done", id: "t1", summary: "Mapped four." }, { action: "start", id: "t1" }]);
    assert.deepEqual([task(again, "t1").round, task(again, "t1").earlier.done], [3, { round: 2, summary: "Mapped four.", at: AT }]);
  });

  // (fails before: yes — the same)
  test("a sub-agent's: it goes back to its builder in its own conversation with the note, or to a new one with fresh, and what needs it waits for its new round's apply", () => {
    const g = mergedGraph();
    const r = ok(g, { action: "start", id: "t1", note: "Take tabs too" }, { at: 5_000 });
    assert.equal(r.text, "Reopened t1 for round 2: sub-agent sa-1 goes on with it once its needs are done and a slot is free, in its own conversation — what it did is there, and it reads your note. t2 waits again, for t1's new round and its apply. 0 of 2 done · ready: t1.");
    const t1 = task(r.graph, "t1");
    assert.deepEqual([t1.state, t1.resume, t1.note, t1.round, t1.report, t1.merged, t1.summary, jobs(r.graph)], ["waiting", "sa-1", "Take tabs too", 2, null, null, "", [{ id: "t1", kind: "resume" }]]);
    assert.deepEqual(t1.earlier.done, { round: 1, summary: "Fixed parse().", at: 4_000, merged: { files: 1, added: 12, removed: 3 } });
    assert.equal(t1.earlier.agent, "sa-1");
    assert.match(resumeText(r.graph, "t1", "agent"), /^\[Filament: the agent reopened task t1, which you had done \(Fixed parse\(\)\.\), for round 2\. The task is yours again: go on from where you stopped/);
    assert.match(resumeText(r.graph, "t1", "agent"), /The agent's note for you: Take tabs too/);
    // fresh: a new one, the done round in its brief — its change is in the project it starts from.
    const anew = ok(g, { action: "start", id: "t1", fresh: true });
    assert.equal(anew.text, "Reopened t1 for round 2: a new sub-agent takes it once its needs are done and a slot is free, with the earlier rounds in its brief. t2 waits again, for t1's new round and its apply. 0 of 2 done · ready: t1.");
    assert.deepEqual([task(anew.graph, "t1").resume, jobs(anew.graph)], [null, [{ id: "t1", kind: "start" }]]);
    assert.match(briefText(anew.graph, "t1", "agent"), /This task was done once — Fixed parse\(\)\. — and its planner reopened it for another round\.[\s\S]*Its change is merged into the project you start from: build on it, and do what this round asks\./);
    // Its end in the new round says it as any end does.
    const back = /** @type {any} */ (launched(anew.graph, "t1", "sa-2", 6_000, "sub-agent"));
    const done = /** @type {any} */ (taskEnded(back, "t1", END("sa-2", { files: FILES }), 7_000)).graph;
    assert.match(endText(done, "t1", { crew: "agent" }), /^\[Filament: task t1 "Fix the parser" is ready: sub-agent sa-2/);
  });

  // (fails before: yes — the same)
  test("a change of a done task stays refused, saying a start reopens it; a step and a lead's own are not reopened", () => {
    const g = mergedGraph();
    assert.equal(no(g, { action: "change", tasks: [{ id: "t1", name: "x" }] }), "t1 is done — start it to reopen it, or add a new task for other work");
    const steps = walk(null, [{ action: "add", goal: "g", tasks: [{ id: "s1", name: "Step" }, { id: "a", name: "A", under: "s1" }] }, { action: "start", id: "a" }, { action: "done", id: "a", summary: "A done." }]);
    assert.equal(task(steps, "s1").state, "done");
    assert.equal(no(steps, { action: "start", id: "s1" }), "s1 is a step: its work is its sub-tasks — start one of them (a) to reopen it");
    // A sub-task reopened puts its step under way again.
    const sub = ok(steps, { action: "start", id: "a" });
    assert.deepEqual([task(sub.graph, "a").state, task(sub.graph, "s1").state, task(sub.graph, "s1").endedAt], ["running", "running", null]);
  });

  // (fails before: yes — the paths that took done as final read a reopened task as done, or never saw it open)
  test("threads, carry and close: a thread closed at the first done stays closed, a carry takes the open round, a close drops it", () => {
    const thread = { id: "i9", text: "Fix the parser", own: false };
    let g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "Map it", thread: "i9" }] }, { threadOf: () => thread }).graph;
    const before = walk(g, [{ action: "start", id: "t1" }]);
    const done1 = walk(before, [{ action: "done", id: "t1", summary: "Mapped." }]);
    assert.deepEqual(threadsToClose(before, done1), [{ task: "t1", thread: "i9", because: "Mapped." }]);
    const closed = /** @type {any} */ (threadEnded(done1, "t1", "i9", { how: "closed", words: "", at: 2_000 }));
    const reopened = walk(closed, [{ action: "start", id: "t1" }]);
    const done2 = walk(reopened, [{ action: "done", id: "t1", summary: "Mapped again." }]);
    assert.deepEqual(threadsToClose(reopened, done2), [], "closed once, at the first done");
    // Carried, the reopened round goes as an open task does: paused, its rounds with it.
    const carried = carriedGraph(reopened, { at: 3_000, from: { chain: "c0", title: "old" } });
    assert.deepEqual([task(carried, "t1").state, task(carried, "t1").round, task(carried, "t1").earlier.done.summary], ["paused", 2, "Mapped."]);
    // Closed, the open round is dropped with what else is open; the round before stays in its record.
    const shut = ok(reopened, { action: "close", reason: "enough" });
    assert.deepEqual([task(shut.graph, "t1").state, task(shut.graph, "t1").earlier.done.summary], ["dropped", "Mapped."]);
  });
});

describe("2: done, start and drop take tasks entries; a long name is cut, not refused", () => {
  /** t1 and t2 of the planner's own running, t3 needs both. */
  const two = () => walk(null, [{ action: "add", goal: "g", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B" }, { id: "t3", name: "C", needs: ["t1", "t2"] }, { id: "t4", name: "D" }] }, { action: "start", ids: ["t1", "t2"] }]);

  // (fails before: yes — done took one task a call, and start and drop took ids alone)
  test("done marks several in one call, each with its own summary and evidence; one problem refuses them all", () => {
    const r = ok(two(), { action: "done", tasks: [{ id: "t1", summary: "A done." }, { id: "t2", summary: "B done.", evidence: "npm test: 4 passed" }] });
    assert.equal(r.text, "Done: t1, t2. Ready now: t3. Next of yours: t4 \"D\" — start it as you take it up. 2 of 4 done.");
    assert.deepEqual([task(r.graph, "t1").summary, task(r.graph, "t2").summary, task(r.graph, "t2").evidence], ["A done.", "B done.", "npm test: 4 passed"]);
    // In order: one the call marks done first frees the next.
    const chain = walk(null, [{ action: "add", goal: "g", tasks: [{ id: "a", name: "A" }, { id: "b", name: "B", needs: ["a"] }] }]);
    assert.equal(ok(chain, { action: "done", tasks: [{ id: "a", summary: "A." }, { id: "b", summary: "B." }] }).text, "Done: a, b. All 2 tasks are done. Before you close, weigh what was done against the goal \"g\": what was asked that no task did goes in as tasks (tasks add); if nothing is left, close the graph with its outcome (tasks close).");
    assert.equal(no(two(), { action: "done", tasks: [{ id: "t1", summary: "A done." }, { id: "t2" }] }), "Nothing of this call changed: t2: done needs its summary — what was done, in a line or two");
    assert.equal(no(two(), { action: "done", tasks: [{ id: "t1", summary: "A done." }, { id: "t9", summary: "x" }] }), "Nothing of this call changed: t9 is no task in the graph");
    // ids of several with one summary say how several go.
    assert.equal(no(two(), { action: "done", ids: ["t1", "t2"], summary: "x" }), 'done takes each task with its own summary — tasks: [{"id": …, "summary": …}, …] marks several in one call, or call it once a task\nThe call: {"action":"done","id":"t1","summary":"what was done, in a line or two"}');
  });

  // (fails before: yes — the same)
  test("start and drop take tasks entries, a note each and a reason each", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B" }, { id: "t3", name: "C" }] }]);
    assert.equal(ok(g, { action: "start", tasks: [{ id: "t1" }, { id: "t2" }] }).text, "Started t1, t2: yours, so you do them now. t1 and t2 both read as at work now: one task of yours at a time — the one you are on. Pause the others until you take them up (tasks pause, one call a task, each with its checkpoint), unless a sub-agent or a command works one meanwhile. 0 of 3 done · running: t1, t2 · ready: t3.");
    const d = ok(g, { action: "drop", tasks: [{ id: "t1", reason: "not needed" }, { id: "t2" }], reason: "out of scope" });
    assert.deepEqual([task(d.graph, "t1").why, task(d.graph, "t2").why], ["not needed", "out of scope"]);
    assert.equal(no(g, { action: "drop", tasks: [{ id: "t1", reason: "x" }, { id: "t2" }] }), 'drop needs reason: why the tasks go\nThe call: {"action":"drop","ids":["t1","t2"],"reason":"why it goes"}');
    // A note each goes to the worker it names.
    let s = ok(null, { action: "add", goal: "g", tasks: [{ id: "w1", name: "W1", by: "explorer", ...BRIEF }, { id: "w2", name: "W2", by: "explorer", ...BRIEF }] }).graph;
    for (const [id, agent] of [["w1", "sa-1"], ["w2", "sa-2"]]) {
      s = /** @type {any} */ (launched(s, id, agent, 2_000, "explorer"));
      s = /** @type {any} */ (taskEnded(s, id, END(agent, { report: { status: "failed", did: "", met: false, evidence: "", left: "x" } }), 3_000)).graph;
    }
    const sent = ok(s, { action: "start", tasks: [{ id: "w1", note: "Look in lib/" }, { id: "w2" }], note: "Look harder" });
    assert.deepEqual([task(sent.graph, "w1").note, task(sent.graph, "w2").note], ["Look in lib/", "Look harder"]);
  });

  // (fails before: yes — a name past 120 characters was refused, and the model wrote the call again)
  test("asMeant: a name past 120 characters is cut, said as read as meant; goal, steps and acceptance keep their limits", () => {
    const long = `Fix ${"the parser ".repeat(14)}`.trim();
    const r = asMeant({ action: "add", goal: "g", tasks: [{ id: "t1", name: long }] }, { crew: "agent" });
    const name = /** @type {any} */ (r.input).tasks[0].name;
    assert.deepEqual([name.length, name.endsWith("…"), r.said], [120, true, ["t1's name cut to 120 characters"]]);
    assert.equal(ok(null, r.input).graph.tasks[0].name, name);
    const c = asMeant({ action: "change", tasks: [{ id: "t1", name: long }] }, { crew: "agent" });
    assert.deepEqual(c.said, ["t1's name cut to 120 characters"]);
    assert.equal(no(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "A", acceptance: "a".repeat(1001) }] }), "t1: acceptance is up to 1,000 characters (this one has 1,001)");
  });
});

describe("3: a drop of a task others need", () => {
  // (fails before: yes — "t4 needs t3 — drop t4 too, or change its needs first", and a second call)
  test("it goes, the need is cut from each task that needed it, and they are named", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [{ id: "t1", name: "A" }, { id: "t3", name: "C" }, { id: "t4", name: "D", needs: ["t1", "t3"] }, { id: "t5", name: "E", needs: ["t3"] }] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "A." }]);
    const r = ok(g, { action: "drop", ids: ["t3"], reason: "the parser is fine" });
    assert.equal(r.text, "Dropped t3. t4 and t5 needed it: those needs are cut. 1 of 3 done · ready: t5, t4.");
    assert.deepEqual([task(r.graph, "t4").needs, task(r.graph, "t5").needs], [["t1"], []]);
    const one = ok(walk(g, [{ action: "drop", ids: ["t5"], reason: "x" }]), { action: "drop", ids: ["t3"], reason: "y" });
    assert.equal(one.text, "Dropped t3. t4 needed it: that need is cut. 1 of 2 done · ready: t4.");
    // A done task keeps its needs as they were — what it built on stands — though the need it names was reopened.
    const built = walk(g, [{ action: "drop", ids: ["t5"], reason: "x" }, { action: "start", id: "t3" }, { action: "done", id: "t3", summary: "C." }, { action: "start", id: "t4" }, { action: "done", id: "t4", summary: "D." }, { action: "start", id: "t3" }]);
    const gone = ok(built, { action: "drop", ids: ["t3"], reason: "z" });
    assert.deepEqual([task(gone.graph, "t4").state, task(gone.graph, "t4").needs], ["done", ["t1", "t3"]]);
    assert.equal(gone.text, "Dropped t3. All 2 tasks are done. Before you close, weigh what was done against the goal \"g\": what was asked that no task did goes in as tasks (tasks add); if nothing is left, close the graph with its outcome (tasks close).");
  });
});

describe("4: beyond its writes, without what the graph's merges brought in", () => {
  /** t9 of the planner's own runs, writing src/a.js; t1, a sub-agent's, merges while it runs. */
  const running = () => {
    let g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t9", name: "Own", writes: ["src/a.js"], acceptance: "it works" }, { id: "t1", name: "Fix the parser", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }).graph;
    g = ok(g, { action: "start", id: "t9" }, { at: 1_500 }).graph;
    g = /** @type {any} */ (spanOpened(g, "t9", { repo: "/p", commit: "c0", folder: "/p" }));
    g = /** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent"));
    g = /** @type {any} */ (taskEnded(g, "t1", END("sa-1", { files: [...FILES, { path: "src/lexer.js", added: 1, removed: 0 }] }), 3_000)).graph;
    return /** @type {any} */ (taskMerged(/** @type {any} */ (applyAsked(g, "sa-1")).graph, "t1", [...FILES, { path: "src/lexer.js", added: 1, removed: 0 }], 4_000));
  };

  // (fails before: yes — every file a merge brought in while it ran read as changed beyond its writes)
  test("a merge while it runs is not its: subtracted from beyond, the rest named five at most", () => {
    const g = running();
    assert.deepEqual(task(g, "t9").brought, ["src/lexer.js", "src/parse.js"]);
    const done = ok(g, { action: "done", id: "t9", summary: "Own done.", evidence: "it works" }).graph;
    const closed = /** @type {any} */ (spanClosed(done, "t9", { files: ["src/a.js", "src/lexer.js", "src/parse.js"], end: null }));
    assert.equal(changedText(closed, "t9"), "While t9 ran, the folder changed src/a.js.");
    assert.equal(graphView(closed)?.tasks[0].beyond, undefined);
    const more = /** @type {any} */ (spanClosed({ ...done, tasks: done.tasks.map((/** @type {any} */ t) => (t.id === "t9" ? { ...t, base: { repo: "/p", commit: "c0", folder: "/p" } } : t)) }, "t9", { files: ["src/a.js", "src/parse.js", "b1", "b2", "b3", "b4", "b5", "b6", "b7"], end: null }));
    assert.equal(changedText(more, "t9"), "While t9 ran, the folder changed src/a.js, and b1, b2, b3, b4, b5 and 2 more changed too, beyond its writes — if that was other work, nothing to do.");
    assert.deepEqual(graphView(more)?.tasks[0].beyond, ["b1", "b2", "b3", "b4", "b5", "b6", "b7"]);
    // Only the merge brought it in: none of its writes changed, and that is said.
    const theirs = /** @type {any} */ (spanClosed({ ...done, tasks: done.tasks.map((/** @type {any} */ t) => (t.id === "t9" ? { ...t, base: { repo: "/p", commit: "c0", folder: "/p" } } : t)) }, "t9", { files: ["src/parse.js"], end: null }));
    assert.equal(changedText(theirs, "t9"), "While t9 ran, none of its writes changed in the folder.");
  });

  // (fails before: yes — the same, for the developer's own apply)
  test("the developer's apply while it runs is subtracted the same way; a task not running takes none", () => {
    let g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t9", name: "Own", writes: ["src/a.js"] }, { id: "t8", name: "Later", writes: ["src/b.js"] }, { id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }).graph;
    g = ok(g, { action: "start", id: "t9" }).graph;
    g = /** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent"));
    g = /** @type {any} */ (taskEnded(g, "t1", END("sa-1", { files: FILES }), 3_000)).graph;
    // No span open — the folder is no repository — nothing is read of what changed, and nothing is kept for it.
    assert.equal(task(/** @type {any} */ (sideApplied(g, "sa-1", FILES, 4_000)), "t9").brought, undefined);
    g = /** @type {any} */ (spanOpened(g, "t9", { repo: "/p", commit: "c0", folder: "/p" }));
    const applied = /** @type {any} */ (sideApplied(g, "sa-1", FILES, 4_000));
    assert.deepEqual([task(applied, "t9").brought, task(applied, "t8").brought], [["src/parse.js"], undefined]);
  });
});

describe("5: remembering", () => {
  // (fails before: yes — a task kept no turn of its own, and after a compaction its words were gone with the summary)
  test("each task keeps the turn it was added in and the turn it last changed in; after a compaction its line says them", () => {
    const g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "A" }, { id: "t2", name: "B" }] }, { turn: 12 }).graph;
    assert.deepEqual([task(g, "t1").addedTurn, task(g, "t1").changedTurn], [12, 12]);
    const c = ok(g, { action: "change", tasks: [{ id: "t2", name: "B, better" }] }, { turn: 15 }).graph;
    assert.deepEqual([task(c, "t1").changedTurn, task(c, "t2").addedTurn, task(c, "t2").changedTurn], [12, 12, 15]);
    // An add's needed_by changes the task it names.
    const nb = ok(c, { action: "add", tasks: [{ id: "t0", name: "First", needed_by: ["t1"] }] }, { turn: 16 }).graph;
    assert.deepEqual([task(nb, "t1").changedTurn, task(nb, "t0").addedTurn], [16, 16]);
    const back = /** @type {string} */ (openGraphText(c, "agent"));
    assert.match(back, /\n- t1 "A" — ready · added turn 12\n/);
    assert.match(back, /\n- t2 "B, better" — ready · added turn 12, changed turn 15\n/);
    assert.match(back, /\nfilament_recall with a turn's number brings back what was said as a task was added or changed\.$/);
    // A show between compactions says none of it; a graph kept before the turns were kept, nothing.
    assert.doesNotMatch(showText(c, "agent"), /turn 12/);
    const old = ok(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "A" }] }).graph;
    assert.equal(task(old, "t1").addedTurn, undefined);
    assert.equal(openGraphText(old, "agent"), showText(old, "agent"));
  });

  // (fails before: yes — kept said counts alone: "keeps 2 notes, 1 file")
  test("after a compaction a task's line names what is kept behind it by title", () => {
    const g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "A" }] }).graph;
    const kept = { t1: { notes: 2, files: 1, titles: ["Design", "Checkpoint 1 · 14:02", "plan.md"] }, "": { notes: 1, files: 0, titles: ["Why"] } };
    const back = /** @type {string} */ (openGraphText(g, "agent", kept));
    assert.match(back, /\n- t1 "A" — ready · keeps "Design", "Checkpoint 1 · 14:02" and "plan.md"\n/);
    assert.match(back, /\nKept behind the graph itself: "Why"\.\n/);
    assert.match(showText(g, "agent", kept), /\n- t1 "A" — ready · keeps 2 notes, 1 file\n/);
    const many = { t1: { notes: 7, files: 0, titles: ["a", "b", "c", "d", "e", "f", "g"] } };
    assert.match(/** @type {string} */ (openGraphText(g, "agent", many)), /keeps "a", "b", "c", "d", "e" and 2 more/);
  });

  // (fails before: yes — nothing asked for the design behind a plan, which a compaction then lost)
  test("an add of three or more with nothing kept behind the graph says once to keep the design", () => {
    const NUDGE = " Keep the design behind it: tasks keep with no id, titled Design.";
    const three = [{ id: "t1", name: "A" }, { id: "t2", name: "B" }, { id: "t3", name: "C" }];
    const r = ok(null, { action: "add", goal: "g", tasks: three }, { kept: {} });
    assert.ok(r.text.endsWith(NUDGE), r.text);
    const more = ok(r.graph, { action: "add", tasks: [{ id: "t4", name: "D" }, { id: "t5", name: "E" }, { id: "t6", name: "F" }] }, { kept: {} });
    assert.ok(!more.text.includes("Keep the design"), "once a graph");
    assert.ok(!ok(null, { action: "add", goal: "g", tasks: three }, { kept: { "": { notes: 1, files: 0 } } }).text.includes("Keep the design"), "kept already");
    assert.ok(!ok(null, { action: "add", goal: "g", tasks: three }).text.includes("Keep the design"), "Filament keeps no notes");
    assert.ok(!ok(null, { action: "add", goal: "g", tasks: three.slice(0, 2) }, { kept: {} }).text.includes("Keep the design"), "two tasks");
  });
});

describe("6: applied, not committed", () => {
  // (fails before: yes — a merged change read as finished whether or not anyone committed it)
  test("a merged task whose files are uncommitted in the folder says so, until they are committed", () => {
    const g = mergedGraph();
    const read = /** @type {any} */ (uncommittedRead(g, ["src/parse.js", "README.md"]));
    assert.deepEqual(task(read, "t1").uncommitted, ["src/parse.js"]);
    assert.match(showText(read, "agent"), /\n- t1 "Fix the parser" — done: Fixed parse\(\)\. · applied, not committed · by sub-agent/);
    assert.match(ok(read, { action: "show", id: "t1" }).text, /\nApplied, not committed: src\/parse\.js is uncommitted in the folder\./);
    assert.deepEqual(graphView(read)?.tasks[0].uncommitted, ["src/parse.js"]);
    assert.equal(uncommittedRead(read, ["src/parse.js"]), null, "nothing moved");
    const committed = /** @type {any} */ (uncommittedRead(read, ["README.md"]));
    assert.equal(task(committed, "t1").uncommitted, undefined);
    assert.equal(uncommittedRead(g, []), null);
  });
});

describe("7: where a task's worker works, recorded at its launch", () => {
  // (fails before: yes — the forecast guessed from the session's setting, and nothing said where a worker worked)
  test("launched keeps the workspace; the forecast reads it in place of guessing, and the line says it", () => {
    const g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }, { id: "t2", name: "Own", writes: ["src/parse.js"] }] }).graph;
    const patch = /** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent", "patch"));
    assert.equal(task(patch, "t1").workspace, "patch");
    assert.match(showText(patch, "agent"), /\n- t1 "Fix" — running on sa-1, in a patch of its own · by sub-agent/);
    assert.match(showText(patch, "agent"), /t1 and t2 both write src\/parse\.js: whichever lands second merges three-way at its apply\./);
    // In the folder, whatever the session's setting said: the two write in it at once.
    const folder = /** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent", "folder"));
    assert.match(showText(folder, "agent"), /\n- t1 "Fix" — running on sa-1, in your folder · by sub-agent/);
    assert.match(showText(folder, "agent"), /t1 and t2 both write src\/parse\.js, in your folder at once/);
    assert.equal(graphView(folder)?.tasks[0].workspace, "folder");
    assert.deepEqual(graphView(folder)?.tasks[0].mergesWith, [{ task: "t2", files: ["src/parse.js"], folder: true }]);
    // A launch that says none keeps none, as before.
    assert.equal(task(/** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent")), "t1").workspace, undefined);
  });
});

describe("the Plan's box: its round, applied not committed, and where its worker works", () => {
  /** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
  const all = (n, pred, out = []) => {
    if (n && typeof n === "object") {
      if (pred(n)) out.push(n);
      for (const k of n.kids || []) all(k, pred, out);
    }
    return out;
  };
  /** A task's box as the Plan draws it. @param {any} g @param {string} id @returns {any} */
  const boxOf = (g, id) => all(drawGraph(/** @type {any} */ (graphView(g)), { h: fakeH, now: 9_000, width: 1400 }).el, (x) => x.attrs?.["data-id"] === id)[0];

  // (fails before: yes — the box said neither the round, nor that the change waited for a commit, nor where it worked)
  test("one box a task, its round said; a merged change still uncommitted said so; a worker's line names where it works", () => {
    const reopened = walk(null, [{ action: "add", goal: "g", tasks: [{ id: "t1", name: "Map it" }] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Mapped." }, { action: "start", id: "t1" }]);
    const box = boxOf(reopened, "t1");
    assert.match(box.attrs["aria-label"], /^t1 Map it: running, round 2/);
    assert.match(box.attrs.title, /\nDone in round 1: Mapped\.(\n|$)/);
    const read = /** @type {any} */ (uncommittedRead(mergedGraph(), ["src/parse.js"]));
    assert.match(boxOf(read, "t1").attrs.title, /\ndone · applied, not committed · /);
    assert.match(boxOf(mergedGraph(), "t1").attrs.title, /\ndone · applied · /);
    assert.equal(textOf(boxOf(read, "t1")), "t1|Fix the parser|<1 min", "the box's own fact stays what it took");
    const g = ok(null, { action: "add", goal: "g", tasks: [{ id: "t1", name: "Fix", by: "sub-agent", writes: ["src/parse.js"], ...BRIEF }] }).graph;
    const inFolder = boxOf(/** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent", "folder")), "t1");
    assert.match(inFolder.attrs.title, /\nAn agent does it, in your folder/);
    assert.match(inFolder.attrs.title, /· your folder · started/);
    assert.match(boxOf(/** @type {any} */ (launched(g, "t1", "sa-1", 2_000, "sub-agent", "patch")), "t1").attrs.title, /\nAn agent does it, in a patch of its own/);
  });
});
