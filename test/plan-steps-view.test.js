// @ts-check
// The Plan view of a plan's steps (the owner's plan mode of 11-06: high-level steps first, their sub-tasks as the work
// reaches them, in a graph of up to 400 tasks): a step and its sub-tasks are one box, its line, a strip that says how
// many are done and folds them, their lines in the order they run — folded unless one is at work or calls for you, as
// the person leaves it otherwise — a need of any of them a line into the box, a need of one of them a line out of it.
// The head counts the work, never the step it rolls up into; the step's card lists its sub-tasks and no hunt, a
// sub-task's says whose it is; Copy plan indents them; the rail beside the chat draws the same box.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import { BOX, boxesOf, groupsOf, stepsOf } from "../src/ui/harness/lib/graph-boxes.js";
import { drawGraph, planText, stepBoxOf } from "../src/ui/harness/views/task-graph.js";
import { renderPlan } from "../src/ui/harness/views/plan.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";

const T0 = Date.UTC(2026, 10, 6, 9, 0);
const NOW = T0 + 30 * 60_000;
const PLAN = {
  action: "add",
  goal: "Ship plan mode",
  tasks: [
    { id: "map", name: "Map the code" },
    { id: "s1", name: "Sub-tasks in the core", needs: ["map"] },
    { id: "s2", name: "The Plan view", needs: ["s1"] },
    { id: "c1", name: "The under field", under: "s1", writes: ["src/core/task-graph.js"] },
    { id: "c2", name: "The roll-up", under: "s1", needs: ["c1"], writes: ["src/core/task-graph.js"] },
    { id: "c3", name: "The tool words", under: "s1", writes: ["src/app/agent/prompt.js"] },
    { id: "doc", name: "The Guide", needs: ["c3"] },
  ],
};
/** The plan after these calls, a minute apart, as the view draws it. @param {any[]} calls */
function viewAfter(calls) {
  /** @type {any} */
  let g = null;
  calls.forEach((input, i) => {
    const r = /** @type {any} */ (applyTasks(g, input, { at: T0 + i * 60_000, crew: "agent" }));
    assert.ok(r.ok, r.error);
    g = r.graph;
  });
  return /** @type {any} */ (graphView(g));
}
const planned = () => viewAfter([PLAN]);
/** map done, c1 done, c3 running: s1 under way. */
const working = () => viewAfter([PLAN, { action: "start", ids: ["map"] }, { action: "done", id: "map", summary: "Mapped" }, { action: "start", ids: ["c1"] }, { action: "done", id: "c1", summary: "under" }, { action: "start", ids: ["c3"] }]);

/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** A task's line by its id, none where it has no line. @param {any} n @param {string} id */
const lineOf = (n, id) => all(n, (x) => x.attrs?.["data-id"] === id)[0];
/** The ids of the lines drawn, in order. @param {any} n */
const lineIds = (n) => all(n, (x) => !!x.attrs?.["data-id"]).map((x) => x.attrs["data-id"]);

describe("the layout (lib/graph-boxes.js)", () => {
  // (fails before: yes — every sub-task was a box of its own, at the row of its needs, and a step stood under its
  // sub-tasks, as the core's order puts a step after them)
  test("a step and its sub-tasks are one box, in the row of the step's needs; a need of one of them is a line out of the box", () => {
    const v = planned();
    assert.deepEqual([...stepsOf(v.tasks)], [["s1", ["c1", "c3", "c2"]]], "in the order they run: c1 and c3 at once, c2 after c1");
    const lay = boxesOf(v.tasks);
    assert.deepEqual(lay.rows, [["map"], ["s1"], ["s2", "doc"]]);
    assert.deepEqual([...lay.boxes.keys()].sort(), ["doc", "map", "s1", "s2"], "no sub-task has a box of its own");
    assert.deepEqual(lay.lines.map((l) => [l.from, l.to, l.froms, l.tos]), [
      ["map", "s1", ["map"], ["s1"]],
      ["s1", "s2", ["s1"], ["s2"]],
      ["s1", "doc", ["c3"], ["doc"]],
    ]);
  });

  test("the box is as tall as the page draws it; a sub-task's need of another task outside is a line into the box", () => {
    const v = viewAfter([PLAN, { action: "add", tasks: [{ id: "lib", name: "A library" }, { id: "c4", name: "Uses it", under: "s1", needs: ["lib"] }] }]);
    const lay = boxesOf(v.tasks, { tall: (id) => (id === "s1" ? 100 : 0) });
    assert.equal(lay.boxes.get("s1")?.h, BOX.h + 100, "its line, and what the page draws under it");
    const into = lay.lines.find((l) => l.from === "lib");
    assert.deepEqual(into && [into.to, into.froms, into.tos], ["s1", ["lib"], ["c4"]]);
  });

  test("a sub-task dropped stays in its step's box, and a step whose sub-tasks are all dropped stays one box", () => {
    const some = viewAfter([PLAN, { action: "drop", ids: ["c2"], reason: "not needed" }]);
    assert.deepEqual(stepsOf(some.tasks).get("s1"), ["c1", "c3", "c2"]);
    const gone = viewAfter([PLAN, { action: "drop", ids: ["s1", "s2", "doc"], reason: "later" }]);
    assert.deepEqual(stepsOf(gone.tasks).get("s1"), ["c1", "c3", "c2"]);
    assert.deepEqual([...boxesOf(gone.tasks).boxes.keys()].sort(), ["doc", "map", "s1", "s2"]);
  });

  test("a hunt never boxes a step nor a sub-task: a fix found on a sub-task keeps a box of its own", () => {
    const tasks = [...planned().tasks, { id: "f1", needs: ["c1"], state: "waiting", foundBy: { task: "c1" } }];
    assert.equal(groupsOf(tasks).size, 0);
    const lay = boxesOf(tasks);
    assert.ok(lay.boxes.has("f1"));
    assert.deepEqual(lay.lines.filter((l) => l.to === "f1").map((l) => [l.from, l.froms]), [["s1", ["c1"]]]);
  });
});

describe("the core's view of a plan", () => {
  test("a step says its sub-tasks not dropped, and the counts are of the work: a step is in its sub-tasks", () => {
    const v = working();
    assert.deepEqual(v.tasks.find((/** @type {any} */ t) => t.id === "s1").subtasks, ["c1", "c2", "c3"]);
    assert.equal(v.tasks.find((/** @type {any} */ t) => t.id === "c1").subtasks, undefined);
    assert.equal(v.tasks.find((/** @type {any} */ t) => t.id === "s1").state, "running");
    assert.deepEqual([v.counts.total, v.counts.done, v.counts.running], [6, 2, 1], "map and c1 done, c3 running; s1 not counted");
  });
});

describe("the step's box on the page", () => {
  test("folded as it comes while none of its sub-tasks works: its line, then a strip of how many are done; the sub-tasks stand at the strip", () => {
    const g = drawGraph(planned(), { h: fakeH, now: NOW, width: 1200 });
    const box = byClass(g.el, "tg-step-box")[0];
    assert.ok(box, "s1's box");
    assert.match(String(box.attrs.class), /is-folded/);
    assert.deepEqual(lineIds(box), ["s1"], "its own line alone");
    assert.equal(textOf(byClass(box, "tg-step-strip")[0]), "Sub-tasks · 0 of 3 done");
    assert.equal(byClass(box, "tg-step-strip")[0].attrs["aria-expanded"], undefined, "no press where nothing keeps it");
    assert.equal(g.at("c2"), byClass(box, "tg-step-strip")[0], "a sub-task stands where it folded");
    assert.match(lineOf(g.el, "s1").attrs.title, /\n3 sub-tasks, 0 of 3 done(\n|$)/);
    assert.match(textOf(lineOf(g.el, "s1")), /0 of 3 done$/, "its fact: how many are done");
  });

  // (fails before: yes — the head said "2 of 7 done · 2 running": the step was counted beside its sub-tasks)
  test("open while one works: each sub-task's line in the order they run, one waiting says what it waits for; the head counts the work", () => {
    const g = drawGraph(working(), { h: fakeH, now: NOW, width: 1200, atWork: true });
    const box = byClass(g.el, "tg-step-box")[0];
    assert.doesNotMatch(String(box.attrs.class), /is-folded/);
    assert.deepEqual(lineIds(box), ["s1", "c1", "c3", "c2"]);
    assert.equal(textOf(byClass(box, "tg-step-strip")[0]), "Sub-tasks · 1 of 3 done");
    assert.match(textOf(lineOf(box, "c2")), /ready$/, "c1 is done: c2 is ready");
    assert.match(lineOf(box, "c2").attrs.title, /\nPart of s1 Sub-tasks in the core(\n|$)/);
    assert.match(lineOf(box, "c3").attrs["aria-label"], /; part of s1 Sub-tasks in the core/);
    assert.match(textOf(byClass(g.el, "tg-figs")[0]), /^2 of 6 done · 1 running/);
    // Between the agent's turns its own c3 stands still; s1 runs as its sub-tasks do, never as the agent's own work.
    const still = drawGraph(working(), { h: fakeH, now: NOW, width: 1200, atWork: false });
    assert.deepEqual(["s1", "c3"].map((id) => /is-still/.test(String(lineOf(still.el, id).attrs.class))), [false, true]);
  });

  test("as the person leaves it: folded while one works, opened while none does; a sub-task chosen holds it open", () => {
    /** @type {any[]} */
    const pressed = [];
    /** @param {any} view @param {boolean | null} open @param {string | null} [chosen] */
    const drawn = (view, open, chosen = null) => drawGraph(view, { h: fakeH, now: NOW, width: 1200, chosen, steps: { open: () => open, toggle: (id, folded) => void pressed.push([id, folded]) } });
    const shut = byClass(drawn(working(), false).el, "tg-step-box")[0];
    assert.match(String(shut.attrs.class), /is-folded/);
    const strip = byClass(shut, "tg-step-strip")[0];
    assert.deepEqual([strip.tag, strip.attrs["aria-expanded"], strip.attrs.title], ["button", "false", "Show the sub-tasks of s1"]);
    strip.attrs.onclick();
    assert.deepEqual(pressed, [["s1", true]]);
    const opened = byClass(drawn(planned(), true).el, "tg-step-box")[0];
    assert.deepEqual(lineIds(opened), ["s1", "c1", "c3", "c2"]);
    assert.match(textOf(lineOf(opened, "c2")), /after c1$/, "a sub-task waiting on another says which");
    const held = drawn(working(), false, "c2");
    assert.deepEqual(lineIds(byClass(held.el, "tg-step-box")[0]), ["s1", "c1", "c3", "c2"]);
    assert.equal(held.shown?.id, "c2");
  });

  test("the folded strip marks its sub-tasks, a dropped one counted apart; all dropped, it says so", () => {
    const some = viewAfter([PLAN, { action: "drop", ids: ["c2"], reason: "not needed" }]);
    const strip = byClass(drawGraph(some, { h: fakeH, now: NOW }).el, "tg-step-strip")[0];
    assert.equal(textOf(strip), "Sub-tasks · 0 of 2 done · 1 dropped");
    assert.equal(byClass(strip, "tg-mark").length, 2);
    const gone = viewAfter([PLAN, { action: "drop", ids: ["s1", "s2", "doc"], reason: "later" }]);
    assert.equal(textOf(byClass(drawGraph(gone, { h: fakeH, now: NOW }).el, "tg-step-strip")[0]), "Sub-tasks · all 3 dropped");
  });

  test("the step's card lists its sub-tasks and offers no hunt; a sub-task's says whose it is", () => {
    const hunt = { picker: fakeH("button", {}, "model"), busy: () => false, started: () => [], onHunt: () => {} };
    const done = viewAfter([PLAN, { action: "start", ids: ["map"] }, { action: "done", id: "map", summary: "Mapped" }, ...["c1", "c3", "c2"].flatMap((id) => [{ action: "start", ids: [id] }, { action: "done", id, summary: id }])]);
    assert.equal(done.tasks.find((/** @type {any} */ t) => t.id === "s1").state, "done");
    const step = drawGraph(done, { h: fakeH, now: NOW, width: 1200, chosen: "s1", hunt, steps: { open: () => null, toggle: () => {} } });
    const card = byClass(step.el, "tg-card")[0];
    assert.match(textOf(card), /\|Sub-tasks\|3 of 3 done\|/);
    assert.deepEqual(byClass(card, "tg-chip").map(textOf), ["map", "s2", "c1", "c3", "c2"], "what it needs and what needs it in its head, then its sub-tasks");
    assert.equal(byClass(card, "tg-hunt").length, 0, "a step's work is its sub-tasks'");
    const kid = drawGraph(done, { h: fakeH, now: NOW, width: 1200, chosen: "c2", hunt, steps: { open: () => null, toggle: () => {} } });
    assert.match(textOf(byClass(byClass(kid.el, "tg-card")[0], "tg-card-sub")[0]), / · part of s1$/);
    assert.equal(byClass(byClass(kid.el, "tg-card")[0], "tg-hunt").length, 1, "a done sub-task is hunted as any task");
  });

  test("beside the chat the rail draws the same box, and Copy plan indents a step's sub-tasks under it", () => {
    const rail = drawGraph(working(), { h: fakeH, now: NOW, pane: true }).el;
    assert.deepEqual(lineIds(byClass(rail, "tg-step-box")[0]), ["s1", "c1", "c3", "c2"]);
    assert.match(planText(planned()), /\n- \[ \] s1 Sub-tasks in the core — waiting · needs map\n {2}- \[ \] c1 The under field — waiting\n {2}- \[ \] c3 The tool words — waiting\n {2}- \[ \] c2 The roll-up — waiting · needs c1\n/);
  });

  test("a step's box folds as it comes: open while a sub-task works, asks you, failed or waits for its apply", () => {
    const unit = { h: 36, strip: 30 };
    /** @param {string} state */
    const kid = (state) => ({ id: "k", state, needs: [] });
    assert.deepEqual(["waiting", "done", "dropped", "paused"].map((st) => stepBoxOf([kid(st)], null, null, null, unit).folded), [true, true, true, true]);
    assert.deepEqual(["running", "checking", "failed"].map((st) => stepBoxOf([kid(st)], null, null, null, unit).folded), [false, false, false]);
    assert.deepEqual([stepBoxOf([kid("waiting"), kid("done")], true, null, null, unit).tall, stepBoxOf([kid("waiting")], null, null, null, unit).tall], [30 + 72, 30]);
  });
});

describe("the Plan view keeps the person's fold", () => {
  test("a step folded by its strip stays folded as the view draws again, and a sub-task chosen in it lets go", async () => {
    const chat = { id: "steps", chainId: "chain-steps", title: "Steps", turns: [], live: null, view: { settings: {} } };
    const body = fakeH("div");
    const v = renderPlan(body, { chat }, { h: fakeH, api: async () => ({ inForce: { graph: working(), goal: null } }), now: () => NOW });
    await new Promise((r) => setImmediate(r));
    v.paint();
    const box = () => byClass(body, "tg-step-box")[0];
    assert.doesNotMatch(String(box().attrs.class), /is-folded/, "c3 runs");
    lineOf(box(), "c2").attrs.onclick();
    byClass(box(), "tg-step-strip")[0].attrs.onclick();
    assert.match(String(box().attrs.class), /is-folded/);
    v.paint();
    assert.match(String(box().attrs.class), /is-folded/, "kept");
    assert.equal(byClass(body, "tg-card").some((c) => /The roll-up/.test(textOf(c))), false, "c2 chosen let go");
    byClass(box(), "tg-step-strip")[0].attrs.onclick();
    assert.doesNotMatch(String(box().attrs.class), /is-folded/);
  });
});
