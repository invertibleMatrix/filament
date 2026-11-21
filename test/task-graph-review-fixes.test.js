// @ts-check
// The graph core's fixes from the reviews of g1 (writes are a forecast: 63546f081) and g3 (a start reopens a done task:
// 07b05db17), and the hunt on g2 (a merge's send-back, twice at most), in the core alone: every reader of the graph says
// where tasks meet by the one rule — the folder the session's sub-agents share; the developer's side run weighed against
// every hand in their folder now; a start that reopens a task and its own dependent in one call; a span's late close or
// late open kept to its round; a plan's go read from tasks entries; a checklist's task keeping its turn; a merge's kept
// files never marked uncommitted; and the send-back counter cleared where a new try begins.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MERGED_TWICE, applyAsked, applyPlan, applyTasks, changedText, graphView, helperTook, launched, openGraphText, rebaseRefusal, runsAs, sentToRebase, showText, sideRun, spanClosed, spanOpened, taskEnded, taskMergeFailed, taskMerged, uncommittedRead } from "../src/core/task-graph.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";

const AT = 1_000;
/** @param {Record<string, any>} [o] @returns {any} */
const opts = (o = {}) => ({ at: AT, crew: "agent", ...o });
/** One call that must go through. @param {any} g @param {any} input @param {Record<string, any>} [o] @returns {{ ok: true, graph: any, text: string, changed: boolean }} */
const ok = (g, input, o) => {
  const r = applyTasks(g, input, opts(o));
  assert.ok(r.ok, r.ok ? "" : r.error);
  return /** @type {any} */ (r);
};
/** A graph moved along by these calls, each of which must go through. @param {any} g @param {any[]} calls @param {Record<string, any>} [o] */
const walk = (g, calls, o) => calls.reduce((acc, c) => ok(acc, c, o).graph, g);
/** @param {string} id @param {string[]} writes @param {Record<string, any>} [more] */
const own = (id, writes, more = {}) => ({ id, name: id.toUpperCase(), writes, ...more });
const BRIEF = { goal: "It is done", steps: ["Do it"], acceptance: "the check passes" };
/** @param {string} id @param {string[]} writes @param {Record<string, any>} [more] */
const sub = (id, writes, more = {}) => own(id, writes, { by: "sub-agent", ...BRIEF, ...more });
/** @param {any} g @param {string} id @returns {any} */
const task = (g, id) => g.tasks.find((/** @type {any} */ t) => t.id === id);
/** A sub-agent's end as the registry hands it over. @param {string} agent @param {Record<string, any>} [more] @returns {any} */
const END = (agent, more = {}) => ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Did it.", met: true, evidence: "ok", left: "" }, words: "", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1, cut: false, ...more });
const A = [{ path: "src/a.js", added: 1, removed: 1 }];
const FOLDER = "t1 and t2 both write src/a.js, in your folder at once: one may write over the other's edits — have one need the other, or work one in its own copy.";
const MERGES = "t1 and t2 both write src/a.js: whichever lands second merges three-way at its apply.";
/** Each task's merge points as the page reads them. @param {any} g */
const merges = (g) => Object.fromEntries(/** @type {any} */ (graphView(g)).tasks.filter((/** @type {any} */ t) => t.mergesWith).map((/** @type {any} */ t) => [t.id, t.mergesWith.map((/** @type {any} */ m) => (m.folder ? [m.task, "folder"] : [m.task]))]));

describe("g1: every reader of the graph says where tasks meet by the folder the session's sub-agents share", () => {
  // (fails before: yes — show, the text a compaction hands back and the Plan read `meetings(graph, {})`, never shared)
  test("a graph kept with its sub-agents sharing the folder: show, the compaction's text and the Plan say the two write there at once, as the add did", () => {
    const added = ok(null, { action: "add", goal: "g", tasks: [sub("t1", ["src/a.js"]), sub("t2", ["src/a.js"])] }, { shared: true });
    assert.ok(added.text.endsWith(`\n${FOLDER}`), added.text);
    // As Filament keeps it: the session's sharing stamped on the graph.
    const kept = { ...added.graph, shared: true };
    assert.ok(showText(kept, "agent").includes(`\n${FOLDER}\n`), showText(kept, "agent"));
    assert.ok(String(openGraphText(kept, "agent")).includes(`\n${FOLDER}\n`));
    assert.deepEqual(merges(kept), { t1: [["t2", "folder"]], t2: [["t1", "folder"]] });
    // A show hears the live word, as the add does, whatever the graph was kept with.
    assert.ok(ok(added.graph, { action: "show" }, { shared: true }).text.includes(`\n${FOLDER}\n`));
    // Kept with none, and told none: each in a worktree of its own.
    assert.ok(showText(added.graph, "agent").includes(`\n${MERGES}\n`));
    assert.deepEqual(merges(added.graph), { t1: [["t2"]], t2: [["t1"]] });
    // The live word stands over the kept one: sharing turned off since, the add's answer says a merge.
    const off = ok(kept, { action: "add", tasks: [sub("t3", ["docs/x.md"])] }, { shared: false });
    assert.ok(off.text.endsWith(`
${MERGES}`), off.text);
  });
});

describe("g1: the side run's guard weighs every hand that writes in the folder now", () => {
  /** @param {any} graph @param {[string, "copy" | "yours"][]} picks @param {Record<string, any>} [more] */
  const run = (graph, picks, more = {}) => sideRun(graph, picks.map(([id, folder]) => ({ id, model: "m", folder })), { at: AT, crew: "agent", starts: "now", ...more });
  const CLASH = (/** @type {string} */ a, /** @type {string} */ b) => `${a} and ${b} both write src/a.js, both in your folder at once: one would write over the other's edits — run one in its own copy, or one at a time`;

  // (fails before: yes — the guard compared side runs with each other alone)
  test("the agent's own running task: a pick in the folder writing its file is refused; in its own copy, or one that waits, it goes", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [own("t0", ["src/a.js"]), own("t1", ["src/a.js"]), own("t2", ["src/a.js"])] }, { action: "start", id: "t0" }]);
    assert.deepEqual(run(g, [["t1", "yours"]]), { ok: false, error: CLASH("t1", "t0") });
    assert.ok(run(g, [["t1", "copy"]]).ok);
    // t2 waits, the agent at work on nothing of it: no hand in the folder writes its file.
    const waits = walk(null, [{ action: "add", goal: "g", tasks: [own("t1", ["src/a.js"]), own("t2", ["src/a.js"])] }]);
    assert.ok(run(waits, [["t1", "yours"]]).ok);
  });

  // (fails before: yes — the same)
  test("a coding agent's helper in the folder writing the file refuses it; its helper in a copy of its own does not", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [own("a", ["src/a.js"]), own("t1", ["src/a.js"])] }], { solo: true });
    const there = /** @type {any} */ (helperTook(g, "a", { agent: "sa-1", model: "m", copy: false, at: AT }));
    assert.deepEqual(run(there, [["t1", "yours"]]), { ok: false, error: CLASH("t1", "a") });
    assert.ok(run(/** @type {any} */ (helperTook(g, "a", { agent: "sa-1", model: "m", copy: true, at: AT })), [["t1", "yours"]]).ok);
  });

  // (fails before: yes — the same)
  test("a graph worker in the folder writing the file refuses it — launched there, or not said and the sub-agents share it; in its worktree it goes", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [sub("w1", ["src/a.js"]), own("t1", ["src/a.js"])] }]);
    const as = String(runsAs(task(g, "w1"), "agent"));
    assert.deepEqual(run(/** @type {any} */ (launched(g, "w1", "sa-1", AT, as, "folder")), [["t1", "yours"]]), { ok: false, error: CLASH("t1", "w1") });
    assert.ok(run(/** @type {any} */ (launched(g, "w1", "sa-1", AT, as, "worktree")), [["t1", "yours"]]).ok);
    // One launched before its workspace was kept: the session's sharing says where.
    const unsaid = /** @type {any} */ (launched(g, "w1", "sa-1", AT, as));
    assert.ok(run(unsaid, [["t1", "yours"]]).ok, "the sub-agents work in worktrees of their own");
    assert.deepEqual(run({ ...unsaid, shared: true }, [["t1", "yours"]]), { ok: false, error: CLASH("t1", "w1") });
    assert.deepEqual(run(unsaid, [["t1", "yours"]], { shared: true }), { ok: false, error: CLASH("t1", "w1") });
  });

  // (fails before: no — a guard of the picks; kept as it stood)
  test("two hands already in the folder refuse no pick of other files", () => {
    let g = walk(null, [{ action: "add", goal: "g", tasks: [own("t0", ["src/a.js"]), sub("w1", ["src/a.js"]), own("t1", ["docs/x.md"])] }, { action: "start", id: "t0" }]);
    g = /** @type {any} */ (launched(g, "w1", "sa-1", AT, String(runsAs(task(g, "w1"), "agent")), "folder"));
    assert.ok(run(g, [["t1", "yours"]]).ok);
  });
});

describe("g3: a start of a done task and its own dependent in one call", () => {
  // (fails before: yes — both ran at once: cannotStart read t1 done, and t2 went running in place)
  test("the dependent of the agent's own waits for the round the call reopened, said so; the rest of the call goes", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [own("t1", []), own("t2", [], { needs: ["t1"] }), own("t3", [])] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "Mapped." }]);
    const r = ok(g, { action: "start", ids: ["t1", "t2", "t3"] }, { at: 5_000 });
    assert.deepEqual(["t1", "t2", "t3"].map((id) => task(r.graph, id).state), ["running", "waiting", "running"]);
    assert.equal(task(r.graph, "t2").startedAt, null);
    assert.equal(r.text, "Reopened t1 for round 2: yours, so you do it now — its done record is kept as the round before. t2 waits: it needs t1, reopened in this call — start it once that round is done. Started t3: yours, so you do it now. t1 and t3 both read as at work now: one task of yours at a time — the one you are on. Pause the others until you take them up (tasks pause, one call a task, each with its checkpoint), unless a sub-agent or a command works one meanwhile. 0 of 3 done · running: t1, t3.");
    // Done in its round, t1 frees it: a start then runs it.
    const later = walk(r.graph, [{ action: "done", id: "t1", summary: "Mapped again." }, { action: "start", id: "t2" }]);
    assert.equal(task(later, "t2").state, "running");
  });

  // (fails before: yes — the same: both reopened, and both ran)
  test("two done ones reopened together: the one that needs the other reopens and waits for it", () => {
    const g = walk(null, [{ action: "add", goal: "g", tasks: [own("t1", []), own("t2", [], { needs: ["t1"] })] }, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "A." }, { action: "start", id: "t2" }, { action: "done", id: "t2", summary: "B." }]);
    const r = ok(g, { action: "start", ids: ["t2", "t1"] });
    assert.deepEqual([task(r.graph, "t1").state, task(r.graph, "t2").state, task(r.graph, "t2").round, task(r.graph, "t2").earlier.done.summary], ["running", "waiting", 2, "B."]);
    assert.match(r.text, /^Reopened t2 for round 2: yours, and it waits: it needs t1, reopened in this call — start it once that round is done\. Reopened t1 for round 2: yours, so you do it now/);
  });
});

describe("g3: a span's close and open kept to their round", () => {
  const B0 = { repo: "/p", commit: "c0", folder: "/p" };
  const B1 = { repo: "/p", commit: "c1", folder: "/p" };

  // (fails before: yes — the late close found it running, joined round 1's files to round 2's and moved the base on)
  test("a close of round 1 read after a start reopened it: its files go to round 1's record, round 2 opens its own span", () => {
    let g = walk(null, [{ action: "add", goal: "g", tasks: [own("t9", ["src/a.js"])] }, { action: "start", id: "t9" }]);
    g = spanOpened(g, "t9", B0);
    g = walk(g, [{ action: "done", id: "t9", summary: "Round one." }, { action: "start", id: "t9" }]);
    assert.deepEqual([task(g, "t9").round, task(g, "t9").state], [2, "running"]);
    const closed = /** @type {any} */ (spanClosed(g, "t9", { files: ["src/a.js", "src/old.js"], end: B1, round: 1 }));
    assert.deepEqual([task(closed, "t9").changed, task(closed, "t9").base, task(closed, "t9").earlier.done.changed], [undefined, undefined, ["src/a.js", "src/old.js"]]);
    const opened = /** @type {any} */ (spanOpened(closed, "t9", B1));
    assert.deepEqual(task(opened, "t9").base, { ...B1, round: 2 }, "marked with the round it is of");
    const two = /** @type {any} */ (spanClosed(ok(opened, { action: "done", id: "t9", summary: "Round two." }).graph, "t9", { files: ["src/a.js"], end: null, round: 2 }));
    assert.equal(changedText(two, "t9"), "While t9 ran, the folder changed src/a.js.");
    // A pause's close read after it started again is the same round's: it carries on, as before.
    let p = walk(null, [{ action: "add", goal: "g", tasks: [own("t9", ["src/a.js"])] }, { action: "start", id: "t9" }]);
    p = spanOpened(p, "t9", B0);
    p = walk(p, [{ action: "pause", id: "t9", checkpoint: "Half way." }, { action: "start", id: "t9" }]);
    const on = /** @type {any} */ (spanClosed(p, "t9", { files: ["src/a.js"], end: B1, round: 1 }));
    assert.deepEqual([task(on, "t9").changed, task(on, "t9").base], [["src/a.js"], { ...B1, round: 1 }]);
  });

  // (fails before: yes — spanOpened took no files: what came in while the snapshot was read was named beyond its writes)
  test("what a merge brought in while its span was opening is kept with the base, so it is never named beyond its writes", () => {
    let g = walk(null, [{ action: "add", goal: "g", tasks: [own("t9", ["src/a.js"])] }, { action: "start", id: "t9" }]);
    g = /** @type {any} */ (spanOpened(g, "t9", B0, ["src/parse.js"]));
    assert.deepEqual(task(g, "t9").brought, ["src/parse.js"]);
    const done = /** @type {any} */ (spanClosed(ok(g, { action: "done", id: "t9", summary: "s" }).graph, "t9", { files: ["src/a.js", "src/parse.js"], end: null }));
    assert.equal(changedText(done, "t9"), "While t9 ran, the folder changed src/a.js.");
    assert.equal(/** @type {any} */ (spanOpened(walk(null, [{ action: "add", goal: "g", tasks: [own("t8", [])] }, { action: "start", id: "t8" }]), "t8", B0, [])).tasks[0].brought, undefined, "nothing came: none kept");
  });
});

describe("also weighed: a plan's go, a checklist's turn, a merge's kept files", () => {
  /** A plan that waits for the person's Approve: w1 a sub-agent's, t1 the planner's own. */
  const waiting = () => {
    const r = ok(null, { action: "add", goal: "g", tasks: [sub("w1", ["src/a.js"]), own("t1", [])] }, { planning: true });
    assert.ok(r.graph.planning);
    return r.graph;
  };

  // (fails before: yes — the go read `ids` alone: an id, or tasks entries, had the start refused as Filament's to make)
  test("a start's go names a sub-agent's task by an id or by tasks entries, as by ids", () => {
    const FREED = "The plan no longer waits for the person's Approve: Filament starts its sub-agents' tasks and its commands as their needs are done, w1 among them.";
    for (const input of [{ action: "start", ids: ["w1"] }, { action: "start", id: "w1" }, { action: "start", tasks: [{ id: "W1" }] }]) {
      const r = ok(waiting(), input);
      assert.ok(r.text.startsWith(FREED), `${JSON.stringify(input)}: ${r.text}`);
      assert.equal(r.graph.planning, null);
    }
    // Entries with one of the planner's own: it starts, its note with it.
    const both = ok(waiting(), { action: "start", tasks: [{ id: "w1" }, { id: "t1", note: "go" }] });
    assert.ok(both.text.startsWith(`${FREED} Started t1: yours, so you do it now.`), both.text);
    assert.equal(task(both.graph, "t1").state, "running");
  });

  // (fails before: yes — a checklist's task kept no turn, so after a compaction its line named none)
  test("a checklist's task keeps the turn it was added in", () => {
    const r = applyPlan(null, [{ text: "Map it", status: "doing" }], { at: AT, crew: "agent", turn: 7 });
    assert.deepEqual([task(r.graph, "p1").addedTurn, task(r.graph, "p1").changedTurn], [7, 7]);
    assert.equal(task(applyPlan(null, [{ text: "Map it", status: "doing" }], { at: AT, crew: "agent" }).graph, "p1").addedTurn, undefined);
  });

  // (fails before: yes — a file whose change the merge set aside, the folder's version kept, read as the task's uncommitted)
  test("applied, not committed never names a file the merge kept as the folder had it", () => {
    let g = ok(null, { action: "add", goal: "g", tasks: [sub("w1", ["a.txt", "c.txt"])] }).graph;
    g = launched(g, "w1", "sa-1", AT, String(runsAs(task(g, "w1"), "agent")));
    g = /** @type {any} */ (taskEnded(g, "w1", END("sa-1", { files: [{ path: "a.txt", added: 1, removed: 1 }, { path: "c.txt", added: 1, removed: 0 }] }), AT)).graph;
    g = taskMerged(/** @type {any} */ (applyAsked(g, "sa-1")).graph, "w1", [{ path: "c.txt", added: 1, removed: 0 }], AT, null, { kept: ["a.txt"] });
    assert.deepEqual(task(/** @type {any} */ (uncommittedRead(g, ["a.txt", "c.txt"])), "w1").uncommitted, ["c.txt"]);
  });
});

describe("g2: the send-back counter is a try's, cleared where a new one begins", () => {
  /** w1 sent back by its merge twice, by Filament itself, and its change ready again. */
  const twice = () => {
    let g = ok(null, { action: "add", goal: "g", tasks: [sub("w1", ["src/a.js"])] }).graph;
    const as = String(runsAs(task(g, "w1"), "agent"));
    for (const n of [1, 2]) {
      g = /** @type {any} */ (launched(g, "w1", "sa-1", AT, as));
      g = /** @type {any} */ (taskEnded(g, "w1", END("sa-1", { files: A }), AT)).graph;
      g = /** @type {any} */ (applyAsked(g, "sa-1")).graph;
      g = /** @type {any} */ (sentToRebase(g, "sa-1", "redo it", { asked: false, why: "src/a.js: both changed line 3" })).graph;
      assert.equal(task(g, "w1").rebases, n);
    }
    g = /** @type {any} */ (launched(g, "w1", "sa-1", AT, as));
    g = /** @type {any} */ (taskEnded(g, "w1", END("sa-1", { files: A }), AT)).graph;
    return { g: /** @type {any} */ (applyAsked(g, "sa-1")).graph, as };
  };
  /** The task's change merging again after a new try: it ends, and its apply is asked. @param {any} g @param {string} as */
  const mergingAgain = (g, as) => {
    const l = /** @type {any} */ (launched(g, "w1", task(g, "w1").resume || "sa-1", AT, as));
    return /** @type {any} */ (applyAsked(/** @type {any} */ (taskEnded(l, "w1", END(task(l, "w1").agent, { files: A }), AT)).graph, task(l, "w1").agent)).graph;
  };

  // (fails before: yes — the count stood for good: a new round's first overlap was refused as the third)
  test("a merge that goes in clears it: the task reopened, its first overlap goes back by itself again", () => {
    const { g, as } = twice();
    assert.equal(rebaseRefusal(g, "sa-1", "w1", "agent", { asked: false, why: "x" }), MERGED_TWICE);
    const merged = taskMerged(g, "w1", A, AT);
    assert.equal(task(merged, "w1").rebases, undefined);
    const again = mergingAgain(ok(merged, { action: "start", id: "w1" }).graph, as);
    assert.equal(rebaseRefusal(again, "sa-1", "w1", "agent", { asked: false, why: "x" }), null);
  });

  // (fails before: yes — the same, for a reopen of one done before the counter was cleared at its merge)
  test("a reopen clears it, and its overlapped mark", () => {
    const { g } = twice();
    const done = /** @type {any} */ (structuredClone(taskMerged(g, "w1", A, AT)));
    Object.assign(task(done, "w1"), { rebases: 2, overlapped: true });
    const r = ok(done, { action: "start", id: "w1" }).graph;
    assert.deepEqual([task(r, "w1").rebases, task(r, "w1").overlapped], [undefined, undefined]);
  });

  // (fails before: yes — a failed task started again kept its two)
  test("a start of the task that failed past its two clears it; the planner's send_back still counts none", () => {
    const { g, as } = twice();
    const failed = /** @type {any} */ (taskMergeFailed(g, "w1", "it overlapped", AT, true));
    assert.deepEqual([task(failed, "w1").state, task(failed, "w1").rebases, task(failed, "w1").overlapped], ["failed", 2, true]);
    const started = ok(failed, { action: "start", id: "w1", note: "redo it on the folder" }).graph;
    assert.deepEqual([task(started, "w1").rebases, task(started, "w1").overlapped], [undefined, undefined]);
    assert.equal(rebaseRefusal(mergingAgain(started, as), task(mergingAgain(started, as), "w1").agent, "w1", "agent", { asked: false, why: "x" }), null);
  });
});

describe("g2: the Plan's merge standing on a writer that shares no file", () => {
  // (fails before: yes — the chip was drawn from shares alone, null for a writer no other task shares files with)
  test("a lone writer sent back by its merge says so on its box", () => {
    let g = ok(null, { action: "add", goal: "g", tasks: [sub("w1", ["src/a.js"])] }).graph;
    g = launched(g, "w1", "sa-1", AT, String(runsAs(task(g, "w1"), "agent")));
    g = /** @type {any} */ (taskEnded(g, "w1", END("sa-1", { files: A }), AT)).graph;
    g = /** @type {any} */ (sentToRebase(/** @type {any} */ (applyAsked(g, "sa-1")).graph, "sa-1", "redo it", { asked: false, why: "src/a.js: both changed line 3" })).graph;
    const view = /** @type {any} */ (graphView(g));
    assert.deepEqual([view.tasks[0].shares, view.tasks[0].merge], [undefined, "sent back to redo, 1 of 2"]);
    const el = drawGraph(view, { h: fakeH, now: 10_000 }).el;
    /** @param {any} n @returns {any[]} */
    const nodes = (n) => (n && typeof n === "object" ? [...(String(n.attrs?.class || "").split(/\s+/).includes("tg-node") ? [n] : []), ...(n.kids || []).flatMap(nodes)] : []);
    const box = nodes(el).find((n) => String(n.attrs["aria-label"]).startsWith("w1 "));
    assert.match(textOf(box), /\|sent back to redo, 1 of 2$/);
    assert.match(String(box.attrs.title), /\nSent back to redo, 1 of 2/);
  });
});
