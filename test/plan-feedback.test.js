// @ts-check
// Live feedback on a chat's task graph (the owner's of 11-04: "on for the first time todo tasks or task graphs are
// created open the side bar so that user see a live feedback of tasks that are created. keep the bar open until they
// close it. keep the current task in focus if user have not scrolled the list itself and if user is not interacting with
// the list or agent decides to mark the task done then bring that task in focus again ... if users close the side bar and
// when a task just got completed then briefly open the task graph on right bar, focus it, task is marked completed so
// user get a feedback and then close the bar again"; and later the same day: "Todo taska are already shown into the
// transcript, i think it's just the task graph ones that we need to show with some feedback"): the watch
// (lib/plan-watch.js), the Plan view's follow and its marks (views/plan.js, task-graph.js), the peek (views/plan-peek.js)
// and the views' host that ties them (views/host.js).
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { applyPlan, applyTasks, graphView, launched } from "../src/core/task-graph.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { createPlanWatch, planFacts } from "../src/ui/harness/lib/plan-watch.js";
import { JUST_DONE_MS, chooseTask, renderPlan } from "../src/ui/harness/views/plan.js";
import { PEEK_MS, createPlanPeek, peekWords } from "../src/ui/harness/views/plan-peek.js";
import { createViews } from "../src/ui/harness/views/host.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { laidOut } from "./helpers/plan-layout.js";
import { teamIO, modelSelects } from "./helpers/team-view.js";
import { sideIO, sideSeams } from "./helpers/side-view.js";

const T0 = 1_000_000;
/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  for (const k of n?.kids || []) {
    if (!k || typeof k !== "object") continue;
    if (pred(k)) out.push(k);
    all(k, pred, out);
  }
  return out;
};
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
/** The first node under `n` with this class. @param {any} n @param {string} cls */
const one = (n, cls) => byClass(n, cls)[0];
/** A task's box. @param {any} n @param {string} id */
const boxOf = (n, id) => all(n, (x) => x.attrs?.["data-id"] === id)[0];
/** Whether a node wears the mark of a task just done. @param {any} n */
const marked = (n) => String(n?.attrs?.class || "").split(/\s+/).includes("is-just-done");
const settle = () => new Promise((r) => setImmediate(r));

/**
 * The graph after these calls, as the view draws it: a tasks call, or `{ plan }` — a plan call's checklist, which puts
 * its items on the graph (core/task-graph.js `applyPlan`). @param {any[]} calls
 */
function graphAfter(calls) {
  /** @type {any} */
  let g = null;
  calls.forEach((input, i) => {
    const o = { at: T0 + i * 60_000, crew: /** @type {const} */ ("agent") };
    const r = /** @type {any} */ (input.plan ? applyPlan(g, input.plan, o) : applyTasks(g, input, o));
    assert.ok(r.ok, r.error);
    g = r.graph;
  });
  return graphView(g);
}
const ADD = { action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer", needs: [] }, { id: "t2", name: "Parser", needs: ["t1"] }, { id: "t3", name: "Docs", needs: ["t1"] }, { id: "t4", name: "Release", needs: ["t2", "t3"] }] };
/** The four tasks' graph, each id done or started as named. @param {string[]} done @param {string[]} running */
const graphOf = (done, running) => graphAfter([ADD, ...done.flatMap((id) => [{ action: "start", id }, { action: "done", id, summary: id }]), ...running.map((id) => ({ action: "start", id }))]);
/** A checklist of two items, its first as given. @param {string} first @param {string} second */
const itemsOf = (first, second) => [{ text: "Read the parser", status: first }, { text: "Fix it", status: second }];
/** A turn whose run carried these events. @param {any[]} events */
const turnWith = (events) => ({ n: 1, status: "done", aligned: alignEvents(events) });
/** @param {any} graph */
const graphTurn = (graph) => turnWith([{ n: 1, type: "graph", round: 1, graph }]);
/** A turn running, live. @param {any} turn */
const running = (turn) => ({ ...turn, status: "streaming" });
/** A chat in the page with a session. @param {string} id @param {any[]} [turns] */
const chatOf = (id, turns = []) => ({ id, chainId: `chain-${id}`, title: `Chat ${id}`, turns, live: /** @type {any} */ (null), viewTab: /** @type {string | undefined} */ (undefined), view: { settings: { effective: {} } } });
/** A list kept in memory, as this browser's would be. */
const memoryStore = () => {
  /** @type {string[]} */
  let kept = [];
  return { get: () => [...kept], set: (/** @type {string[]} */ c) => { kept = [...c]; } };
};
/** Timers a test runs when it says. */
const timers = () => {
  /** @type {{ fn: () => void, ms: number }[]} */
  const due = [];
  return { due, later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => { due.push({ fn, ms }); }, run: (/** @type {number} */ ms) => { const now = due.filter((d) => d.ms === ms); for (const d of now) due.splice(due.indexOf(d), 1); now.forEach((d) => d.fn()); return now.length; } };
};

describe("the watch: what a chat's task graph did since the page last looked", () => {
  // (fails before: yes — nothing watched a plan: the page said nothing of a task done unless the Plan was open)
  test("a chat's first look is its baseline; a graph that appears after it is its first, once, and a reload's never is", () => {
    const store = memoryStore();
    const w = createPlanWatch({ store });
    const none = planFacts({ graph: null }, "");
    const g = planFacts({ graph: graphOf([], ["t1"]) }, "graph");
    assert.deepEqual(w.see("a", none), { first: false, done: [] }, "no graph yet");
    assert.deepEqual(w.see("a", g), { first: true, done: [] }, "its first graph, while the page watched");
    assert.deepEqual(w.see("a", g), { first: false, done: [] }, "once");
    // Opened with a graph already, the page tells nothing of it; a graph the running turn made is its first all the same.
    assert.deepEqual(w.see("b", g), { first: false, done: [] }, "a chat opened with its graph");
    assert.deepEqual(w.see("c", g, { live: true }), { first: true, done: [] }, "a turn runs: it made it now");
    // A reload: the chats whose graph was shown are this browser's.
    const again = createPlanWatch({ store });
    assert.deepEqual(again.see("a", none), { first: false, done: [] });
    assert.deepEqual(again.see("a", g), { first: false, done: [] }, "shown before the reload");
    assert.deepEqual(store.get(), ["a", "b", "c"]);
  });

  // (fails before: yes — as above)
  test("done: the tasks seen not done and done now; a dropped task is none; forgotten, a chat's next look is its baseline", () => {
    const w = createPlanWatch({ store: memoryStore() });
    const g1 = planFacts({ graph: graphOf(["t1"], ["t2"]) }, "graph");
    assert.deepEqual([g1.items.map((i) => [i.key, i.done]), g1.own, g1.done, g1.all], [[["t1", true], ["t2", false], ["t3", false], ["t4", false]], 4, 1, 4]);
    w.see("g", g1);
    assert.deepEqual(w.see("g", planFacts({ graph: graphOf(["t1", "t2", "t3"], []) }, "graph")).done, ["t2", "t3"]);
    const dropped = planFacts({ graph: graphAfter([ADD, { action: "drop", id: "t4", reason: "Not now" }]) }, "graph");
    assert.deepEqual([dropped.items.map((i) => i.key), dropped.all], [["t1", "t2", "t3"], 3], "a dropped task is out");
    // Forgotten — the chat shown again after another — what was done meanwhile is not told.
    w.forget("g");
    assert.deepEqual(w.see("g", planFacts({ graph: graphOf(["t1", "t2", "t3", "t4"], []) }, "graph")).done, []);
  });

  // (fails before: yes — the owner's of 11-04: the checklist's items, ticked in the conversation already, were told
  // again — opening the right bar, a peek at each item done; and the review of 11-04: a task its checklist named that a
  // worker ended was told nowhere)
  test("the checklist: its own page tells nothing, a graph of its tasks alone is no first, a tick is not told; its task ended by other than a tick is", () => {
    assert.deepEqual(planFacts({ graph: null }, "checklist"), { items: [], own: 0, done: 0, all: 0 });
    const mixed = planFacts({ graph: graphAfter([ADD, { plan: itemsOf("done", "doing") }]) }, "graph");
    assert.deepEqual([mixed.items.map((i) => [i.key, i.ticked]), mixed.own, mixed.done, mixed.all], [[["t1", false], ["t2", false], ["t3", false], ["t4", false], ["p1", true], ["p2", false]], 4, 1, 6], "the graph's head counts them all");
    const w = createPlanWatch({ store: memoryStore() });
    w.see("l", planFacts({ graph: null }, ""));
    const listed = [{ plan: itemsOf("doing", "pending") }];
    assert.deepEqual(w.see("l", planFacts({ graph: graphAfter(listed) }, "graph")), { first: false, done: [] }, "its tasks alone: no first");
    assert.deepEqual(w.see("l", planFacts({ graph: graphAfter([...listed, { plan: itemsOf("done", "doing") }]) }, "graph")), { first: false, done: [] }, "ticked: the conversation showed it");
    assert.deepEqual(w.see("l", planFacts({ graph: graphAfter([...listed, { plan: itemsOf("done", "doing") }, { action: "done", id: "p2", summary: "Fixed the comma" }]) }, "graph")).done, ["p2"], "ended by the agent's word: no tick said so");
  });
});

describe("the Plan view: it follows the work, and marks a task just done", () => {
  // The four tasks down the rail (helpers/plan-layout.js): t1 at 120–152 px, t2 at 156–188, t3 at 192–224, t4 at
  // 228–260; the view 100 px tall.
  /** A Plan beside the chat on a laid-out page, its clock and timers the test's. @param {any} chat */
  const paneOf = (chat) => {
    const page = laidOut({ height: 100 });
    const tick = timers();
    const clock = { t: T0 };
    const body = fakeH("div");
    const view = renderPlan(body, { chat, pane: true }, { h: page.h, api: async () => null, now: () => clock.t, later: tick.later });
    return { page, tick, clock, body, view, scroller: page.scroller(), seen: (/** @type {string} */ id) => page.inSight(boxOf(body, id)) };
  };
  /** The view's top shown, as a scroll of the page's own leaves it. @param {any} scroller */
  const toTop = (scroller) => {
    scroller.scrollTop = 0;
    scroller.dispatch("scroll");
  };

  // (fails before: yes — beside the chat the view followed nothing: the card's task is the person's pick alone there, so
  // the running task ran past the pane's foot)
  test("beside the chat it follows the running task; a scroll by hand holds it until the work passes a task done; a task done is brought into sight however they scrolled, then the work it moved on to", () => {
    const run = (/** @type {any[]} */ more) => graphTurn(graphAfter([ADD, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "t1" }, ...more]));
    const chat = /** @type {any} */ (chatOf("follow-pane", [run([{ action: "start", id: "t2" }])]));
    const v = paneOf(chat);
    assert.deepEqual([v.seen("t2"), v.scroller.scrollTop], [true, 88], "the running task, in sight by the least move");
    // The person scrolls to the top by hand: the work moving on, no task done, leaves the view where they put it.
    v.scroller.dispatch("wheel");
    toTop(v.scroller);
    v.clock.t += 5000;
    const t3Runs = [{ action: "start", id: "t2" }, { action: "change", tasks: [{ id: "t4", needs: ["t3"] }] }, { action: "drop", id: "t2", reason: "Not now" }, { action: "start", id: "t3" }];
    chat.turns = [run(t3Runs)];
    v.view.paint();
    assert.equal(v.scroller.scrollTop, 0, "held: they scrolled it themselves");
    // The work passes a task done: the hold goes, and the view follows the work.
    chat.turns = [run([...t3Runs, { action: "done", id: "t3", summary: "t3" }, { action: "start", id: "t4" }])];
    v.view.paint();
    assert.deepEqual([v.seen("t4"), v.scroller.scrollTop], [true, 160]);
    // The agent's task done is told (lib/plan-watch.js), the view at its top again: brought into sight, marked; a moment
    // on, the work it moved on to.
    toTop(v.scroller);
    v.view.celebrate(["t3"]);
    assert.deepEqual([v.seen("t3"), marked(boxOf(v.body, "t3")), /(^|;)--jd:-0ms$/.test(boxOf(v.body, "t3").attrs.style), v.seen("t4")], [true, true, true, false], "it stays on the task done a moment");
    assert.equal(v.tick.run(1600), 1);
    assert.deepEqual([v.seen("t4"), v.scroller.scrollTop], [true, 160], "then the work it moved on to: the hold went with the done");
    // A step a second on: said in the drawing as it stands, the mark running on in it (task-graph.js `patch`). Drawn
    // again for a move of the work's, the mark keeps its phase; past its time, it is gone.
    v.clock.t += 1000;
    const marking = boxOf(v.body, "t3");
    chat.taskProgress = new Map([["t4", { agent: "sa-1", round: 2, tool: null }]]);
    v.view.paint();
    assert.equal(boxOf(v.body, "t3"), marking, "the mark as it runs");
    chat.turns = [run([...t3Runs, { action: "done", id: "t3", summary: "t3" }, { action: "start", id: "t4" }, { action: "change", goal: "Ship the parser today" }])];
    v.view.paint();
    assert.notEqual(boxOf(v.body, "t3"), marking, "drawn anew");
    assert.match(boxOf(v.body, "t3").attrs.style, /(^|;)--jd:-1000ms$/);
    v.clock.t += JUST_DONE_MS;
    assert.equal(v.tick.run(JUST_DONE_MS), 1);
    assert.equal(marked(boxOf(v.body, "t3")), false, "its time up: drawn unmarked");
  });

  // (fails before: yes — as above; and since the review of 11-04, a pointer resting over the view held it for good: on
  // its tab the view is all the frame)
  test("the person at the view — the pointer moving in it, a key — holds it a moment: a task done is marked where it stands; a pointer resting there is no hold", () => {
    const chat = /** @type {any} */ (chatOf("follow-busy", [graphTurn(graphOf(["t1"], ["t2"]))]));
    const v = paneOf(chat);
    const viewEl = one(v.body, "plan-view");
    toTop(v.scroller);
    viewEl.dispatch("pointermove");
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    v.view.celebrate(["t2"]);
    assert.deepEqual([marked(boxOf(v.body, "t2")), v.scroller.scrollTop, v.tick.due.filter((d) => d.ms === 1600).length], [true, 0, 0]);
    // A moment on, a key: held again.
    v.clock.t += 2500;
    viewEl.dispatch("keydown", { key: "Tab" });
    chat.turns = [graphTurn(graphOf(["t1", "t2", "t3"], ["t4"]))];
    v.view.celebrate(["t3"]);
    assert.deepEqual([marked(boxOf(v.body, "t3")), v.scroller.scrollTop], [true, 0]);
    // A moment on, the pointer only come to rest over it: the task done in sight.
    v.clock.t += 2500;
    viewEl.dispatch("pointerenter");
    chat.turns = [graphTurn(graphOf(["t1", "t2", "t3", "t4"], []))];
    v.view.celebrate(["t4"]);
    // (The layers all done above it fold: its box stands higher.)
    assert.deepEqual([v.seen("t4"), v.scroller.scrollTop > 0], [true, true], "left alone: the task done in sight");
  });

  // (fails before: yes — the review of 11-04: the first done's moment ran out under the second's, and the view went on
  // to the work while the second was barely marked)
  test("a second task done a moment after the first keeps its own moment", () => {
    const chat = /** @type {any} */ (chatOf("follow-two", [graphTurn(graphOf(["t1"], ["t2"]))]));
    const v = paneOf(chat);
    toTop(v.scroller);
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    v.view.celebrate(["t2"]);
    v.clock.t += 800;
    chat.turns = [graphTurn(graphOf(["t1", "t2", "t3"], ["t4"]))];
    v.view.celebrate(["t3"]);
    const stays = v.tick.due.filter((d) => d.ms === 1600);
    assert.equal(stays.length, 2);
    stays[0].fn();
    assert.deepEqual([v.seen("t3"), v.seen("t4")], [true, false], "the first's moment ends: the second's holds");
    stays[1].fn();
    assert.equal(v.seen("t4"), true, "the second's ends: the work it moved on to");
  });

  // (fails before: yes — the review of 11-04: a task done told while the view was hidden waited for its next laid-out
  // draw, and the view jumped back to it whenever that came)
  test("a task done while the view is hidden: marked, and let go — shown again, the view follows the work, not it", () => {
    const chat = /** @type {any} */ (chatOf("follow-hidden", [graphTurn(graphOf([], ["t1"]))]));
    const page = laidOut({ height: 0 });
    const clock = { t: T0 };
    const body = fakeH("div");
    const view = renderPlan(body, { chat, pane: true }, { h: page.h, api: async () => null, now: () => clock.t, later: () => {} });
    chat.turns = [graphTurn(graphOf(["t1"], ["t2"]))];
    view.celebrate(["t1"]);
    assert.equal(marked(boxOf(body, "t1")), true);
    // Shown again a moment on: t1 at 120–152 px would want the view at 52; the work, t2, at 88.
    page.scroller().clientHeight = 100;
    clock.t += 500;
    chat.taskProgress = new Map([["t2", { agent: "sa-1", round: 2, tool: null }]]);
    view.paint();
    assert.deepEqual([page.inSight(boxOf(body, "t2")), page.scroller().scrollTop], [true, 88]);
  });

  // (fails before: yes — a task done whose layer folded had no box to mark)
  test("a task done that folded away is marked on the row that folds it", () => {
    const line = { action: "add", goal: "One after another", tasks: ["a1", "a2", "a3", "a4", "a5"].map((id, i, ids) => ({ id, name: id.toUpperCase(), needs: i ? [ids[i - 1]] : [] })) };
    const g = graphAfter([line, ...["a1", "a2", "a3", "a4"].flatMap((id) => [{ action: "start", id }, { action: "done", id, summary: id }]), { action: "start", id: "a5" }]);
    const v = paneOf(/** @type {any} */ (chatOf("fold-mark", [graphTurn(g)])));
    assert.equal(boxOf(v.body, "a2"), undefined, "folded");
    assert.equal(v.page.inSight(one(v.body, "tg-fold")), false, "the running a5 followed, past the fold");
    v.view.celebrate(["a2"]);
    const fold = one(v.body, "tg-fold");
    assert.deepEqual([marked(fold), v.page.inSight(fold)], [true, true]);
  });
});

// The owner's of 11-11: "when plan view is shown it should show un selected and scroll over to the last task that was
// started and is in progres" — a showing is the view made anew (views/plan.js `renderPlan`): its tab opened, put beside
// the chat, its peek.
describe("the Plan shown anew: no task chosen, the running task that started last in sight", () => {
  // Six tasks that need nothing of each other, one step down the rail (helpers/plan-layout.js): a1 at 120–152 px, a2 at
  // 156–188, a3 at 192–224, a4 at 228–260, a5 at 264–296, a6 at 300–332; the view 100 px tall.
  const SIX = { action: "add", goal: "Six at once", tasks: ["a1", "a2", "a3", "a4", "a5", "a6"].map((id) => ({ id, name: id.toUpperCase(), needs: [] })) };
  /** a1 started first, then a5, then a3: the newest start is a3's, the first running down the rail a1. */
  const three = () => graphAfter([SIX, { action: "start", id: "a1" }, { action: "start", id: "a5" }, { action: "start", id: "a3" }]);
  /** The Plan shown: a view made anew on the laid-out page — beside the chat, or on its tab (`ctx`: {}). @param {any} page @param {any} chat @param {Record<string, any>} [ctx] */
  const shown = (page, chat, ctx = { pane: true }) => {
    const body = fakeH("div");
    const view = renderPlan(body, { chat, ...ctx }, { h: page.h, api: async () => null, now: () => T0 + 600_000, later: () => {} });
    return { body, view, scroller: page.scroller() };
  };
  /** The tasks pressed, by their ids. @param {any} body */
  const pressed = (body) => all(body, (x) => x.attrs?.["data-id"] && x.attrs["aria-pressed"] === "true").map((x) => x.attrs["data-id"]);
  /** A scroll of the person's own, to the view's top. @param {any} scroller */
  const byHandToTop = (scroller) => {
    scroller.dispatch("wheel");
    scroller.scrollTop = 0;
    scroller.dispatch("scroll");
  };

  // (fails before: yes — the task pressed in a showing stood pressed in the next, its card open under it: the view kept
  // the choice for the chat, whichever view of it showed)
  test("shown, a task chosen, out of sight, shown again: none chosen, no card open — beside the chat, and on its tab the page's own pick", () => {
    const page = laidOut({ height: 100 });
    const chat = /** @type {any} */ (chatOf("shown-none", [graphTurn(graphOf(["t1"], ["t2"]))]));
    const first = shown(page, chat);
    boxOf(first.body, "t4").dispatch("click");
    assert.deepEqual([pressed(first.body), byClass(first.body, "tg-icard").length], [["t4"], 1], "chosen in this showing: its card under its line");
    // The pane closed, and the Plan put beside the chat again: the choice ended with the showing it was made in.
    const again = shown(page, chat);
    assert.deepEqual([pressed(again.body), byClass(again.body, "tg-icard").length, byClass(again.body, "tg-card").length], [[], 0, 0]);
    // On its tab too (the owner's of 11-11, the Plan "whichever way it is shown"): no card opens by itself.
    const tab = /** @type {any} */ (chatOf("shown-none-tab", [graphTurn(graphOf(["t1"], ["t2"]))]));
    const before = shown(page, tab, {});
    boxOf(before.body, "t4").dispatch("click");
    assert.deepEqual([pressed(before.body), textOf(one(before.body, "tg-card")).split("|").slice(0, 2)], [["t4"], ["t4", "Release"]]);
    const after = shown(page, tab, {});
    assert.deepEqual([pressed(after.body), byClass(after.body, "tg-card").length], [[], 0]);
  });

  // (fails before: yes — the view followed the first running task down the plan, a1 here, whichever started last; shown
  // again it stayed wherever it was left)
  test("several tasks in progress: the one that started last is brought into sight, at each showing", () => {
    const page = laidOut({ height: 100 });
    const chat = /** @type {any} */ (chatOf("shown-last", [graphTurn(three())]));
    const first = shown(page, chat);
    assert.deepEqual([page.inSight(boxOf(first.body, "a3")), first.scroller.scrollTop], [true, 124], "a3, started last: its foot at the view's");
    // Left at its top, by hand; shown again, a3 in sight again: a scroll of the showing before holds nothing —
    byHandToTop(first.scroller);
    const again = shown(page, chat);
    assert.deepEqual([page.inSight(boxOf(again.body, "a3")), again.scroller.scrollTop], [true, 124]);
    // — nor as the work moves on in this one: a1 and a3 dropped, the view goes on to a5, running still.
    const dropped = [SIX, { action: "start", id: "a1" }, { action: "start", id: "a5" }, { action: "start", id: "a3" }, { action: "drop", id: "a1", reason: "Not now" }, { action: "drop", id: "a3", reason: "Not now" }];
    chat.turns = [graphTurn(graphAfter(dropped))];
    again.view.paint();
    assert.deepEqual([page.inSight(boxOf(again.body, "a5")), again.scroller.scrollTop], [true, 196]);
    // A task started since is the one, at the showing after it.
    chat.turns = [graphTurn(graphAfter([...dropped, { action: "start", id: "a6" }]))];
    const later = shown(page, chat);
    assert.deepEqual([page.inSight(boxOf(later.body, "a6")), later.scroller.scrollTop], [true, 232]);
  });

  // (fails before: yes — as above: the first running task, the step s1, was followed)
  test("a sub-task in progress counts as itself: its own line in its step's box, not its step's, which starts as it does", () => {
    // Down the rail: s1 at 120–152 px, the step s2 at 156–188, its sub-tasks k1 at 192–224 and k2 at 228–260.
    const STEPS = { action: "add", goal: "Two steps", tasks: [{ id: "s1", name: "Step one", needs: [] }, { id: "s2", name: "Step two", needs: [] }, { id: "k1", name: "Kid one", under: "s2" }, { id: "k2", name: "Kid two", under: "s2" }] };
    const page = laidOut({ height: 100 });
    // k1 started after s1, and its step s2 with it, at the same moment: k1 is the one.
    const begun = /** @type {any} */ (graphAfter([STEPS, { action: "start", id: "s1" }, { action: "start", id: "k1" }]));
    assert.deepEqual(begun.tasks.filter((/** @type {any} */ t) => t.state === "running").map((/** @type {any} */ t) => [t.id, t.startedAt - T0]), [["s1", 60_000], ["s2", 120_000], ["k1", 120_000]]);
    const first = shown(page, /** @type {any} */ (chatOf("shown-sub", [graphTurn(begun)])));
    assert.deepEqual([page.inSight(boxOf(first.body, "k1")), first.scroller.scrollTop], [true, 124]);
    const second = shown(page, /** @type {any} */ (chatOf("shown-sub-next", [graphTurn(graphAfter([STEPS, { action: "start", id: "s1" }, { action: "start", id: "k1" }, { action: "start", id: "k2" }]))])));
    assert.deepEqual([page.inSight(boxOf(second.body, "k2")), second.scroller.scrollTop], [true, 160]);
  });

  // (fails before: yes — the canvas went to the page's own pick, c3, the first running task as the plan lists them)
  test("on its tab: the canvas brings the task that started last into sight, the page left where it is", () => {
    // c1 → c2 → c3 one under another and c4 apart, beside c1; the canvas 100 px tall, the graph fitted to it at 80%: c4's
    // box at 19.2–60.8 px of it, c3's at 166.4–208.
    const DEEP = { action: "add", goal: "Deep", tasks: [{ id: "c1", name: "One", needs: [] }, { id: "c2", name: "Two", needs: ["c1"] }, { id: "c3", name: "Three", needs: ["c2"] }, { id: "c4", name: "Apart", needs: [] }] };
    const down = [{ action: "start", id: "c1" }, { action: "done", id: "c1", summary: "c1" }, { action: "start", id: "c2" }, { action: "done", id: "c2", summary: "c2" }, { action: "start", id: "c3" }];
    const at = (/** @type {any} */ page) => Math.round(page.canvas().scrollTop * 10) / 10;
    // c4 started last: in sight where the canvas opens, which stays at its start.
    const page = laidOut({ height: 600, canvas: 100 });
    const last = shown(page, /** @type {any} */ (chatOf("shown-canvas", [graphTurn(graphAfter([DEEP, ...down, { action: "start", id: "c4" }]))])), {});
    assert.deepEqual([page.inSight(boxOf(last.body, "c4")), page.inSight(boxOf(last.body, "c3")), last.scroller.scrollTop, at(page)], [true, false, 0, 0]);
    // c4 started first, c3 last: the canvas goes down to c3.
    const other = laidOut({ height: 600, canvas: 100 });
    const first = shown(other, /** @type {any} */ (chatOf("shown-canvas-first", [graphTurn(graphAfter([DEEP, { action: "start", id: "c4" }, ...down]))])), {});
    assert.deepEqual([other.inSight(boxOf(first.body, "c3")), first.scroller.scrollTop, at(other)], [true, 0, 108]);
  });

  // (fails before: yes — its last part: the task chosen from elsewhere stayed chosen in the showing after its own)
  test("a task chosen from elsewhere for this showing is the one chosen and brought into sight; the showing after it has none", () => {
    const page = laidOut({ height: 100 });
    const chat = /** @type {any} */ (chatOf("shown-elsewhere", [graphTurn(three())]));
    // Chosen in a showing, then another chosen from elsewhere — a waiting card of the Team view: the Plan opens on that one.
    boxOf(shown(page, chat).body, "a1").dispatch("click");
    chooseTask(chat, "a6");
    const opened = shown(page, chat);
    assert.deepEqual([pressed(opened.body), byClass(opened.body, "tg-icard").length, page.inSight(boxOf(opened.body, "a6")), page.inSight(boxOf(opened.body, "a3"))], [["a6"], 1, true, false]);
    // Its showing over, the next opens as any: none chosen, a3 — started last — in sight, by the least move from where
    // the view was left: its head at the view's.
    const next = shown(page, chat);
    assert.deepEqual([pressed(next.body), page.inSight(boxOf(next.body, "a3")), next.scroller.scrollTop], [[], true, 192]);
  });

  // (fails before: yes — its first line alone, where the showing went to a1; the rest held before as it holds now)
  test("while it stays shown: a scroll of the person's own and their pick hold through the draws that follow, a task started since moving nothing", () => {
    const page = laidOut({ height: 100 });
    const chat = /** @type {any} */ (chatOf("shown-holds", [graphTurn(three())]));
    const v = shown(page, chat);
    assert.equal(v.scroller.scrollTop, 124);
    // A draw that follows — a task's step from the feed — leaves the view on a3: the showing went there once, and the
    // view's own task, a1, counts as followed.
    chat.taskProgress = new Map([["a3", { agent: "sa-1", round: 1, tool: null }]]);
    v.view.paint();
    assert.deepEqual([page.inSight(boxOf(v.body, "a3")), v.scroller.scrollTop], [true, 124]);
    // The person scrolls to the top: the next draw leaves the view there.
    byHandToTop(v.scroller);
    chat.taskProgress = new Map([["a3", { agent: "sa-1", round: 2, tool: null }]]);
    v.view.paint();
    assert.equal(v.scroller.scrollTop, 0, "held where they put it");
    // A task started since, in the same showing: the view's own task is a1 still, and it stays put.
    chat.turns = [graphTurn(graphAfter([SIX, { action: "start", id: "a1" }, { action: "start", id: "a5" }, { action: "start", id: "a3" }, { action: "start", id: "a6" }]))];
    v.view.paint();
    assert.deepEqual([boxOf(v.body, "a6").attrs.class.includes("is-running"), v.scroller.scrollTop], [true, 0]);
    // Their pick holds as the view draws again, its card under its line; pressed again beside the chat, it closes (D14).
    boxOf(v.body, "a5").dispatch("click");
    chat.taskProgress = new Map([["a3", { agent: "sa-1", round: 3, tool: null }]]);
    v.view.paint();
    assert.deepEqual([pressed(v.body), byClass(v.body, "tg-icard").length, v.scroller.scrollTop], [["a5"], 1, 0]);
    boxOf(v.body, "a5").dispatch("click");
    assert.deepEqual([pressed(v.body), byClass(v.body, "tg-icard").length], [[], 0]);
  });

  // (fails before: no — what the page did before, kept: with nothing in progress the view follows its own task once,
  // then opens where it was left)
  test("no task in progress: as before — the view's own task followed once, then the view where it was left", () => {
    const page = laidOut({ height: 100 });
    // t1 done, t2 and t3 ready, nothing started: the view's own task is t2, the first that can start.
    const chat = /** @type {any} */ (chatOf("shown-idle", [graphTurn(graphOf(["t1"], []))]));
    const first = shown(page, chat);
    assert.deepEqual([page.inSight(boxOf(first.body, "t2")), first.scroller.scrollTop], [true, 88]);
    first.scroller.scrollTop = 30;
    first.scroller.dispatch("scroll");
    const again = shown(page, chat);
    assert.deepEqual([again.scroller.scrollTop, pressed(again.body)], [30, []], "where it was left");
  });
});

// The owner's of 11-11 holds on the tab too: "it should show un selected" — no card opens by itself, on a showing or
// while it stays shown; the person's press opens one.
describe("the Plan's tab: no task chosen until the person chooses one", () => {
  /** The Plan's tab drawn on the laid-out page. @param {any} page @param {any} chat */
  const tabOf = (page, chat) => {
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => T0 + 600_000, later: () => {} });
    return { body, view };
  };
  /** The tasks pressed, by their ids. @param {any} body */
  const pressed = (body) => all(body, (x) => x.attrs?.["data-id"] && x.attrs["aria-pressed"] === "true").map((x) => x.attrs["data-id"]);
  /** The canvas's scroll, to a tenth. @param {any} page */
  const at = (page) => [Math.round(page.canvas().scrollLeft * 10) / 10, Math.round(page.canvas().scrollTop * 10) / 10];

  // (fails before: yes — the page opened the card of its own pick (D17), the first running task's, beside the canvas,
  // and a task that asked you while it showed took the card)
  test("shown: none chosen, no card, the canvas the page's whole width; a task that asks you while it stays shown is brought into sight, its card not opened", () => {
    // t1 done; t4, a sub-agent's, launched; then t2 started, the newest. Down the canvas at 80%: t2's box at 92.8–134.4
    // px, t4's at 166.4–208; the canvas 100 px tall.
    const WORKER = { ...ADD, tasks: ADD.tasks.map((t) => (t.id === "t4" ? { ...t, by: "sub-agent", goal: "Released", steps: ["Tag it"], acceptance: "npm view shows it", writes: ["src/release.js"] } : t)) };
    /** @type {any} */
    let g = null;
    for (const [input, at] of /** @type {[any, number][]} */ ([[WORKER, T0], [{ action: "start", id: "t1" }, T0 + 60_000], [{ action: "done", id: "t1", summary: "t1" }, T0 + 120_000]])) g = /** @type {any} */ (applyTasks(g, input, { at, crew: "agent" })).graph;
    g = launched(g, "t4", "sa-4", T0 + 180_000, "sub-agent");
    g = /** @type {any} */ (applyTasks(g, { action: "start", id: "t2" }, { at: T0 + 240_000, crew: "agent" })).graph;
    const page = laidOut({ height: 600, canvas: 100, width: 1640 });
    const chat = /** @type {any} */ (chatOf("tab-none", [graphTurn(graphView(g))]));
    const v = tabOf(page, chat);
    assert.deepEqual([pressed(v.body), byClass(v.body, "tg-card").length, one(v.body, "tg-body").attrs.class], [[], 0, "tg-body is-under"], "no card, the canvas all the room");
    assert.deepEqual([page.inSight(boxOf(v.body, "t2")), at(page)], [true, [0, 34.4]], "t2, started last, in sight");
    // A minute on, t4's worker asks you: the view brings it into sight; no card opens by itself.
    chat.taskProgress = new Map([["t4", { agent: "sa-4", round: 2, tool: null, asking: { tool: "bash", args: "npm publish" } }]]);
    v.view.paint();
    assert.deepEqual([boxOf(v.body, "t4").attrs.class.includes("is-asking"), page.inSight(boxOf(v.body, "t4")), at(page)], [true, true, [0, 108]]);
    assert.deepEqual([pressed(v.body), byClass(v.body, "tg-card").length], [[], 0]);
  });

  // (fails before: yes — the page's own pick's card stood beside the canvas from the start, the canvas narrower; and
  // pressed again, a card on the tab never closed)
  test("the person's press opens its card beside the canvas, the task kept in sight as the canvas narrows to it; pressed again, the card closes and the canvas has its room back", () => {
    // Twelve tasks under one, 3316 px drawn, at 80% as the page opens (2653 px) in a canvas of 1598 px, 1196 beside a card.
    const FORK = { action: "add", goal: "Fork", tasks: [{ id: "r", name: "Root", needs: [] }, ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i + 1}`, name: `Part ${i + 1}`, needs: ["r"] }))] };
    const page = laidOut({ height: 900, canvas: 400, width: 1640 });
    const chat = /** @type {any} */ (chatOf("tab-press", [graphTurn(graphAfter([FORK]))]));
    const v = tabOf(page, chat);
    // The person pans to the canvas's far right: a12 in sight, at its right edge.
    page.canvas().scrollLeft = 1055;
    page.canvas().dispatch("scroll");
    assert.deepEqual([byClass(v.body, "tg-card").length, page.inSight(boxOf(v.body, "a12"))], [0, true]);
    boxOf(v.body, "a12").dispatch("click");
    assert.deepEqual([pressed(v.body), one(v.body, "tg-body").attrs.class, textOf(one(v.body, "tg-card")).split("|").slice(0, 2)], [["a12"], "tg-body is-beside", ["a12", "Part 12"]]);
    assert.equal(page.inSight(boxOf(v.body, "a12")), true, "brought back into the narrower canvas, by the least move");
    // A redraw while it stays shown keeps the pick and the card.
    chat.taskProgress = new Map([["a1", { agent: "", round: 1, tool: null }]]);
    v.view.paint();
    assert.deepEqual([pressed(v.body), byClass(v.body, "tg-card").length], [["a12"], 1]);
    // Pressed again: the card closes, the canvas has the room back, a12 where it was.
    boxOf(v.body, "a12").dispatch("click");
    assert.deepEqual([pressed(v.body), byClass(v.body, "tg-card").length, one(v.body, "tg-body").attrs.class, page.inSight(boxOf(v.body, "a12"))], [[], 0, "tg-body is-under", true]);
  });
});

describe("the peek: a task done where the Plan is in sight nowhere", () => {
  const facts = planFacts({ graph: graphOf(["t1", "t2"], ["t3"]) }, "graph");
  /** A peek on the fake DOM, what it drew and what it was told. */
  const peekOf = (/** @type {{ hidden?: boolean }} */ o = {}) => {
    const frame = fakeH("section", { class: "conv-frame frame" });
    const tick = timers();
    /** @type {any[]} */
    const gone = [];
    /** @type {any[][]} */
    const told = [];
    let kept = 0;
    const mk = /** @type {any} */ ((/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = fakeH(tag, attrs, ...kids);
      if (attrs?.class === "plan-peek") n.remove = () => gone.push(n);
      return n;
    });
    const peek = createPlanPeek({
      frame,
      mk,
      later: tick.later,
      hidden: () => !!o.hidden,
      draw: (body, chat) => {
        told.push(["draw", chat.id]);
        return { paint: () => told.push(["paint"]), celebrate: (ids) => told.push(["celebrate", ...ids]) };
      },
      keep: () => { kept += 1; },
    });
    return { frame, tick, gone, told, peek, kept: () => kept, card: () => one(frame, "plan-peek") };
  };

  // (fails before: yes — with the right bar closed, a task done said nothing)
  test("it slides in with the task done, says it, stays while the pointer is on it, and slides out", () => {
    const p = peekOf();
    const chat = chatOf("peek");
    p.peek.show(chat, ["t2"], facts);
    const card = p.card();
    // Its words said a moment after its card is on the page: a screen reader tells what a live region's words become.
    assert.deepEqual([card.classList.contains("is-open"), textOf(one(card, "pk-title")), one(card, "pk-title").attrs.role, card.style.top], [true, "", "status", undefined]);
    assert.equal(p.tick.run(60), 1);
    assert.deepEqual([textOf(one(card, "pk-title")), textOf(one(card, "pk-sub"))], ["Done: Parser", "Task graph · 2 of 4 done"]);
    assert.deepEqual(p.told, [["draw", "peek"], ["celebrate", "t2"]], "the Plan's page in it, the task done marked");
    // The pointer on it: its time comes and goes; it stays. Off it: a moment on, it slides out.
    card.dispatch("pointerenter");
    p.tick.run(PEEK_MS);
    assert.equal(p.peek.shows(), true);
    card.dispatch("pointerleave");
    p.tick.run(1500);
    assert.deepEqual([p.peek.shows(), card.classList.contains("is-open"), p.gone.length], [false, false, 0]);
    p.tick.run(280);
    assert.equal(p.gone.length, 1, "slid out, then gone");
  });

  // (fails before: yes — as above)
  test("another task done while it shows: said, marked, and its time starts again; Keep open puts the Plan beside the chat", () => {
    const p = peekOf();
    const chat = chatOf("peek-more");
    p.peek.show(chat, ["t1"], facts);
    p.peek.show(chat, ["t2", "t3"], facts);
    assert.equal(byClass(p.frame, "plan-peek").length, 1, "one peek");
    assert.equal(textOf(one(p.card(), "pk-title")), "2 done: Parser, Docs");
    assert.deepEqual(p.told.at(-1), ["celebrate", "t2", "t3"]);
    // The first show's words, said late, are the newest.
    p.tick.run(60);
    assert.equal(textOf(one(p.card(), "pk-title")), "2 done: Parser, Docs");
    // The first time running out goes by: the newer one holds it.
    const times = p.tick.due.filter((d) => d.ms === PEEK_MS);
    assert.equal(times.length, 2);
    times[0].fn();
    assert.equal(p.peek.shows(), true);
    buttonsOf(p.card()).find((b) => textOf(b) === "Keep open")?.dispatch("click");
    assert.deepEqual([p.kept(), p.peek.shows(), p.gone.length], [1, false, 1], "the Plan beside the chat, the peek gone at once");
    // Another chat's peek takes the place of this one's; a hidden page shows none.
    p.peek.show(chat, ["t1"], facts);
    p.peek.show(chatOf("peek-other"), ["t1"], facts);
    assert.deepEqual(p.told.filter((x) => x[0] === "draw").map((x) => x[1]), ["peek-more", "peek-more", "peek-other"]);
    const hid = peekOf({ hidden: true });
    hid.peek.show(chat, ["t1"], facts);
    assert.equal(hid.peek.shows(), false);
  });

  // (fails before: yes — the review of 11-04: the peek lay over the find bar, its search out of sight; and the drive of
  // 11-04: beside the floating right bar it dropped under a find bar that stood apart from it)
  test("the find bar open over the peek's place: the peek stands under it; apart from it, where it is; opened or closed while it shows, it moves at the next pulse", () => {
    /** A peek whose card stands at 500–860 px across the frame, the find bar open where given. @param {number | null} left */
    const withBar = (left) => {
      const frame = fakeH("section", { class: "conv-frame frame" });
      const bar = { offsetTop: 8, offsetHeight: 40, offsetLeft: left, offsetWidth: 336 };
      frame.querySelector = (/** @type {string} */ sel) => (sel === ".find-bar:not(.hidden)" && bar.offsetLeft !== null ? bar : null);
      const mk = /** @type {any} */ ((/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => Object.assign(fakeH(tag, attrs, ...kids), attrs?.class === "plan-peek" ? { offsetLeft: 500, offsetWidth: 360 } : {}));
      const peek = createPlanPeek({ frame, mk, later: () => {}, hidden: () => false, draw: () => ({ paint: () => {}, celebrate: () => {} }), keep: () => {} });
      peek.show(chatOf("peek-find"), ["t1"], facts);
      return { bar, peek, top: () => one(frame, "plan-peek").style.top };
    };
    assert.equal(withBar(520).top(), "56px", "over it");
    assert.equal(withBar(900).top(), undefined, "apart: beside the floating right bar");
    const p = withBar(null);
    p.bar.offsetLeft = 520;
    p.peek.refresh();
    assert.equal(p.top(), "56px", "opened since");
    p.bar.offsetLeft = null;
    p.peek.refresh();
    assert.equal(p.top(), "", "closed since: where views.css puts it");
  });

  test("its words: one task, several, or the graph just made — and how much of the graph is done, as its head counts it", () => {
    assert.deepEqual(peekWords([], facts), { title: "A task graph of 4 tasks", sub: "Task graph · 2 of 4 done" });
    assert.equal(peekWords(["t2"], facts).title, "Done: Parser");
    assert.equal(peekWords(["t2", "t3"], facts).title, "2 done: Parser, Docs");
    const mixed = planFacts({ graph: graphAfter([ADD, { plan: itemsOf("done", "doing") }]) }, "graph");
    assert.deepEqual(peekWords([], mixed), { title: "A task graph of 6 tasks", sub: "Task graph · 1 of 6 done" }, "the checklist's tasks counted as the head counts them");
  });
});

describe("the views' host: a chat's task graph, live", () => {
  /** A host on the fake DOM with the Plan beside the chat as the test keeps it. @param {any} [more] */
  /** @param {Record<string, any>} [more] @param {any} [h]  the page's `h`: a laid-out one (helpers/plan-layout.js) */
  function hostOf(more = {}, h = fakeH) {
    const frame = fakeH("section", { class: "conv-frame frame" });
    const slot = fakeH("div", { class: "view-tabs-slot" });
    const tick = timers();
    const beside = { held: false, inSight: false, room: true, opened: /** @type {any[]} */ ([]), body: fakeH("div") };
    // The peek leaves the frame as a page's node would.
    const mk = /** @type {any} */ ((/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = h(tag, attrs, ...kids);
      if (attrs?.class === "plan-peek") n.remove = () => { frame.kids = frame.kids.filter((/** @type {any} */ k) => k !== n); };
      return n;
    });
    /** @type {any} */
    let views = null;
    /** @type {any} */
    let chatNow = null;
    // The right bar, as the test has it: opened where the room holds it, its pane drawn for the chat shown.
    const besidePlan = {
      open: (/** @type {any} */ o) => {
        beside.opened.push(o || {});
        beside.held = true;
        if (!beside.room) return;
        beside.inSight = true;
        beside.body = fakeH("div");
        views.planPane(beside.body, chatNow);
      },
      close: () => { beside.held = false; beside.inSight = false; },
      shown: () => beside.held,
      inSight: () => beside.inSight,
    };
    views = createViews({
      frame,
      slot,
      overview: { el: fakeH("div", {}), setShown: () => {}, paint: () => {} },
      mk,
      api: async () => null,
      openAgent: () => {},
      openRunLog: () => {},
      onShow: () => {},
      loadRun: () => new Promise(() => {}),
      later: tick.later,
      team: teamIO(),
      side: /** @type {any} */ (sideIO()),
      sideSeams: sideSeams().seams,
      place: (p, k) => p.replaceChildren(...k), drawIn: fakeDrawIn,
      modelSelect: modelSelects().make,
      besidePlan,
      planWatch: createPlanWatch({ store: memoryStore() }),
      ...more,
    });
    return {
      frame, tick, beside, views,
      /** @param {any} c */
      open: async (c) => { chatNow = c; views.setChat(c); await settle(); },
      /** The Plan put beside the chat, as Beside the chat puts it. */
      openBeside: () => besidePlan.open({}),
      /** The Plan out of sight: the right bar closed. */
      closeBeside: () => besidePlan.close(),
      /** The run moved: one pulse. */
      pulse: () => { views.pulse(); tick.run(1200); },
      /** The peek's words, once said. */
      peekTitle: () => { tick.run(60); return textOf(one(one(frame, "plan-peek"), "pk-title")); },
    };
  }
  /** A chat's run, live, at this turn. @param {any} chat @param {any} turn */
  const liveAt = (chat, turn) => {
    chat.turns = [turn];
    chat.live = { turn };
  };

  // (fails before: yes — a chat's first graph stayed out of sight until the person opened it)
  test("a chat's first graph opens the Plan beside the chat, where the window has room, once; with no room, the peek shows it", async () => {
    const host = hostOf();
    const chat = /** @type {any} */ (chatOf("host-first"));
    await host.open(chat);
    host.pulse();
    assert.deepEqual(host.beside.opened, [], "no graph yet");
    liveAt(chat, running(graphTurn(graphOf([], ["t1"]))));
    host.pulse();
    assert.deepEqual(host.beside.opened, [{ asked: false }], "its first graph: beside the chat, as the room has it");
    assert.ok(boxOf(host.beside.body, "t1"), "drawn there");
    // The person closes it: the work going on never opens it again.
    host.closeBeside();
    liveAt(chat, running(graphTurn(graphOf(["t1"], ["t2"]))));
    host.pulse();
    assert.equal(host.beside.opened.length, 1);
    // A window with no room for it: the peek says the graph instead.
    const narrow = hostOf();
    narrow.beside.room = false;
    const c2 = /** @type {any} */ (chatOf("host-first-narrow"));
    await narrow.open(c2);
    narrow.pulse();
    liveAt(c2, running(graphTurn(graphOf([], ["t1"]))));
    narrow.pulse();
    assert.equal(narrow.peekTitle(), "A task graph of 4 tasks");
  });

  // (fails before: yes — the owner's of 11-04: "Todo taska are already shown into the transcript": a checklist opened the
  // right bar, and each item done slid a peek in)
  test("a checklist tells nothing, on its own page or as the graph's tasks; the agent's own tasks on the graph do", async () => {
    const host = hostOf();
    const chat = /** @type {any} */ (chatOf("host-list"));
    await host.open(chat);
    host.pulse();
    // The checklist alone, its own page.
    const listTurn = (/** @type {any[]} */ items) => running(turnWith([{ n: 1, type: "plan", round: 1, items }]));
    liveAt(chat, listTurn(itemsOf("doing", "pending")));
    host.pulse();
    liveAt(chat, listTurn(itemsOf("done", "doing")));
    host.pulse();
    assert.deepEqual([host.beside.opened, one(host.frame, "plan-peek")], [[], undefined], "its own page");
    // The checklist on the graph: its tasks, and their ticks, are the conversation's to show.
    const mirrored = (/** @type {any[]} */ calls, /** @type {any[]} */ items) => running(turnWith([{ n: 1, type: "plan", round: 1, items }, { n: 2, type: "graph", round: 1, graph: graphAfter(calls) }]));
    liveAt(chat, mirrored([{ plan: itemsOf("doing", "pending") }], itemsOf("doing", "pending")));
    host.pulse();
    liveAt(chat, mirrored([{ plan: itemsOf("done", "doing") }], itemsOf("done", "doing")));
    host.pulse();
    assert.deepEqual([host.beside.opened, one(host.frame, "plan-peek")], [[], undefined], "on the graph");
    // The agent adds tasks of its own: its first graph; one of them done is told.
    liveAt(chat, running(graphTurn(graphAfter([{ plan: itemsOf("done", "doing") }, ADD, { action: "start", id: "t1" }]))));
    host.pulse();
    assert.deepEqual(host.beside.opened, [{ asked: false }]);
    host.closeBeside();
    liveAt(chat, running(graphTurn(graphAfter([{ plan: itemsOf("done", "done") }, ADD, { action: "start", id: "t1" }, { action: "done", id: "t1", summary: "t1" }]))));
    host.pulse();
    assert.equal(host.peekTitle(), "Done: Lexer", "the item ticked alongside it is not");
  });

  // (fails before: yes — the review of 11-04: any turn running made a plan the page had not seen its first, so a chat
  // opened mid-turn with an old plan opened the right bar)
  test("a chat opened while a turn runs that made no graph: its old graph stays where it is", async () => {
    const host = hostOf();
    const turn = { ...turnWith([{ n: 1, type: "text", round: 1, text: "Looking" }]), n: 2, status: "streaming" };
    const chat = /** @type {any} */ (chatOf("host-old", [graphTurn(graphOf(["t1"], ["t2"])), turn]));
    chat.live = { turn };
    await host.open(chat);
    host.pulse();
    assert.deepEqual([host.beside.opened, one(host.frame, "plan-peek")], [[], undefined]);
    // The watch has it: a task done is told.
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"])), turn];
    host.pulse();
    assert.deepEqual([host.beside.opened, host.peekTitle()], [[], "Done: Parser"]);
    // (fails before: yes — the review of 11-04: a turn that only ticked its checklist moved the graph, and so made an old
    // graph the chat's first)
    // A turn that only ticks its checklist, the graph moved with it: the old graph stays where it is all the same.
    const other = hostOf();
    const before = [ADD, { action: "start", id: "t1" }, { plan: itemsOf("doing", "pending") }];
    const ticking = { ...turnWith([{ n: 1, type: "plan", round: 1, items: itemsOf("done", "doing") }, { n: 2, type: "graph", round: 1, graph: graphAfter([...before, { plan: itemsOf("done", "doing") }]) }]), n: 2, status: "streaming" };
    const c2 = /** @type {any} */ (chatOf("host-old-ticks", [graphTurn(graphAfter(before)), ticking]));
    c2.live = { turn: ticking };
    await other.open(c2);
    other.pulse();
    assert.deepEqual([other.beside.opened, one(other.frame, "plan-peek")], [[], undefined]);
  });

  // (fails before: yes — the review of 11-04: a chat shown again told every task done while another chat showed)
  test("back to a chat: what was done while another showed is not told", async () => {
    const host = hostOf();
    const chat = /** @type {any} */ (chatOf("host-back", [graphTurn(graphOf([], ["t1"]))]));
    await host.open(chat);
    host.pulse();
    await host.open(/** @type {any} */ (chatOf("host-other")));
    host.pulse();
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    await host.open(chat);
    host.pulse();
    assert.equal(one(host.frame, "plan-peek"), undefined);
    // From there on, as ever.
    chat.turns = [graphTurn(graphOf(["t1", "t2", "t3"], ["t4"]))];
    host.pulse();
    assert.equal(host.peekTitle(), "Done: Docs");
  });

  // (fails before: yes — a task done said nothing where the Plan was not open, and was not marked where it was)
  test("a task done: marked beside the chat where the Plan is in sight there, on its tab where that shows, else in the peek", async () => {
    const host = hostOf();
    const chat = /** @type {any} */ (chatOf("host-done", [graphTurn(graphOf([], ["t1"]))]));
    await host.open(chat);
    host.pulse();
    // In sight beside the chat.
    host.openBeside();
    chat.turns = [graphTurn(graphOf(["t1"], ["t2"]))];
    host.pulse();
    assert.equal(marked(boxOf(host.beside.body, "t1")), true, "marked beside the chat");
    assert.equal(one(host.frame, "plan-peek"), undefined, "no peek over it");
    // Closed: the peek.
    host.closeBeside();
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    host.pulse();
    assert.equal(host.peekTitle(), "Done: Parser");
    assert.equal(marked(boxOf(one(one(host.frame, "plan-peek"), "pk-body"), "t2")), true, "marked in it");
    // On its tab: marked there, and the peek goes.
    host.views.show("plan");
    chat.turns = [graphTurn(graphOf(["t1", "t2", "t3"], ["t4"]))];
    host.pulse();
    assert.equal(one(host.frame, "plan-peek"), undefined);
    assert.equal(marked(boxOf(host.frame.kids[0], "t3")), true, "marked on the Plan tab");
  });

  // (fails before: yes — the owner's of 11-08: the task last pressed on the Plan's tab stood pressed in the peek that
  // slid in as it was done, its card under it with Hunt bugs, as though pressed there)
  test("the peek opens with no task chosen, whatever was pressed on the Plan's tab; a press in it chooses there alone", async () => {
    const host = hostOf();
    const chat = /** @type {any} */ (chatOf("host-pick", [graphTurn(graphOf(["t1"], ["t2"]))]));
    await host.open(chat);
    host.pulse();
    // The person presses the running task on the Plan's tab, then goes back to the chat.
    host.views.show("plan");
    boxOf(host.frame.kids[0], "t2").dispatch("click");
    assert.equal(boxOf(host.frame.kids[0], "t2").attrs["aria-pressed"], "true", "pressed on the tab");
    host.views.show("chat");
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    host.pulse();
    assert.equal(host.peekTitle(), "Done: Parser");
    const body = one(one(host.frame, "plan-peek"), "pk-body");
    assert.deepEqual([boxOf(body, "t2").attrs["aria-pressed"], byClass(body, "tg-icard").length], ["false", 0], "in the peek: not pressed, no card under it");
    assert.equal(all(body, (x) => /Hunt bugs/.test(textOf(x)) && x.tag === "button").length, 0, "no Hunt bugs");
    // A press in the peek chooses there. The tab shown again opens with none chosen (the owner's of 11-11): the task
    // pressed in its showing before is pressed no more.
    boxOf(body, "t3").dispatch("click");
    assert.equal(boxOf(one(one(host.frame, "plan-peek"), "pk-body"), "t3").attrs["aria-pressed"], "true");
    host.views.show("plan");
    assert.equal(boxOf(host.frame.kids[0], "t2").attrs["aria-pressed"], "false", "the tab's pick ended with its showing");
  });

  // (fails before: yes — Keep open put the Plan beside the chat with the task last pressed on the tab pressed again,
  // its card and Hunt bugs under it, where the peek had shown none)
  test("Keep open puts the Plan beside the chat as the peek showed it: its pick, or none", async () => {
    const host = hostOf();
    const chat = /** @type {any} */ (chatOf("host-keep", [graphTurn(graphOf(["t1"], ["t2"]))]));
    await host.open(chat);
    host.pulse();
    host.views.show("plan");
    boxOf(host.frame.kids[0], "t2").dispatch("click");
    host.views.show("chat");
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    host.pulse();
    assert.equal(host.peekTitle(), "Done: Parser");
    one(one(host.frame, "plan-peek"), "pk-keep").dispatch("click");
    assert.equal(host.beside.inSight, true, "kept open beside the chat");
    assert.deepEqual(["t2", "t3"].map((id) => boxOf(host.beside.body, id).attrs["aria-pressed"]), ["false", "false"], "none pressed");
    assert.equal(byClass(host.beside.body, "tg-icard").length, 0, "no card under a task");
    // A press in the peek is the one kept.
    host.closeBeside();
    chat.turns = [graphTurn(graphOf(["t1", "t2", "t3"], ["t4"]))];
    host.pulse();
    const body = one(one(host.frame, "plan-peek"), "pk-body");
    boxOf(body, "t4").dispatch("click");
    one(one(host.frame, "plan-peek"), "pk-keep").dispatch("click");
    assert.equal(boxOf(host.beside.body, "t4").attrs["aria-pressed"], "true", "the peek's pick");
  });

  // (fails before: yes — the peek brought the task done into sight, then a moment on scrolled to the work it moved on
  // to, the peek still up and its title naming the task done; and in the rail its ring lay outside its line's box,
  // clipped — the owner's of 11-07)
  test("the peek stays on the task done while it is up, the work it moved on to only where both fit; in the rail its ring is drawn inside the line", async () => {
    // The rail's lines 36 px apart under a 120 px head (helpers/plan-layout.js): a 60 px peek holds one.
    const page = laidOut({ height: 60 });
    const host = hostOf({}, page.h);
    const chat = /** @type {any} */ (chatOf("host-stay", [graphTurn(graphOf(["t1"], ["t2"]))]));
    await host.open(chat);
    host.pulse();
    chat.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    host.pulse();
    assert.equal(host.peekTitle(), "Done: Parser");
    const body = one(one(host.frame, "plan-peek"), "pk-body");
    assert.deepEqual([page.inSight(boxOf(body, "t2")), marked(boxOf(body, "t2"))], [true, true], "the task done, in sight and marked");
    assert.equal(host.tick.run(1600), 0, "no move on to the work planned");
    host.pulse();
    assert.equal(page.inSight(boxOf(body, "t2")), true, "a pulse on, still in sight");
    // A peek tall enough for both: the work it moved on to is in sight beside it.
    const roomy = laidOut({ height: 140 });
    const both = hostOf({}, roomy.h);
    const next = /** @type {any} */ (chatOf("host-both", [graphTurn(graphOf(["t1"], ["t2"]))]));
    await both.open(next);
    both.pulse();
    next.turns = [graphTurn(graphOf(["t1", "t2"], ["t3"]))];
    both.pulse();
    const room = one(one(both.frame, "plan-peek"), "pk-body");
    assert.deepEqual([roomy.inSight(boxOf(room, "t2")), roomy.inSight(boxOf(room, "t3"))], [true, true]);
    // The ring in the rail: inside the line, which a step's box clips round (views.css).
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    assert.match(css, /\.tg-blk \{[^}]*overflow: hidden/, "the rail's box clips what lies outside a line");
    assert.match(css, /^:is\(\.tg-blk, \.tg-step-box, \.tg-hunt-box\) :is\(\.tg-node, \.tg-fold, \.tg-hunt-strip, \.tg-step-strip\)\.is-just-done \{ animation: tg-just-done-in /m);
    assert.match(css, /@keyframes tg-just-done-in \{\s*0% \{ box-shadow: inset [^}]*\}\s*14% \{ box-shadow: inset 0 0 0 3px /);
  });
});
