// HarnessV3-TaskGraph G1, the harness (TG-D5): the task graph drawn in the Plan view (HarnessV3-Views VW-D4) — the
// steps (the owner's redesign of 10-23, HarnessV4_PlanGraph), the view drawn from a recorded run stream, the view's
// three tabs, and the view with no plan yet — on the fake DOM; and G2's (G2-10, G2-11): the sub-agents' tasks
// drawn — who does each, a running one's newest step, a merge, a failure and its report, the holds — the newest graph
// by its rev, and the conversation's rows; and G3's (G3-7): a team's graph drawn — its roles, a review's rounds, a
// worker that asks you, the lead's words — and the Plan view drawing it.
// The graphs are the core's own (`applyTasks` and the runner's steps → `graphView`), as the `graph` run event, the
// page's feed and the session's answer carry them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyTasks, graphView, hold, launched, taskEnded, taskMerged } from "../src/core/task-graph.js";
import * as tg from "../src/core/task-graph.js";
import { ICONS } from "../src/ui/harness/lib/icons.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { graphSteps, drawGraph, stateChanges, chosenTask, minutesWords } from "../src/ui/harness/views/task-graph.js";
import { renderPlan, planOf } from "../src/ui/harness/views/plan.js";
import * as tgv from "../src/ui/harness/views/task-graph.js";
import * as planView from "../src/ui/harness/views/plan.js";
import * as teamLib from "../src/ui/harness/lib/team.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { laidOut } from "./helpers/plan-layout.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { MEMBERS as LED } from "./helpers/roster.js";
import { SHIPPED_CREW } from "../src/core/roster.js";
import { atWork, state } from "../src/ui/harness/state.js";

const T0 = 1_000_000;
/** The page's clock in these tests: 5 min 20.7 s after the graph started. */
const NOW = T0 + 320_700;
const ADD = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Lexer", needs: [], writes: ["src/lex.js"], acceptance: "the lexer's tests pass" },
    { id: "t2", name: "Parser", needs: ["t1"], writes: ["src/parse.js", "src/ast.js"] },
    { id: "t3", name: "Docs", needs: ["t1"] },
    { id: "t4", name: "Release", needs: ["t2", "t3"] },
  ],
};

/** The graph after these calls, each at its own time, as the view draws it. @param {[any, number][]} calls */
function viewAfter(calls) {
  /** @type {any} */
  let g = null;
  for (const [input, at] of calls) {
    const r = /** @type {any} */ (applyTasks(g, input, { at }));
    assert.ok(r.ok, r.error);
    g = r.graph;
  }
  return graphView(g);
}

/** t1 done, t2 running, t3 ready, t4 waiting on both. */
const RUN = [
  /** @type {[any, number]} */ ([ADD, T0]),
  /** @type {[any, number]} */ ([{ action: "start", id: "t1" }, T0 + 60_000]),
  /** @type {[any, number]} */ ([{ action: "done", id: "t1", summary: "Lexer with 40 tests", evidence: "npm test: 40 passed" }, T0 + 180_000]),
  /** @type {[any, number]} */ ([{ action: "start", id: "t2" }, T0 + 200_700]),
];

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
/** @param {any} n @param {string} cls */
const one = (n, cls) => byClass(n, cls)[0];
/** The card of one task. @param {any} el @param {string} id */
const nodeOf = (el, id) => byClass(el, "tg-node").find((x) => String(x.attrs["aria-label"]).startsWith(`${id} `));
/** A task's tooltip, line by line. @param {any} el @param {string} id @returns {string[]} */
const tipOf = (el, id) => String(nodeOf(el, id).attrs.title).split("\n");
/** A task's newest line, as its tooltip says it after its state: what it did, does or waits for. @param {any} el @param {string} id */
const lineOf = (el, id) => tipOf(el, id)[1].split(" · ").slice(1).join(" · ");

describe("TaskGraph G1: the view", () => {
  // (fails before: yes — the graph was drawn left to right on a canvas of fixed cards, its names cut off and its edges
  // crossing its cards: the owner's "currently this looks ugly", 10-23)
  test("the steps: by needs from top to bottom, the tasks of a step side by side, a later step's ordered by where its needs sit; each step done, at work or to come", () => {
    const steps = graphSteps(viewAfter(RUN));
    assert.deepEqual(steps.map((x) => [x.tasks.map((t) => t.id), x.state]), [[["t1"], "done"], [["t2", "t3"], "now"], [["t4"], "later"]]);
    // A task added later whose needs sit first goes first, whatever the order it came in.
    const crossed = graphSteps(graphView(/** @type {any} */ (applyTasks(null, {
      action: "add",
      goal: "Order",
      tasks: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "y", name: "Y", needs: ["b"] }, { id: "x", name: "X", needs: ["a"] }],
    }, { at: T0 })).graph));
    assert.deepEqual(crossed.map((x) => x.tasks.map((t) => t.id)), [["a", "b"], ["x", "y"]]);
    // A step of dropped tasks alone is not done; one whose tasks are done or dropped is.
    const dropped = graphSteps(viewAfter([...RUN, [{ action: "drop", ids: ["t3", "t4"], reason: "no docs" }, T0 + 300_000]]));
    assert.equal(dropped[1].state, "now");
    const two = { action: "add", goal: "Two", tasks: [{ id: "a", name: "A" }, { id: "b", name: "B", needs: ["a"] }] };
    const gone = graphSteps(viewAfter([[two, T0], [{ action: "drop", ids: ["b"], reason: "later" }, T0 + 1000]]));
    assert.deepEqual(gone.map((x) => x.state), ["later", "later"]);
  });

  // (fails before: yes — alignEvents dropped `graph` events, so the pane had nothing to draw; the redesign of 10-23:
  // a box's whole name, one mark, one line; no ledger, bar or foot; E41 P4 of 10-25: the lines between the boxes, one
  // card; the owner's of 11-02: the boxes placed by the layout, the lines drawn with them; the owner's yes of 11-05: one
  // canvas, a task one line — its mark, id, name and one fact — no key)
  test("drawn from a recorded run stream: the head, the boxes in their rows with their mark, id, name and fact, the lines, and the chosen task's card", () => {
    const events = [
      { n: 1, type: "round-start", round: 1 },
      { n: 2, type: "plan", round: 1, items: [{ text: "Plan the parser", status: "doing" }] },
      { n: 3, type: "graph", round: 1, graph: viewAfter(RUN.slice(0, 1)) },
      { n: 4, type: "round-start", round: 2 },
      { n: 5, type: "graph", round: 2, graph: viewAfter(RUN) },
    ];
    const aligned = alignEvents(events);
    assert.equal(aligned.planned, "graph", "the agent planned on the graph last");
    assert.deepEqual([aligned.byRound.get(1).graph.counts.done, aligned.byRound.get(2).graph.counts.done], [0, 1]);
    const { graph } = planOf({ turns: [{ aligned }], live: null }, null);
    /** @type {string[]} */
    const chose = [];
    /** @type {number} */
    let logs = 0;
    const { el, flow, shown, mode } = drawGraph(graph, { h: fakeH, now: NOW, onChoose: (id) => chose.push(id), onRunLog: () => logs++ });
    assert.equal(textOf(one(el, "tg-head")), "Task graph|1 of 4 done · 1 running · 5 min|Ship the parser|Run log");
    // (E41 P4, HarnessV4_TaskGraphPlus_Design) No ledger, bar, dashed outlines, islands or key: the boxes on the
    // canvas, and the lines between them, say it. The rail is the chat's side's.
    for (const gone of ["tg-ledger", "tg-bar", "tg-keys", "tg-key", "tg-isle", "tg-lane", "tg-foot", "inst-head", "tg-step", "tg-rail", "tg-node-rel", "tg-key-pick", "tg-detail"]) assert.equal(byClass(el, gone).length, 0, gone);
    // One canvas: a box a task where the layout put it (graph-boxes.test.js) — t1's row, then t2 and t3 side by side,
    // then t4 — every box one size; the lines drawn with the boxes, in the same pass. No zoom asked for: no bar. Not
    // measured: the card under.
    assert.equal(mode, "under");
    assert.deepEqual([byClass(flow, "tg-canvas").length, byClass(flow, "tg-zoom").length], [1, 0]);
    const at = (/** @type {string} */ id) => (/^left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px$/.exec(nodeOf(el, id).attrs.style) || []).slice(1).map(Number);
    assert.ok(at("t1")[1] < at("t2")[1] && at("t2")[1] === at("t3")[1] && at("t3")[1] < at("t4")[1], JSON.stringify(["t1", "t2", "t3", "t4"].map(at)));
    assert.ok(at("t2")[0] < at("t3")[0], "t2 beside t3, on its left");
    assert.equal(new Set(["t1", "t2", "t3", "t4"].map((id) => at(id).slice(2).join("x"))).size, 1, "one size");
    assert.equal((String(one(flow, "tg-edges").attrs.html).match(/<path /g) || []).length, 4, "the lines' layer, under the boxes: a line a need");
    // Each box one line: its mark (a shape, no words), its id, its name, one fact — what a done task took, a running
    // one's newest line, a ready one's word, nothing for one that waits: its lines say what for. Its tooltip says the
    // rest; a screen reader hears what it needs in its name (the lines are pictures).
    assert.equal(textOf(nodeOf(el, "t1")), "t1|Lexer|2 min");
    assert.equal(textOf(nodeOf(el, "t2")), "t2|Parser|started 2 min ago");
    assert.equal(textOf(nodeOf(el, "t3")), "t3|Docs|ready");
    assert.equal(textOf(nodeOf(el, "t4")), "t4|Release");
    assert.deepEqual(["t1", "t2", "t3", "t4"].map((id) => lineOf(el, id)), ["Lexer with 40 tests", "started 2 min ago", "ready to start", "waits for t2, t3"]);
    assert.deepEqual(tipOf(el, "t4"), ["t4 Release", "waiting · waits for t2, t3", "Needs t2 and t3"]);
    assert.equal(nodeOf(el, "t4").attrs["aria-label"], "t4 Release: waiting; needs t2 and t3");
    assert.deepEqual(byClass(el, "tg-node").map((n) => n.attrs.class), ["tg-node is-done", "tg-node is-running is-on", "tg-node is-ready", "tg-node is-waiting"]);
    assert.deepEqual(byClass(el, "tg-mark").slice(0, 4).map((m) => [m.attrs.class, m.attrs.title]), [["tg-mark is-done", "done"], ["tg-mark is-running", "running"], ["tg-mark is-ready", "ready"], ["tg-mark is-waiting", "waiting"]]);
    assert.equal(byClass(el, "tg-pill").length, 0, "nothing here calls for you: no box carries a word");
    assert.deepEqual(shown && [shown.id, shown.el], ["t2", nodeOf(el, "t2")]);
    // The running box's bar slides on as if never redrawn: its phase is the clock's.
    assert.equal(one(nodeOf(el, "t2"), "tg-node-bar-fill").attrs.style, "animation-delay:-700ms");
    // The card (D9): the first running task, until one is chosen — who and when under its name, each part only where it
    // says something, what it needs and what needs it on one line.
    assert.equal(textOf(one(el, "tg-card")), "t2|Parser|running|the agent · started 2 min ago|Needs|t1|Needed by|t4|Writes|src/parse.js, src/ast.js");
    assert.deepEqual(byClass(one(el, "tg-card"), "tg-chip").map((x) => [x.attrs.class, x.attrs.title]), [["tg-chip is-done", "t1: done"], ["tg-chip is-waiting", "t4: waiting"]]);
    nodeOf(el, "t1").dispatch("click");
    assert.deepEqual(chose, ["t1"]);
    buttonsOf(one(el, "tg-head")).forEach((b) => b.dispatch("click"));
    assert.equal(logs, 1, "Run log, in the head");
    // A done task's card: what was done first, then what it was to be done when — the evidence given at its done.
    const t1 = drawGraph(graph, { h: fakeH, now: NOW, chosen: "t1" }).el;
    assert.equal(textOf(one(t1, "tg-card")), "t1|Lexer|done|the agent · done 2 min ago · took 2 min|Needed by|t2|t3|What was done|Lexer with 40 tests|Done when|the lexer's tests pass|Evidence, given at its done|npm test: 40 passed|Writes|src/lex.js");
    // (fails before: yes — the redesign of 11-10: what it needs and what needs it was a part of its own, low in the card)
    // Where it stands in the graph is its head's to say, under who does it and when.
    assert.equal(textOf(one(one(t1, "tg-card-head"), "tg-card-rel")), "Needed by|t2|t3");
    assert.equal(byClass(one(t1, "tg-card"), "tg-sec").filter((s) => /Needed by|Needs/.test(textOf(s))).length, 0, "no part of its own");
    assert.deepEqual(byClass(t1, "tg-node").map((n) => n.attrs.class), ["tg-node is-done is-on", "tg-node is-running", "tg-node is-ready", "tg-node is-waiting"], "only the chosen box is marked: the lines say the rest");
    // Tasks with no needs between them draw no lines; nor does one task alone.
    const apart = drawGraph(viewAfter([[{ action: "add", goal: "Apart", tasks: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }, T0]]), { h: fakeH, now: NOW, chosen: "a" }).el;
    assert.deepEqual([byClass(apart, "tg-edges").length, textOf(one(apart, "tg-card"))], [0, "a|A|ready|the agent · added 5 min ago"]);
    const lone = drawGraph(viewAfter([[{ action: "add", goal: "One", tasks: [{ id: "a", name: "A" }] }, T0]]), { h: fakeH, now: NOW }).el;
    assert.equal(byClass(lone, "tg-edges").length, 0);
  });

  // (fails before: yes — nothing drew the graph: the module did not exist)
  test("a state that changed since the last draw pops once; a dropped task is struck and out of the count; a closed graph says its outcome in a sentence", () => {
    const before = stateChanges(null, viewAfter(RUN.slice(0, 2)));
    assert.deepEqual([...before.changed], [], "the first draw pops nothing");
    const after = stateChanges(before.states, viewAfter(RUN));
    assert.deepEqual([...after.changed].sort(), ["t1", "t2", "t3"]);
    const popped = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, popped: after.changed }).el;
    assert.deepEqual(byClass(popped, "is-new").map((n) => n.attrs["aria-label"]), ["t1 Lexer: done", "t2 Parser: running; needs t1", "t3 Docs: ready; needs t1"]);

    const dropped = viewAfter([...RUN, [{ action: "drop", id: "t4", reason: "the release waits for v2" }, T0 + 300_000]]);
    const d = drawGraph(dropped, { h: fakeH, now: NOW }).el;
    assert.deepEqual([textOf(nodeOf(d, "t4")), lineOf(d, "t4")], ["t4|Release|dropped", "the release waits for v2"]);
    assert.equal(nodeOf(d, "t4").attrs.class, "tg-node is-dropped");
    assert.equal(one(nodeOf(d, "t4"), "tg-mark").attrs.class, "tg-mark is-dropped");
    assert.equal(textOf(one(d, "tg-figs")), "1 of 3 done · 1 running · 5 min", "a dropped task is out of the count");

    const closed = viewAfter([...RUN, [{ action: "close", reason: "The parser shipped without docs" }, T0 + 600_000]]);
    const c = drawGraph(closed, { h: fakeH, now: T0 + 900_000 }).el;
    // A closed graph's outcome is a sentence under the head, with a tick: no box.
    assert.equal(textOf(one(c, "tg-closed")), "Closed| — The parser shipped without docs");
    assert.equal(byClass(c, "tg-callout").length, 0);
    assert.equal(textOf(one(c, "tg-figs")), "1 of 1 done · 10 min", "its open tasks went with its close; its time ends there");
    assert.equal(chosenTask(closed, null)?.id, "t4", "nothing open: the detail shows the newest task");
    assert.deepEqual([minutesWords(30_000), minutesWords(8 * 60_000), minutesWords(65 * 60_000)], ["under a minute", "8 min", "1 h 05 min"]);
  });
});

/** A chat in the page: its id, its session, its turns and its live turn. @param {string} id @param {{ turns?: any[], live?: any }} [o] */
const chatOf = (id, { turns = [], live = null } = {}) => ({
  id,
  chainId: `chain-${id}`,
  title: `Chat ${id}`,
  turns,
  live,
  view: { settings: {} },
});
/** A turn whose run carried these events. @param {any[]} events */
const turnWith = (events) => ({ n: 1, status: "done", aligned: alignEvents(events) });
const segLabels = (/** @type {any} */ body) => byClass(body, "inst-seg-btn").map((b) => [textOf(b), b.attrs["aria-checked"]]);
const settle = () => new Promise((r) => setImmediate(r));
/** The switches under a node. @param {any} n */
const switches = (n) => all(n, (x) => x.tag === "input" && x.attrs.class === "ios-switch");
/** What the view says with no plan yet. */
const NO_PLAN = "No plan yet|When the work has steps, the agent writes its plan here as it goes: a checklist for a short straight list, a graph of tasks when its pieces depend on each other or could run in parallel.";

describe("TaskGraph G1: the Plan view", () => {
  // (fails before: yes — the pane had Plan and Raw only, and no switch; since E41 P4 one page, no tabs: the owner's
  // words of 10-25, "the Plan Page could itself don't need three tabs. Raw does not need to be shown")
  test("one page: the graph where the agent planned on it last or there is no checklist; else the checklist it keeps now, an older graph a press away", () => {
    const g = { tasks: [] };
    const items = [{ text: "Read", status: "doing" }];
    const page = planView.pageOf;
    assert.deepEqual(page({ plan: [], graph: null, planned: null }, false), { shows: "", other: false }, "no plan yet");
    assert.deepEqual(page({ plan: items, graph: null, planned: "plan" }, false), { shows: "checklist", other: false });
    assert.deepEqual(page({ plan: [], graph: g, planned: null }, false), { shows: "graph", other: false }, "a graph and no checklist: a reload's graph, its run not read");
    assert.deepEqual(page({ plan: items, graph: g, planned: "graph" }, false), { shows: "graph", other: false }, "the graph was its newest plan");
    // (fails before: yes — the Hunter of p4c: the page drew a closed graph from before over the checklist the agent keeps
    // now, while the tab's badge counted that checklist)
    assert.deepEqual(page({ plan: items, graph: g, planned: "plan" }, false), { shows: "checklist", other: true }, "the checklist is its newest plan: the graph from before a press away");
    assert.deepEqual(page({ plan: items, graph: g, planned: "plan" }, true), { shows: "graph", other: true }, "pressed: the older graph");
    // The page and the tab's badge read the same plan.
    assert.deepEqual(planView.planCount({ plan: [...items, { text: "Fix", status: "done" }], graph: { counts: { done: 7, total: 7, dropped: 0 } }, planned: "plan" }), { done: 1, all: 2 });
  });

  // (fails before: yes — the pane had no switch; the owner's words of 10-18 moved it under the box: "maybe move that
  // task switch under composer somwehere?"; since 10-29 the task graph is always on, with no switch anywhere)
  test("the checklist's page: its head and Copy plan, no tabs, no bar and no switch, and the page stays on the agent's newest plan", async () => {
    const chat = chatOf("sw", { turns: [turnWith([{ n: 1, type: "plan", round: 1, items: [{ text: "Plan the parser", status: "doing" }] }])] });
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: fakeH, api: async () => null, now: () => NOW });
    await settle();
    assert.deepEqual([segLabels(body), byClass(body, "pv-bar").length, byClass(body, "plan-raw").length], [[], 0, 0], "one page (E41 P4): no tabs, no bar, no Raw");
    assert.equal(textOf(one(body, "pv-column")), "Checklist|0 of 1 done|Plan the parser|between turns|The agent keeps a checklist for work this short. When work has pieces that wait on each other, or could run in parallel, it keeps a task graph — and the graph shows here instead.");
    // (fails before: yes — the drive's 1180 px pane wrapped "Copy plan" onto two lines beside the switch)
    const copy = buttonsOf(body).find((b) => b.attrs["aria-label"] === "Copy plan");
    assert.deepEqual([copy?.attrs.class, textOf(copy)], ["tg-ib", ""], "an icon, named for the screen reader");
    assert.deepEqual([switches(body), one(body, "plan-switch")], [[], undefined], "no switch");
    // The session's answer drawn again: still the agent's checklist until its next turn plans on the graph.
    const again = fakeH("div");
    renderPlan(again, { chat }, { h: fakeH, api: async () => null, now: () => NOW });
    assert.match(textOf(one(again, "pv-column")), /^Checklist\|0 of 1 done\|Plan the parser\|between turns\|/);
  });

  // (fails before: yes — the host built the view again whole on every pulse, so a hover or a selection in it reset; U0's
  // item 10, proposal_ux Phase 5)
  test("painted again in place: a pulse that changes nothing it shows leaves its nodes; a step, a pick or its clock draws", async () => {
    const chat = chatOf("pulse", { turns: [turnWith([{ n: 1, type: "plan", round: 1, items: [{ text: "Plan the parser", status: "doing" }] }])] });
    const body = fakeH("div");
    // The clock at the start of a half minute, so the steps below fall each side of the next.
    const base = Math.ceil(NOW / 30_000) * 30_000;
    let t = base;
    const view = renderPlan(body, { chat }, { h: fakeH, api: async () => null, now: () => t });
    await settle();
    const first = one(body, "pv-list");
    assert.ok(first);
    view.paint();
    view.paint();
    assert.equal(one(body, "pv-list"), first, "nothing changed: the same nodes");
    chat.taskProgress = new Map([["t1", { round: 2 }]]);
    view.paint();
    assert.notEqual(one(body, "pv-list"), first, "a task's step: drawn again");
    const second = one(body, "pv-list");
    t = base + 29_000;
    view.paint();
    assert.equal(one(body, "pv-list"), second, "its time words hold under half a minute");
    t = base + 31_000;
    view.paint();
    assert.notEqual(one(body, "pv-list"), second, "and move after");
  });

  // (fails before: yes — with no plan the pane drew its tabs over "No run in this chat yet.", the switch in a bar of
  // tabs with nothing on them; until 10-29 it said where the task graph's switch was)
  test("no plan yet: nothing said until the session's answer lands, then what a plan is, in the words of whoever plans", async () => {
    const chat = chatOf("empty");
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: fakeH, api: async () => null, now: () => NOW });
    assert.equal(textOf(one(body, "pv-inner")), "", "the session's first answer is on its way");
    await settle();
    // (fails before: no — a guard the mutation pass asked for: the bar, empty, drew its rule over "No plan yet"; since
    // E41 P4 there is no bar)
    assert.deepEqual([segLabels(body), byClass(body, "pv-bar").length], [[], 0], "no tabs, no bar");
    assert.equal(textOf(one(body, "pv-empty")), NO_PLAN);
    assert.deepEqual(switches(body), [], "no switch: the task graph is always on");
    // A lead's session: the lead's words.
    const led = /** @type {any} */ (chatOf("empty-lead"));
    led.view.settings.engine = { mode: "team", team: "architect", teams: [] };
    const lead = fakeH("div");
    renderPlan(lead, { chat: led }, { h: fakeH, api: async () => null, now: () => NOW });
    await settle();
    assert.equal(textOf(one(lead, "pv-empty")), NO_PLAN.replace("the agent writes", "the lead writes"));
    // A chat with no session yet says the same.
    const draft = fakeH("div");
    renderPlan(draft, { chat: { ...chatOf("draft"), chainId: null } }, { h: fakeH, api: async () => null, now: () => NOW });
    assert.equal(textOf(one(draft, "pv-empty")), NO_PLAN);
  });

  // (fails before: yes — opened on its Plan view, a session whose answer landed before its transcript said "No plan
  // yet", then took it back for its checklist once the turns came)
  test("a session whose turns the page has not loaded yet: nothing said until they land", async () => {
    const chat = chatOf("loading");
    const answer = async () => ({ identity: { turns: 2 }, inForce: { graph: null, goal: null } });
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: fakeH, api: answer, now: () => NOW });
    await settle();
    assert.equal(textOf(one(body, "pv-inner")), "", "its answer says it has turns: they are on their way");
    chat.turns.push({ n: 1, history: true, status: "done" }, { n: 2, history: true, status: "done" });
    const again = fakeH("div");
    renderPlan(again, { chat }, { h: fakeH, api: answer, now: () => NOW });
    await settle();
    assert.equal(textOf(one(again, "pv-empty")).split("|")[0], "No plan yet", "they came, with no plan");
  });

  // (fails before: yes — the pane drew the newest plan event alone)
  test("a run's stream drawn live: the page shows the graph the agent used last, Copy plan in its head copying the graph in words", async () => {
    const events = [
      { n: 1, type: "plan", round: 1, items: [{ text: "Plan the parser", status: "doing" }] },
      { n: 2, type: "graph", round: 2, graph: viewAfter(RUN) },
    ];
    const turn = { n: 1, status: "streaming", aligned: alignEvents(events) };
    const chat = chatOf("live", { turns: [turn], live: { turn } });
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: fakeH, api: async () => ({ inForce: { graph: null, goal: null } }), now: () => NOW });
    await settle();
    assert.equal(byClass(body, "pv-column").length, 0, "the graph, not the checklist before it");
    assert.equal(textOf(one(body, "tg-figs")), "1 of 4 done · 1 running · 5 min", "the running turn's own event, over the session's answer from before it");
    // (fails before: yes — the pane offered to maximise the graph)
    assert.equal(buttonsOf(body).some((b) => b.attrs.title === "Maximise the graph"), false, "the view is the graph's full size");
    // (E41 P4, D1-6: Copy plan copies what the page shows — here the graph, in words)
    const copied = /** @type {string[]} */ ([]);
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    // The copy never settles here: its toast is the page's, not this test's.
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: (/** @type {string} */ s) => { copied.push(s); return new Promise(() => {}); } } } });
    try {
      buttonsOf(one(body, "tg-head")).find((b) => b.attrs["aria-label"] === "Copy plan")?.dispatch("click");
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was);
    }
    assert.deepEqual(copied, [tgv.planText(viewAfter(RUN))]);
    assert.match(copied[0], /^Task graph — Ship the parser\n1 of 4 done\n\nStep 1\n- \[x\] t1 Lexer — done\n\nStep 2\n- \[ \] t2 Parser — running · needs t1\n/);
  });

  // (fails before: yes — a reload drew no graph)
  test("after a reload the session's answer draws the graph, with the session's goal under it", async () => {
    const chat = chatOf("reload");
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: fakeH, api: async () => ({ inForce: { graph: viewAfter(RUN), goal: { status: "active", slice: "Ship it" } } }), now: () => NOW });
    // (fails before: yes — the pane said "No run in this chat yet." over its tabs until the answer landed)
    assert.deepEqual([segLabels(body), textOf(one(body, "pv-inner"))], [[], ""], "before the answer lands: nothing is said about a plan");
    await settle();
    assert.equal(textOf(one(body, "tg-figs")), "1 of 4 done · 5 min", "it landed: the view drew again — no turn is at work, so the agent's own t2 runs not now");
    assert.equal(one(body, "tg-callout"), undefined, "nothing holds it");
    // (fails before: yes — the drive's Checklist tab said "No structured steps yet." after five turns planned on the
    // graph; since E41 P4 the session's goal is under the graph, its Checklist tab gone)
    assert.equal(textOf(one(body, "plan-goal")), "Goal|active|Ship it", "the session's goal, from the same answer");
    assert.equal(one(body, "pv-inner").kids.at(-1), one(body, "plan-goal"), "under the graph");
  });

  // (fails before: yes — HarnessV4_Tasks U4, found in HarnessV3-Views' drives: each time a turn started or ended the
  // session's answer was asked for again, and until it landed the view drew as if there were none — the goal went
  // and came back)
  test("the goal stays while the session's answer is asked for again; the new answer's goal takes its place", async () => {
    const chat = chatOf("goal-stays");
    let asked = 0;
    /** @type {(v?: any) => void} */
    let land = () => {};
    const api = async () => {
      if (++asked === 1) return { inForce: { graph: null, goal: { status: "active", slice: "Ship it" } } };
      await new Promise((r) => (land = r));
      return { inForce: { graph: null, goal: { status: "active", slice: "Ship it, then rest" } } };
    };
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: fakeH, api, now: () => NOW });
    await settle();
    assert.equal(textOf(one(body, "plan-goal")), "Goal|active|Ship it");
    // A turn starts: the answer is asked for again, and the view draws meanwhile.
    chat.turns = [{ n: 1, status: "streaming" }];
    const next = fakeH("div");
    renderPlan(next, { chat }, { h: fakeH, api, now: () => NOW });
    assert.equal(asked, 2, "asked again");
    assert.equal(textOf(one(next, "plan-goal")), "Goal|active|Ship it", "the goal as last heard, until the new answer lands");
    land();
    await settle();
    await settle();
    assert.equal(textOf(one(next, "plan-goal")), "Goal|active|Ship it, then rest");
    // Another session's goal is never shown for this one.
    const other = fakeH("div");
    renderPlan(other, { chat: chatOf("goal-other") }, { h: fakeH, api: () => new Promise(() => {}), now: () => NOW });
    assert.equal(byClass(other, "plan-goal").length, 0);
  });

  // (fails before: yes — the drive's pane, at 1180 and 960 px: the running task sat past the canvas's right edge, cut
  // off, and the view stayed put as the work moved right; since the redesign of 10-23 the work moves down)
  test("the view follows the work: a task the view chose anew is scrolled into sight, once; the developer's scroll and pick hold", () => {
    /** The view as tall as it is laid out: 0 while it is hidden. */
    const size = { height: 0 };
    const page = laidOut(size);
    let now = NOW;
    const chat = /** @type {any} */ (chatOf("follow", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] }));
    /** @type {any} */
    let view;
    const draw = () => {
      const body = fakeH("div");
      view = renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => now });
      return body;
    };
    // Hidden, the view has no height to show anything in: it waits.
    let body = draw();
    assert.equal(page.scroller().scrollTop, 0);
    // Shown: t2 runs, and is brought into sight by the least move: its foot at the view's — its box at 236–288 px.
    size.height = 100;
    body = draw();
    assert.deepEqual([page.inSight(nodeOf(body, "t2")), page.scroller().scrollTop], [true, 188]);
    // The developer scrolls back to the top, by hand: the draws that follow keep it while the view's choice stays t2 —
    // the same view drawn again, a view made anew being a showing of its own (the owner's of 11-11).
    const scroller = page.scroller();
    scroller.dispatch("wheel");
    scroller.scrollTop = 0;
    scroller.dispatch("scroll");
    now += 2_001;
    chat.taskProgress = new Map([["t2", { agent: "", round: 2, tool: null }]]);
    view.paint();
    assert.equal(page.scroller().scrollTop, 0);
    // The work moves on to t4, past tasks done: the hold goes, and t4 is brought into sight.
    const later = [
      ...RUN,
      /** @type {[any, number]} */ ([{ action: "start", id: "t3" }, T0 + 210_000]),
      /** @type {[any, number]} */ ([{ action: "done", id: "t2", summary: "Parser" }, T0 + 250_000]),
      /** @type {[any, number]} */ ([{ action: "done", id: "t3", summary: "Docs" }, T0 + 260_000]),
      /** @type {[any, number]} */ ([{ action: "start", id: "t4" }, T0 + 270_000]),
    ];
    chat.turns = [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(later) }])];
    view.paint();
    assert.deepEqual([page.inSight(nodeOf(body, "t4")), page.scroller().scrollTop], [true, 280], "its box at 328–380 px");
    // A task the developer picks is shown where they are: the view does not move.
    nodeOf(one(body, "pv-scroll"), "t1").dispatch("click");
    assert.match(textOf(one(body, "tg-card")), /^t1\|Lexer\|done\|/);
    assert.deepEqual([page.inSight(nodeOf(body, "t1")), page.scroller().scrollTop], [false, 280]);
  });

  // (fails before: yes — the review of d5aa58d31: only the page's scroller was watched, so a canvas whose height moved
  // with no draw of the page's — Still open's own list opened — kept a drawing fitted to the height it had)
  test("the canvas's height moved with no draw of the page's own: the graph fitted to it again", async () => {
    const size = { height: 600, canvas: 400 };
    const page = laidOut(size);
    /** @type {any[]} */
    const watchers = [];
    const was = globalThis.ResizeObserver;
    globalThis.ResizeObserver = /** @type {any} */ (class {
      /** @param {any} cb */
      constructor(cb) {
        this.cb = cb;
        this.on = new Set();
        watchers.push(this);
      }
      /** @param {any} el */
      observe(el) { this.on.add(el); }
      /** @param {any} el */
      unobserve(el) { this.on.delete(el); }
      disconnect() { this.on.clear(); }
    });
    try {
      const chat = chatOf("refit-watch", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
      const body = fakeH("div");
      renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => NOW });
      assert.doesNotMatch(String(one(body, "tg-canvas").attrs.style), /scale/, "whole at 100%");
      // Watched from the next frame, out of any pass of the observer's own.
      assert.ok(!watchers.some((w) => w.on.has(page.canvas())), "not in the pass that drew it");
      await new Promise((r) => setTimeout(r, 40));
      assert.ok(watchers.some((w) => w.on.has(page.canvas())), "the canvas watched");
      size.canvas = 100;
      for (const w of watchers) w.cb([]);
      assert.match(String(one(body, "tg-canvas").attrs.style), /transform:scale\(0\.8\)/, "fitted to the canvas as it is now");
      await new Promise((r) => setTimeout(r, 40));
      assert.ok(watchers.some((w) => w.on.has(page.canvas())) && watchers.every((w) => w.on.size <= 2), "the newest canvas watched, the one it replaced no more");
    } finally {
      globalThis.ResizeObserver = was;
    }
  });

  // (fails before: yes — the owner's of 11-17: a page's watch was let go of only when its word that the page went came,
  // in a frame, and a window that got none kept each page made meanwhile whole, a chat shown again making one each time)
  test("a page gone is let go of as the next is made: its watch ends, and its nodes are taken apart, each on its own", async () => {
    /** @type {any[]} */
    const watchers = [];
    const was = globalThis.ResizeObserver;
    globalThis.ResizeObserver = /** @type {any} */ (class {
      /** @param {any} cb */
      constructor(cb) {
        this.cb = cb;
        this.on = new Set();
        watchers.push(this);
      }
      /** @param {any} el */
      observe(el) { this.on.add(el); }
      /** @param {any} el */
      unobserve(el) { this.on.delete(el); }
      disconnect() { this.on.clear(); }
    });
    const doc = stubDocument();
    try {
      const host = /** @type {any} */ (doc.document.createElement("div"));
      doc.document.body.append(host);
      const chat = chatOf("gone-page", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
      const first = renderPlan(host, { chat }, { api: async () => null, now: () => NOW });
      first.paint();
      const scroll = host.querySelector(".pv-scroll");
      const drawn = scroll.querySelector(".tg-node");
      assert.ok(drawn && watchers[0].on.has(scroll), "drawn, its room watched");
      assert.ok((drawn.listeners.click || []).length, "its boxes heard");
      // The work moves: the page draws itself anew, and the drawing it threw away is taken apart, its handlers taken back.
      chat.turns = [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter([...RUN, [{ action: "start", id: "t3" }, T0 + 210_000]]) }])];
      first.paint();
      const box = scroll.querySelector(".tg-node");
      assert.ok(box && box !== drawn, "drawn anew");
      assert.deepEqual([drawn.parentNode, drawn.children.length, (drawn.listeners.click || []).length], [null, 0, 0], "the drawing thrown away, each node on its own, hearing nothing");
      // Its host draws a page anew (its chat shown again): the one that went is let go of, though no frame told it.
      host.replaceChildren();
      renderPlan(host, { chat }, { api: async () => null, now: () => NOW });
      assert.equal(watchers[0].on.size, 0, "its watch ended");
      assert.deepEqual([scroll.children.length, box.parentNode], [0, null], "its nodes each on its own");
      assert.ok(watchers.at(-1).on.has(host.querySelector(".pv-scroll")), "the new page watched");
      // The new page's canvas is watched from its next frame (`watchCanvas`): heard before the page's document goes.
      await new Promise((r) => setTimeout(r, 60));
    } finally {
      doc.restore();
      globalThis.ResizeObserver = was;
    }
  });

  // (fails before: yes — Fable 5.2's review of 11-17: the page took apart the drawing it threw away whole, and the hunt's
  // model chip, made once and moved into each drawing of a done task, was still in the one a task not done drew between)
  test("the model chip made once keeps its parts through a drawing that did not take it", async () => {
    const doc = stubDocument();
    try {
      const host = /** @type {any} */ (doc.document.createElement("div"));
      doc.document.body.append(host);
      const make = (/** @type {string} */ cls) => Object.assign(/** @type {any} */ (doc.document.createElement("span")), { className: cls });
      const chip = /** @type {any} */ (doc.document.createElement("button"));
      chip.append(make("tile"), make("name"), make("caret"));
      const modelSelect = /** @type {any} */ (() => ({ el: chip, setModels() {}, setFamilies() {}, setAccounts() {}, set() {}, name: () => "" }));
      const chat = chatOf("chip-kept", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
      const view = renderPlan(host, { chat, hunt: { start: () => new Promise(() => {}), models: () => [] } }, { api: async () => null, now: () => NOW, modelSelect });
      planView.chooseTask(chat, "t1");
      view.paint();
      assert.ok(host.querySelector(".tg-hunt")?.contains(chip), "on the done task's card");
      planView.chooseTask(chat, "t2");
      view.paint();
      assert.ok(!host.querySelector(".tg-hunt"), "a task not done has none");
      planView.chooseTask(chat, "t1");
      view.paint();
      assert.ok(host.querySelector(".tg-hunt")?.contains(chip), "back on the done task's card");
      assert.equal(chip.children.length, 3, "its tile, its name and its caret");
      // The page's canvas is watched from its next frame (`watchCanvas`): heard before the page's document goes.
      await new Promise((r) => setTimeout(r, 60));
    } finally {
      doc.restore();
    }
  });

  // (fails before: yes — the review of d5aa58d31: a wheel over the inspector bubbled to the page's scroller and held the
  // view, where it had moved neither the page nor the canvas)
  test("a wheel over the inspector beside the canvas scrolls the card alone: the view still follows the work", () => {
    const size = { height: 0 };
    const page = laidOut(size);
    let now = NOW;
    const chat = chatOf("follow-inspector", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
    const draw = () => {
      const body = fakeH("div");
      renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => now });
      return body;
    };
    draw();
    const inspector = { closest: (/** @type {string} */ s) => (s.endsWith(".tg-body.is-beside > .tg-card") ? {} : null) };
    page.scroller().dispatch("wheel", { target: inspector });
    now += 2_001;
    size.height = 100;
    const body = draw();
    assert.deepEqual([page.inSight(nodeOf(body, "t2")), page.scroller().scrollTop], [true, 188], "t2 brought into sight");
  });

  // (fails before: yes — the review of 67038d835, its 8: a scroll key in the inspector, its own scroller, held the view
  // as a scroll of the page's does, where the wheel over it no longer did)
  test("a scroll key or a wheel in the inspector moves the card alone: the view still follows the work as it moves on; the same key on the page holds it", () => {
    // Down the rail: t1 at 120–152 px, t2 at 156–188, t3 at 192–224, t4 at 228–260; the view 100 px tall.
    const page = laidOut({ height: 100 });
    let now = NOW;
    const inspector = { closest: (/** @type {string} */ s) => (s.endsWith(".tg-body.is-beside > .tg-card") ? {} : null) };
    const dropped = [...RUN, /** @type {[any, number]} */ ([{ action: "drop", id: "t2", reason: "Not now" }, T0 + 210_000])];
    for (const [type, e, held] of /** @type {[string, any, boolean][]} */ ([["keydown", { key: "PageDown", target: inspector }, false], ["wheel", { target: inspector }, false], ["keydown", { key: "PageDown", target: {} }, true]])) {
      const chat = chatOf(`follow-inspector-${type}-${held}`, { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
      const body = fakeH("div");
      const view = renderPlan(body, { chat, pane: true }, { h: page.h, api: async () => null, now: () => now });
      assert.equal(page.scroller().scrollTop, 88, "t2, started last, in sight");
      page.scroller().dispatch(type, e);
      now += 2_001;
      // t2 dropped: the view's own task is t3 now.
      chat.turns = [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(dropped) }])];
      view.paint();
      assert.deepEqual([type, page.inSight(nodeOf(body, "t3")), page.scroller().scrollTop], [type, !held, held ? 88 : 124]);
    }
  });

  // (fails before: yes — the review of 67038d835, its 14: on a short window the workspace's least height scrolls the
  // page, the wheel over the canvas zooms it, and the inspector held its wheel at its ends: the page scrolled by the
  // wheel over its head and the gaps alone)
  test("past the inspector's end the wheel goes on to the page — a scroll of the person's —, the canvas's wheel still its zoom", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const inspector = (/\n\.pv-inner\.is-workspace \.tg-body\.is-beside > \.tg-card \{([^}]*)\}/.exec(css) || [])[1] || "";
    assert.ok(inspector, "the inspector's rule");
    assert.doesNotMatch(inspector, /overscroll-behavior/, "its wheel chains to the page at its ends");
    assert.match((/\n\.tg-canvas-view \{([^}]*)\}/.exec(css) || [])[1] || "", /overscroll-behavior-x: contain;/);
    // The wheel down at the inspector's foot scrolls the page: the view holds where the person put it; one that scrolls
    // the inspector itself holds nothing.
    const page = laidOut({ height: 100 });
    let now = NOW;
    const card = (/** @type {number} */ top) => ({ closest: (/** @type {string} */ s) => (s.endsWith(".tg-body.is-beside > .tg-card") ? { scrollTop: top, clientHeight: 300, scrollHeight: 900 } : null) });
    const dropped = [...RUN, /** @type {[any, number]} */ ([{ action: "drop", id: "t2", reason: "Not now" }, T0 + 210_000])];
    for (const [top, held] of /** @type {[number, boolean][]} */ ([[600, true], [200, false]])) {
      const chat = chatOf(`inspector-end-${top}`, { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
      const body = fakeH("div");
      const view = renderPlan(body, { chat, pane: true }, { h: page.h, api: async () => null, now: () => now });
      page.scroller().dispatch("wheel", { deltaY: 100, target: card(top) });
      now += 2_001;
      chat.turns = [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(dropped) }])];
      view.paint();
      assert.deepEqual([top, page.scroller().scrollTop], [top, held ? 88 : 124]);
    }
  });

  // (fails before: yes — the owner's of 11-10: the canvas is a workspace that scrolls itself; the page scrolled to the
  // task, past the canvas's foot, and the canvas around it stayed as it was)
  test("a canvas shorter than its drawing: the work is brought into sight in the canvas, the page left where it is, and the canvas stays where it was brought as the view draws anew", () => {
    const page = laidOut({ height: 600, canvas: 100 });
    const chat = chatOf("follow-canvas", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
    const draw = () => {
      const body = fakeH("div");
      renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => NOW });
      return body;
    };
    // t2's box at 116–168 px of the drawing, fitted to the canvas's 100 px at 80%: 92.8–134.4 px, the canvas showing
    // 0–100 of it — the least move, 34.4 px down the canvas.
    const at = () => Math.round(page.canvas().scrollTop * 10) / 10;
    let body = draw();
    assert.deepEqual([page.inSight(nodeOf(body, "t2")), page.scroller().scrollTop, at()], [true, 0, 34.4]);
    // Drawn anew at the same zoom: the canvas where it was brought.
    body = draw();
    assert.deepEqual([page.inSight(nodeOf(body, "t2")), page.scroller().scrollTop, at()], [true, 0, 34.4]);
  });

  // (fails before: yes — the review of d5aa58d31 (sa_cc56efc5): the first drawing brought the chosen task into sight,
  // then the one made again for the canvas's height just measured reset the pan for its new zoom, the reveal spent)
  test("a task chosen elsewhere, the canvas's height re-fitting the graph: brought into sight in the drawing that stays", () => {
    const page = laidOut({ height: 600, canvas: 100 });
    const chat = chatOf("follow-refit", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
    planView.chooseTask(chat, "t4");
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => NOW });
    assert.match(String(one(body, "tg-canvas").attrs.style), /transform:scale\(0\.8\)/, "re-fitted to the canvas's height");
    assert.deepEqual([page.inSight(nodeOf(body, "t4")), page.scroller().scrollTop], [true, 0], "t4 in the canvas, the page left where it is");
  });

  // (fails before: yes — the review of d5aa58d31: the page going to the checklist read the canvas once out of the
  // workspace, as tall as its drawing, and kept that, so the graph shown again was drawn to it, then once more)
  test("the graph, the checklist, the graph again: the canvas's height kept from the workspace, the graph drawn once", () => {
    const page = laidOut({ height: 600, canvas: 100 });
    const chat = chatOf("refit-back", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }])] });
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => NOW });
    assert.match(String(one(body, "tg-canvas").attrs.style), /transform:scale\(0\.8\)/);
    // The agent keeps a checklist now; the person shows the graph from before.
    chat.turns.push({ ...turnWith([{ n: 2, type: "plan", round: 2, items: [{ text: "Tidy up", status: "doing" }] }]), n: 2 });
    view.paint();
    assert.equal(one(body, "tg-canvas"), undefined, "the checklist");
    const before = page.drawn();
    buttonsOf(body).find((b) => textOf(b) === "Show the graph").dispatch("click");
    assert.equal(page.drawn() - before, 1, "drawn once, to the height kept");
    assert.match(String(one(body, "tg-canvas").attrs.style), /transform:scale\(0\.8\)/);
  });
});

/** The work handed out (G2-1): t1 an explorer's, t2 and t3 sub-agents', t4 the agent's own. */
const HANDED = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Map the callers", by: "explorer", goal: "Every caller of parse() is known", steps: ["Search for parse("], acceptance: "each caller listed" },
    { id: "t2", name: "Fix the parser", needs: ["t1"], by: "sub-agent", writes: ["src/parse.js"], goal: "parse() takes a trailing comma", steps: ["Fix parse.js", "Run npm test"], acceptance: "npm test passes" },
    { id: "t3", name: "Test the comma", needs: ["t1"], by: "sub-agent", writes: ["test/parse.test.js"], goal: "A test pins the trailing comma", steps: ["Add the test"], acceptance: "the new test passes" },
    { id: "t4", name: "Release", needs: ["t2", "t3"] },
  ],
};
/** How a task's sub-agent ended, as the registry hands it over: done with its check passed, unless `o` says otherwise. @param {string} agent @param {Record<string, any>} [o] */
const END = (agent, o = {}) => ({
  agent,
  status: "done",
  stoppedBy: null,
  error: null,
  report: { status: "done", did: "Found the 3 callers", met: true, evidence: "rg listed them", left: "" },
  words: "",
  files: [],
  shared: false,
  wrote: false,
  workError: null,
  ran: [],
  calls: [],
  written: [],
  spentUsd: 0.25,
  ms: 90_000,
  cut: false,
  ...o,
});
/** The graph after each step, each a step the core took. @param {any} g @param {((g: any) => any)[]} steps @returns {any} */
const stepped = (g, ...steps) =>
  steps.reduce((x, step) => {
    const next = step(x);
    assert.ok(next, "a step the core took");
    return next;
  }, g);
/** @param {string} id @param {string} agent @param {number} at */
const took = (id, agent, at) => (/** @type {any} */ g) => launched(g, id, agent, at);
/** @param {string} id @param {any} end @param {number} at */
const ended = (id, end, at) => (/** @type {any} */ g) => taskEnded(g, id, end, at)?.graph;
/** t1 done by its explorer: t2 and t3 are ready. */
const MAPPED = stepped(/** @type {any} */ (applyTasks(null, HANDED, { at: T0 })).graph, took("t1", "sa-1", T0 + 10_000), ended("t1", END("sa-1", { ran: [{ command: "rg parse(", exit: 0 }] }), T0 + 100_000));
/** t2 and t3 at work. */
const AT_WORK = stepped(MAPPED, took("t2", "sa-2", T0 + 110_000), took("t3", "sa-3", T0 + 110_000));
/** t2's change merges; t3's check failed. */
const ENDED = stepped(
  AT_WORK,
  ended("t2", END("sa-2", { report: { status: "done", did: "Took the trailing comma in parse()", met: true, evidence: "npm test: 41 passed", left: "" }, files: [{ path: "src/parse.js", added: 30, removed: 0 }], wrote: true, ran: [{ command: "npm test", exit: 0 }] }), T0 + 250_000),
  ended("t3", END("sa-3", { report: { status: "done", did: "Added the test", met: false, evidence: "the new test fails: parse() throws", left: "" }, files: [{ path: "test/parse.test.js", added: 12, removed: 0 }], wrote: true, ran: [{ command: "npm test", exit: 1 }] }), T0 + 260_000),
  // t2's change was ready, and its planner applied it: its merge is under way (the owner's of 11-02).
  (/** @type {any} */ g) => /** @type {any} */ (tg.applyAsked(g, "sa-2"))?.graph ?? null,
);
/** t2's change is in the folder. */
const MERGED = stepped(ENDED, (g) => taskMerged(g, "t2", [{ path: "src/parse.js", added: 30, removed: 0 }], T0 + 270_000));

describe("TaskGraph G2: the sub-agents' tasks, drawn", () => {
  // (fails before: yes — a card said nothing of who did its task, a running sub-agent's task showed only when it
  // started, and the head did not say what the sub-agents spent)
  test("the cards: who does each task, a running sub-agent's round and newest tool from the feed, and what the sub-agents spent", () => {
    /** @type {Map<string, any>} */
    const progress = new Map([["t2", { agent: "sa-2", round: 3, tool: { name: "bash", args: "npm test" } }]]);
    const { el } = drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, progress });
    assert.equal(textOf(nodeOf(el, "t1")), "t1|Map the callers|1 min");
    assert.equal(lineOf(el, "t1"), "Found the 3 callers");
    assert.equal(textOf(nodeOf(el, "t2")), "t2|Fix the parser|sa-2 · round 3 · bash npm test");
    assert.equal(textOf(nodeOf(el, "t3")), "t3|Test the comma|sa-3 · started 4 min ago", "no step of its sub-agent's yet");
    assert.equal(textOf(nodeOf(el, "t4")), "t4|Release");
    assert.deepEqual(byClass(el, "tg-node").map((n) => n.attrs["aria-label"]), ["t1 Map the callers: done (an explorer)", "t2 Fix the parser: running (an agent); needs t1", "t3 Test the comma: running (an agent); needs t1", "t4 Release: waiting; needs t2 and t3"]);
    // Who does it, in its tooltip (the owner's yes of 11-05: the line has no room for its glyph, its card has).
    assert.deepEqual(["t1", "t2", "t3"].map((id) => tipOf(el, id)[2]), ["An explorer does it: it reads and reports", "An agent does it, in its own worktree", "An agent does it, in its own worktree"]);
    assert.equal(byClass(el, "tg-node-by").length, 0);
    assert.equal(textOf(one(el, "tg-figs")), "1 of 4 done · 2 running · 5 min · $0.25 by agents");
    // A step of the sub-agent that held the task before — a send-back's — is not this one's: the card waits for its own.
    progress.set("t3", { agent: "sa-0", round: 7, tool: { name: "read", args: "test/parse.test.js" } });
    assert.equal(textOf(nodeOf(drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, progress }).el, "t3")), "t3|Test the comma|sa-3 · started 4 min ago");
    // The explorer's task, chosen: who did it and when under its name, its glyph first, its brief — goal, steps, done
    // when — then its report (D9's order for a done task); what needs it, in its head.
    const t1 = drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, chosen: "t1" }).el;
    assert.equal(
      textOf(one(t1, "tg-card")),
      "t1|Map the callers|done|an explorer — sa-1 · done 4 min ago · took 1 min|Needed by|t2|t3|Goal|Every caller of parse() is known|Steps|1 step|Search for parse(|Done when|each caller listed|Its report|Status|done · acceptance met|What it did|Found the 3 callers|Evidence|rg listed them|Ran|rg parse( → exit 0|Spent|$0.25 · 1 min",
    );
    assert.deepEqual([one(t1, "tg-card-by").attrs.class, one(t1, "tg-card-by").attrs.html], ["tg-card-by", ICONS.search]);
    assert.equal(one(drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, chosen: "t2" }).el, "tg-card-by").attrs.html, ICONS.bot);
    assert.equal(one(drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, chosen: "t4" }).el, "tg-card-by"), undefined, "the agent's own: no glyph");
    // (fails before: yes — the review of 11-05: a command task read as a worker's, "command: it reads and reports",
    // under the agent's glyph) A command task: Filament runs it, its glyph a terminal's, no seat's tile.
    const v = graphView(AT_WORK);
    const command = drawGraph({ ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t4" ? { ...t, by: "command", run: ["npm test"], items: [] } : t)) }, { h: fakeH, now: NOW, chosen: "t4" }).el;
    assert.deepEqual([tipOf(command, "t4")[2], one(command, "tg-card-by").attrs.class, one(command, "tg-card-by").attrs.html], ["Filament runs its commands — no model", "tg-card-by", ICONS.terminal]);
    // A running one's report is still to come.
    assert.match(textOf(one(drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, chosen: "t2" }).el, "tg-card")), /^t2\|Fix the parser\|running\|an agent — sa-2 · started 4 min ago\|Needs\|.*\|Its report\|Its report shows here once its agent ends\.(\||$)/);
  });

  // (fails before: yes — the bug hunt of 10-30, SUB-3: a task whose launch found no free slot failed; one whose sub-agent
  // waits for its slot was drawn as any at work)
  test("a task whose sub-agent waits for a slot says so on its card, and what holds it back, until it has its slot; the planner reads it in its line", () => {
    const waits = /** @type {any} */ (tg.slotWaited(AT_WORK, "t3", "sa-3", "m, 4 of 4 busy", T0 + 110_000));
    const { el } = drawGraph(graphView(waits), { h: fakeH, now: NOW });
    assert.equal(textOf(nodeOf(el, "t3")), "t3|Test the comma|sa-3 · waits for a slot · m, 4 of 4 busy");
    assert.equal(textOf(nodeOf(el, "t2")), "t2|Fix the parser|sa-2 · started 4 min ago", "the one at work is drawn as before");
    assert.match(tg.showText(waits, "agent"), /\n- t3 "Test the comma" — running on sa-3, which waits for a slot \(m, 4 of 4 busy\) and starts by itself once one is free · /);
    const had = /** @type {any} */ (tg.slotEnded(waits, "t3", "sa-3"));
    assert.equal(textOf(nodeOf(drawGraph(graphView(had), { h: fakeH, now: NOW }).el, "t3")), "t3|Test the comma|sa-3 · started 4 min ago");
    assert.equal(tg.slotEnded(had, "t3", "sa-3"), null, "nothing waits on it any more");
    assert.equal(tg.slotWaited(AT_WORK, "t3", "sa-9", "m, 4 of 4 busy", T0), null, "only the one at work on it waits on it");
  });

  // (fails before: yes — a merging or failed task was drawn as neither, and its sub-agent's report was nowhere)
  test("a task's end: a merge under way, a failure first in the detail with its why and its sub-agent's report, Open for its conversation", () => {
    /** @type {string[]} */
    const opened = [];
    const { el } = drawGraph(graphView(ENDED), { h: fakeH, now: NOW, onOpenAgent: (id) => opened.push(id) });
    assert.equal(textOf(nodeOf(el, "t2")), "t2|Fix the parser|3-way apply");
    assert.equal(textOf(nodeOf(el, "t3")), "t3|Test the comma|Failed", "it calls for you: its word, in red");
    assert.equal(lineOf(el, "t3"), "its acceptance check did not pass: the new test fails: parse() throws");
    assert.deepEqual(byClass(el, "tg-pill").map((p) => p.attrs.class), ["tg-pill is-failed"]);
    assert.deepEqual([nodeOf(el, "t2").attrs.class, nodeOf(el, "t3").attrs.class], ["tg-node is-merging", "tg-node is-failed is-on"]);
    assert.ok(one(nodeOf(el, "t2"), "tg-node-bar"), "a merge under way slides its bar");
    assert.equal(one(nodeOf(el, "t3"), "tg-node-bar"), undefined);
    // A merge is work going on; the failure is said apart, in orange.
    assert.equal(textOf(one(el, "tg-figs")), "1 of 4 done · 1 running · |1 failed| · 5 min · $0.75 by agents");
    assert.equal(one(one(el, "tg-figs"), "tg-fig-call").kids[0], "1 failed");
    // The failed task waits on the agent: the card opens on it, why it failed first (D9).
    assert.equal(
      textOf(one(el, "tg-card")),
      "t3|Test the comma|failed|an agent — sa-3 · failed 1 min ago · took 2 min|Needs|t1|Needed by|t4|Why it failed|Open sa-3|its acceptance check did not pass: the new test fails: parse() throws|Status|done · acceptance not met|What it did|Added the test|Evidence|the new test fails: parse() throws|Changed|test/parse.test.js (+12 −0)|Ran|npm test → exit 1|Spent|$0.25 · 1 min|Goal|A test pins the trailing comma|Steps|1 step|Add the test|Done when|the new test passes|Writes|test/parse.test.js",
    );
    buttonsOf(one(el, "tg-card")).find((b) => textOf(b) === "Open sa-3").dispatch("click");
    assert.deepEqual(opened, ["sa-3"]);
    // (fails before: yes — HarnessV4_Tasks U1: a failed task's detail said why and offered nothing; only the planner
    // sent it back)
    // The developer's own send-back, the failure card's ways on: to its last sub-agent, or fresh to a new one — never
    // on a graph that takes nothing more, nor where no hand was given.
    /** @type {any[][]} */
    const sent = [];
    const withHand = (/** @type {any} */ g, /** @type {Record<string, any>} */ more = {}) => drawGraph(graphView(g), { h: fakeH, now: NOW, onSendBack: (id, fresh) => sent.push([id, fresh]), ...more }).el;
    const acts = one(withHand(ENDED), "ix-error-acts");
    assert.deepEqual(buttonsOf(acts).map((b) => [textOf(b), b.attrs.class]), [["Start fresh", "tg-act"], ["Send back", "tg-act is-primary"]]);
    assert.match(buttonsOf(acts)[1].attrs.title, /^Its agent goes on with t3 where it stopped/);
    buttonsOf(acts)[1].dispatch("click");
    buttonsOf(acts)[0].dispatch("click");
    assert.deepEqual(sent, [["t3", false], ["t3", true]]);
    assert.equal(textOf(one(withHand(ENDED), "tg-card")).split("|Why it failed|")[1].split("|Status|")[0], "its acceptance check did not pass: the new test fails: parse() throws|Start fresh|Send back");
    // (fails before: yes — HarnessV4_Tasks U1, one failure card everywhere: the detail drew why in a paragraph of its
    // own kind)
    assert.deepEqual([one(withHand(ENDED), "ix-error").attrs.class, textOf(one(withHand(ENDED), "ix-error-msg"))], ["ix-error is-inset", "its acceptance check did not pass: the new test fails: parse() throws"]);
    assert.deepEqual([one(el, "ix-error-acts"), one(withHand(ENDED, { chosen: "t2" }), "ix-error")], [undefined, undefined], "no hand: no ways on; a task that did not fail: no card");
    const twice = structuredClone(ENDED);
    twice.tasks.find((/** @type {any} */ t) => t.id === "t3").failures = { cause: "acceptance", times: 3 };
    assert.equal(textOf(one(withHand(twice), "ix-error-repeat")), "t3 failed the same way 3 times in a row");
    assert.equal(one(withHand(ENDED), "ix-error-repeat"), undefined, "a first failure is not called out");
    // Merged: the card says what came into the folder, and the report what merged.
    const m = drawGraph(graphView(MERGED), { h: fakeH, now: NOW, chosen: "t2" }).el;
    assert.deepEqual([textOf(nodeOf(m, "t2")), lineOf(m, "t2")], ["t2|Fix the parser|2 min", "applied · 1 file (+30 −0)"]);
    assert.equal(
      textOf(one(m, "tg-card")).split("|Its report|")[1].split("|Writes|")[0],
      "Status|done · acceptance met|What it did|Took the trailing comma in parse()|Evidence|npm test: 41 passed|Applied|1 file (+30 −0)|Ran|npm test → exit 0|Spent|$0.25 · 1 min",
    );
    assert.match(textOf(one(m, "tg-card")), /^t2\|Fix the parser\|done\|an agent — sa-2 · done 1 min ago · took 2 min\|/);
    assert.equal(textOf(one(m, "tg-figs")), "2 of 4 done · |1 failed| · 5 min · $0.75 by agents", "a failed task is still open: its time runs on");
    // (fails before: yes — the G2 drive's t2 changed a scratch test its task did not name, and its card said nothing of it)
    // A file its task did not name: merged with the rest, and named apart on its card.
    const wide = [{ path: "src/parse.js", added: 30, removed: 0 }, { path: "test/tmp.test.js", added: 3, removed: 0 }];
    const apart = stepped(AT_WORK, ended("t2", END("sa-2", { report: { status: "done", did: "Took the trailing comma in parse()", met: true, evidence: "npm test: 41 passed", left: "" }, files: wide, wrote: true, ran: [{ command: "npm test", exit: 0 }] }), T0 + 250_000), (g) => taskMerged(g, "t2", wide, T0 + 270_000));
    assert.equal(
      textOf(one(drawGraph(graphView(apart), { h: fakeH, now: NOW, chosen: "t2" }).el, "tg-card")).split("|Evidence|")[1].split("|Writes|")[0],
      "npm test: 41 passed|Applied|2 files (+33 −0)|Outside its writes|test/tmp.test.js|Ran|npm test → exit 0|Spent|$0.25 · 1 min",
    );
    // A run that ended without its report: its last words stand in for it.
    const cut = stepped(AT_WORK, ended("t3", END("sa-3", { status: "failed", error: "upstream 500", report: null, words: "I was adding the test." }), T0 + 260_000));
    assert.equal(
      textOf(one(drawGraph(graphView(cut), { h: fakeH, now: NOW }).el, "tg-card")).split("|Goal|")[0],
      "t3|Test the comma|failed|an agent — sa-3 · failed 1 min ago · took 2 min|Needs|t1|Needed by|t4|Why it failed|its run failed (upstream 500)|Status|no report — its last words below|Last words|I was adding the test.|Spent|$0.25 · 1 min",
    );
  });

  // (fails before: yes — B4, decision 4: a task the developer stopped said Filament would start it once its needs were
  // done, showed nothing of the stopped try, and had no way on of the developer's own)
  test("a task the developer stopped: its card says so, shows the stopped try, and offers Start again and Start fresh", () => {
    const stopped = stepped(AT_WORK, ended("t3", END("sa-3", { status: "stopped", stoppedBy: "harness", report: null, words: "I was adding the test.", files: [{ path: "test/parse.test.js", added: 4, removed: 0 }] }), T0 + 260_000));
    /** @type {any[][]} */
    const sent = [];
    const el = drawGraph(graphView(stopped), { h: fakeH, now: NOW, chosen: "t3", onSendBack: (id, fresh) => sent.push([id, fresh]) }).el;
    assert.equal(lineOf(el, "t3"), "stopped by the developer");
    assert.equal(
      textOf(one(el, "tg-card")).split("|Stopped by you|")[1].split("|Goal|")[0],
      "You stopped sa-3. It goes on with t3 where it stopped at the agent's next tasks call — or start it yourself.|Start fresh|Start again|Status|no report — its last words below|Last words|I was adding the test.|Changed|test/parse.test.js (+4 −0)|Spent|$0.25 · 1 min",
    );
    const acts = buttonsOf(one(el, "tg-card-stopped"));
    assert.deepEqual(acts.map((b) => [textOf(b), b.attrs.class]), [["Start fresh", "tg-act"], ["Start again", "tg-act is-primary"]]);
    assert.match(acts[1].attrs.title, /^Its agent goes on with t3 where it was stopped, in its own conversation — what it did is there\. The agent is told; /);
    assert.match(acts[0].attrs.title, /^A new agent takes t3 from the folder as it stands, with the stopped try in its brief\. /);
    acts[1].dispatch("click");
    acts[0].dispatch("click");
    assert.deepEqual(sent, [["t3", false], ["t3", true]]);
    // No hand given (a reader's page): it says what happened, and offers nothing.
    const read = drawGraph(graphView(stopped), { h: fakeH, now: NOW, chosen: "t3" }).el;
    assert.deepEqual([textOf(one(read, "tg-card-stopped")), buttonsOf(one(read, "tg-card-stopped")).length], ["You stopped sa-3.", 0]);
    // (fails before: yes — HarnessV4_Tasks B11: a lead's own stop failed the task; the page had no words for one its
    // lead set aside)
    const byLead = stepped(AT_WORK, ended("t3", END("sa-3", { status: "stopped", stoppedBy: "lead", report: null, words: "I was adding the test." }), T0 + 260_000));
    const leads = drawGraph(graphView(byLead), { h: fakeH, now: NOW, chosen: "t3", onSendBack: () => {} }).el;
    assert.equal(lineOf(leads, "t3"), "stopped by its lead");
    assert.match(textOf(one(leads, "tg-card")), /\|Stopped by its lead\|The lead stopped sa-3\. It goes on with t3 where it stopped at /);
    // Let go by the planner's next tasks call, its card's line names who goes on with it.
    const ranAs = stepped(MAPPED, (g) => launched(g, "t3", "sa-3", T0 + 110_000, "sub-agent"), ended("t3", END("sa-3", { status: "stopped", stoppedBy: "harness", report: null }), T0 + 260_000));
    const letGo = tg.release(ranAs, { crew: "agent", resumable: () => null });
    assert.equal(lineOf(drawGraph(graphView(letGo), { h: fakeH, now: NOW }).el, "t3"), "sa-3 goes on with it");
    assert.equal(lineOf(drawGraph(graphView(MAPPED), { h: fakeH, now: NOW }).el, "t3"), "Filament starts it", "a task no one has had is Filament's to start");
  });

  // (fails before: yes — ag-stop, the owner's of 11-11: the page had no words for a task its own agent set aside by
  // stopping its sub-agent: the task failed, and one kept as stopped by the agent read as stopped by you)
  test("a task the agent stopped itself: its line, its card's title and its sentence say your agent stopped it", () => {
    const byAgent = stepped(AT_WORK, ended("t3", END("sa-3", { status: "stopped", stoppedBy: "agent", report: null, words: "I was adding the test." }), T0 + 260_000));
    assert.equal(byAgent.tasks.find((/** @type {any} */ t) => t.id === "t3").stopped, "agent");
    const el = drawGraph(graphView(byAgent), { h: fakeH, now: NOW, chosen: "t3", onSendBack: () => {} }).el;
    assert.equal(lineOf(el, "t3"), "stopped by your agent");
    assert.equal(
      textOf(one(el, "tg-card")).split("|Stopped by your agent|")[1].split("|Goal|")[0],
      "Your agent stopped sa-3. It goes on with t3 where it stopped at the agent's next tasks call — or start it yourself.|Start fresh|Start again|Status|no report — its last words below|Last words|I was adding the test.|Spent|$0.25 · 1 min",
    );
    const read = drawGraph(graphView(byAgent), { h: fakeH, now: NOW, chosen: "t3" }).el;
    assert.deepEqual([textOf(one(read, "tg-card-stopped")), buttonsOf(one(read, "tg-card-stopped")).length], ["Your agent stopped sa-3.", 0]);
  });

  // (fails before: yes — a task sent back said nothing of its try or the agent's note, nor what its tries spent)
  test("a task sent back: its try, the agent's note for the new sub-agent, and what its tries spent", () => {
    const again = stepped(
      ENDED,
      (g) => /** @type {any} */ (applyTasks(g, { action: "start", id: "t3", note: "parse() throws on a lone comma: test that it does not" }, { at: T0 + 280_000 })).graph,
      took("t3", "sa-4", T0 + 290_000),
    );
    const rows = textOf(one(drawGraph(graphView(again), { h: fakeH, now: NOW, chosen: "t3" }).el, "tg-card"));
    assert.match(rows, /^t3\|Test the comma\|running\|an agent — sa-4 · try 2 · started just now\|/);
    assert.match(rows, /\|Note\|parse\(\) throws on a lone comma: test that it does not$/);
    const done = stepped(again, ended("t3", END("sa-4", { report: { status: "done", did: "Tested the lone comma", met: true, evidence: "npm test: 42 passed", left: "" }, files: [{ path: "test/parse.test.js", added: 14, removed: 0 }], wrote: true }), T0 + 300_000));
    assert.match(textOf(one(drawGraph(graphView(done), { h: fakeH, now: NOW, chosen: "t3" }).el, "tg-card")), /\|Spent\|\$0\.25 · 1 min · \$0\.50 over 2 tries\|/);
  });

  // (fails before: yes — nothing said why a ready sub-agent's task did not start)
  test("held or free: what the callout and a ready sub-agent's task say", () => {
    const free = drawGraph(graphView(MAPPED), { h: fakeH, now: NOW }).el;
    assert.equal(one(free, "tg-callout"), undefined);
    assert.deepEqual([textOf(nodeOf(free, "t2")), lineOf(free, "t2")], ["t2|Fix the parser|ready", "Filament starts it"]);
    assert.equal(textOf(one(free, "tg-card")).split("|Goal|")[0], "t2|Fix the parser|ready|an agent · added 5 min ago|Needs|t1|Needed by|t4|Its report|Filament starts it once its needs are done and a slot is free; its agent's report shows here.");
    // Held: a ready task waits for the agent's next tasks call.
    const held = drawGraph(graphView(hold(MAPPED, T0 + 105_000)), { h: fakeH, now: NOW }).el;
    assert.deepEqual([textOf(nodeOf(held, "t2")), lineOf(held, "t2")], ["t2|Fix the parser|ready", "held until the agent's next tasks call"]);
    assert.equal(textOf(one(held, "tg-card")).split("|Goal|")[0], "t2|Fix the parser|ready|an agent · added 5 min ago|Needs|t1|Needed by|t4|Its report|Filament starts it after the agent's next tasks call; its agent's report shows here.");
    // The developer's stop: the stopped task waits again, and says so.
    const stopped = stepped(AT_WORK, ended("t3", END("sa-3", { status: "stopped", stoppedBy: "harness", report: null, words: "I was adding the test." }), T0 + 200_000), (g) => hold(g, T0 + 200_000));
    const s = drawGraph(graphView(stopped), { h: fakeH, now: NOW }).el;
    assert.equal(textOf(one(s, "tg-callout")), "Held| — since your stop: Filament starts no agent's task until the agent's next tasks call.");
    // (fails before: yes — the stopped task, never ready to the core until the agent's next tasks call, said "needs "
    // with nothing after it)
    assert.deepEqual([textOf(nodeOf(s, "t3")), lineOf(s, "t3")], ["t3|Test the comma|stopped", "stopped by the developer"]);
  });

  // (fails before: yes — the review of 11-05: the page's draw key read the running tasks' newest steps as "{}", so a new
  // round or tool redrew nothing until something else moved)
  test("the Plan view draws a running task's newest step as each lands", () => {
    const chat = /** @type {any} */ (chatOf("progress", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: graphView(AT_WORK) }])] }));
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: fakeH, api: async () => null, now: () => NOW });
    assert.equal(textOf(nodeOf(body, "t2")), "t2|Fix the parser|sa-2 · started 4 min ago");
    chat.taskProgress = new Map([["t2", { agent: "sa-2", round: 3, tool: { name: "bash", args: "npm test" }, asking: null }]]);
    view.paint();
    assert.equal(textOf(nodeOf(body, "t2")), "t2|Fix the parser|sa-2 · round 3 · bash npm test");
    chat.taskProgress.set("t2", { agent: "sa-2", round: 4, tool: { name: "edit", args: "src/parse.js" }, asking: null });
    view.paint();
    assert.equal(textOf(nodeOf(body, "t2")), "t2|Fix the parser|sa-2 · round 4 · edit src/parse.js");
  });

  // (fails before: yes — the pane drew the running turn's graph or the session's answer, never the feed's, so a change
  // between turns never drew)
  test("the view draws the newest graph by its rev: the running turn's, the session's answer, or the feed's", () => {
    const at = (/** @type {number} */ rev, /** @type {any} */ g) => ({ ...graphView(g), rev });
    const done = turnWith([{ n: 1, type: "graph", round: 1, graph: at(4, MAPPED) }]);
    assert.equal(planOf({ turns: [done], live: null, graphLive: at(6, AT_WORK) }, null).graph.rev, 6, "the feed's newer one");
    assert.equal(planOf({ turns: [done], live: null, graphLive: at(3, MAPPED) }, null).graph.rev, 4, "never an older one");
    assert.equal(planOf({ turns: [done], live: null, graphLive: at(6, AT_WORK) }, { inForce: { graph: at(7, ENDED) } }).graph.rev, 7, "the session's newer answer");
    assert.equal(planOf({ turns: [done], live: null, graphLive: at(8, MERGED) }, { inForce: { graph: at(7, ENDED) } }).graph.rev, 8, "the feed's change after the answer");
    const live = { n: 2, status: "streaming", aligned: alignEvents([{ n: 1, type: "graph", round: 1, graph: at(9, MERGED) }]) };
    assert.equal(planOf({ turns: [done, live], live: { turn: live }, graphLive: at(8, ENDED) }, null).graph.rev, 9, "the running turn's newer one");
    // The page keeps the feed's newest per chat, and each running task's newest step — (HarnessV3-Views V3, fails
    // before: yes, against HEAD) read from the sub-agent's whole progress, which the feed carries since V3.
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /for \(const chat of state\.chats\.values\(\)\) if \(chat\.chainId === msg\.chainId\) takeGraph\(chat, msg\.graph\);/);
    assert.match(app, /if \(chat\.graphLive && \(Number\(chat\.graphLive\.rev\) \|\| 0\) >= \(Number\(graph\.rev\) \|\| 0\)\) return;\n\s*chat\.graphLive = graph;/);
    assert.match(app, /\(chat\.taskProgress \|\|= new Map\(\)\)\.set\(String\(msg\.task\), \{ agent: String\(msg\.id \|\| ""\), round: Number\(msg\.progress\?\.round\) \|\| 0, tool: msg\.progress\?\.tool \|\| null[ ,]/);
    assert.match(app, /openAgent: \(id\) => openSubagent\(id\)/);
    assert.match(readFileSync("src/http/events.js", "utf8"), /hear\("graph", send\)/, "the feed carries the graph's changes");
  });

  // (fails before: yes — a task's end reached the conversation as a sub-agent's report: "reported — its report joined")
  test("the conversation's rows: each task's end as it stands, and the tasks Filament started", () => {
    const a = alignEvents([
      { type: "subagent-report", round: 1, agentId: "", description: "the task graph", kind: "task" },
      { type: "subagent-report", round: 2, agentId: "sa-2", description: "t2: Fix the parser", kind: "task", task: "t2", state: "done" },
      { type: "subagent-report", round: 2, agentId: "sa-3", description: "t3: Test the comma", kind: "task", task: "t3", state: "failed" },
      { type: "subagent-report", round: 3, agentId: "sa-4", description: "t3: Test the comma", kind: "task", task: "t3", state: "waiting" },
    ]);
    assert.deepEqual(a.byRound.get(1)?.reports, [{ agentId: "", kind: "task", description: "the task graph" }]);
    assert.deepEqual(a.byRound.get(2)?.reports, [
      { agentId: "sa-2", kind: "task", description: "t2: Fix the parser", task: "t2", state: "done" },
      { agentId: "sa-3", kind: "task", description: "t3: Test the comma", task: "t3", state: "failed" },
    ]);
    assert.deepEqual(a.byRound.get(3)?.reports, [{ agentId: "sa-4", kind: "task", description: "t3: Test the comma", task: "t3", state: "waiting" }]);
    // Their words, the agent's (lib/team.js's taskNote, since G3): the tasks Filament started, a task done, failed, or
    // stopped and waiting again; Open for the sub-agent that ran it.
    const who = "“t3: Test the comma”";
    assert.deepEqual([{ task: "" }, { task: "t3", state: "done" }, { task: "t3", state: "failed" }, { task: "t3", state: "waiting" }].map((r) => teamLib.taskNote(r, who, false)), [
      { tone: "", ic: "→", text: "Filament started the graph's ready tasks — the agent heard which here" },
      { tone: "ok", ic: "✓", text: "Task “t3: Test the comma” is done" },
      { tone: "error", ic: "✕", text: "Task “t3: Test the comma” failed — the agent heard it here, with its choices" },
      { tone: "", ic: "↺", text: "Task “t3: Test the comma” was stopped — it waits for the agent's next tasks call" },
    ]);
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const w = taskNote\(r, who, lead\);\n\s*return h\("div", \{ class: `tool-note sub-report sub-mark\$\{w\.tone \? ` tone-\$\{w\.tone\}` : ""\}` \},\n\s*h\("span", \{ class: "sub-mark-ic" \}, w\.ic\),\n\s*h\("span", \{ class: "sub-mark-text" \}, w\.text\),\n\s*r\.agentId \? open : null\);/);
  });
});

/** A team's work (G3-1): t1 a scout's, t2 a builder's that a reviewer reads, t3 a tester's. */
const TEAM_WORK = {
  action: "add",
  goal: "Ship the parser",
  tasks: [
    { id: "t1", name: "Map the callers", by: "scout", goal: "Every caller of parse() is known", steps: ["Search for parse("], acceptance: "each caller listed" },
    { id: "t2", name: "Fix the parser", needs: ["t1"], by: "builder", review: true, writes: ["src/parse.js"], goal: "parse() takes a trailing comma", steps: ["Fix parse.js", "Run npm test"], acceptance: "npm test passes" },
    { id: "t3", name: "Test the comma", needs: ["t1"], by: "tester", writes: ["test/parse.test.js"], goal: "A test pins the trailing comma", steps: ["Add the test"], acceptance: "the new test passes" },
  ],
};
/** @param {string} id @param {string} agent @param {number} at @param {string} as */
const tookAs = (id, agent, at, as) => (/** @type {any} */ g) => launched(g, id, agent, at, /** @type {any} */ (as));
/**
 * The team's graph step by step, as the core takes them (G3-2, G3-3) — built in each test, so a run against the code
 * before G3 fails test by test: t1 scouted; t2 built and its review to start, t3 at work; t2's reviewer reading; the
 * changes it asked; its builder fixing them.
 */
const teamSteps = () => {
  const start = /** @type {any} */ (applyTasks(null, TEAM_WORK, { at: T0, crew: LED })).graph;
  const scouted = stepped(start, tookAs("t1", "sa-1", T0 + 10_000, "scout"), ended("t1", END("sa-1"), T0 + 100_000));
  const queued = stepped(
    scouted,
    tookAs("t2", "sa-2", T0 + 110_000, "builder"),
    tookAs("t3", "sa-3", T0 + 110_000, "tester"),
    ended("t2", END("sa-2", { report: { status: "done", did: "Took the trailing comma in parse()", met: true, evidence: "npm test: 41 passed", left: "" }, files: [{ path: "src/parse.js", added: 30, removed: 0 }], wrote: true, ran: [{ command: "npm test", exit: 0 }] }), T0 + 200_000),
  );
  const reading = stepped(queued, (g) => tg.reviewLaunched(g, "t2", "sa-4"));
  const asked = stepped(reading, (g) => tg.reviewEnded(g, "t2", END("sa-4", { report: { status: "done", did: "Read the change", met: false, evidence: "a lone comma still throws", left: "parse() must take a lone comma" }, spentUsd: 0.1, ms: 30_000 }), T0 + 230_000)?.graph);
  const fixing = stepped(asked, (g) => tg.fixLaunched(g, "t2"));
  return { scouted, queued, reading, asked, fixing };
};
describe("TaskGraph G3: a team's graph, drawn", () => {
  // (fails before: yes — HarnessV3-TaskGraph G3-1, G3-7: no graph took a team's roles — the core refused them — and the
  // view drew no role, knew no review and spoke of the agent alone)
  test("the cards: a team's roles on its tiles, a review's round — its reviewer's newest tool, the changes asked, the fix — and the lead's words", () => {
    const s = teamSteps();
    /** @type {Map<string, any>} */
    const progress = new Map([["t2", { agent: "sa-4", round: 2, tool: { name: "read", args: "src/parse.js" }, asking: null }]]);
    const { el } = drawGraph(graphView(s.reading), { h: fakeH, now: NOW, progress, crew: "team", members: LED });
    assert.deepEqual([textOf(nodeOf(el, "t1")), lineOf(el, "t1")], ["t1|Map the callers|1 min", "Found the 3 callers"]);
    assert.equal(textOf(nodeOf(el, "t2")), "t2|Fix the parser|Reviewer · round 1 of 2 · read src/parse.js");
    assert.equal(textOf(nodeOf(el, "t3")), "t3|Test the comma|Tester · started 4 min ago");
    assert.deepEqual(byClass(el, "tg-node").map((n) => [n.attrs["aria-label"], n.attrs.class]), [
      ["t1 Map the callers: done (Scout)", "tg-node is-done"],
      ["t2 Fix the parser: in review (Builder); needs t1", "tg-node is-review"],
      ["t3 Test the comma: running (Tester); needs t1", "tg-node is-running is-on"],
    ]);
    // Each seat says what it does in its tooltip, and wears its card's glyph in the task's card: the Scout Reviewer's
    // eye, the Tester Builder's hammer ("Teams, improved and kept" of 11-03; the owner's yes of 11-05: not on the line).
    assert.deepEqual(["t1", "t2", "t3"].map((id) => tipOf(el, id)[2]), ["Scout: it reads and reports", "Builder: it changes files in its own worktree", "Tester: it changes files in its own worktree"]);
    assert.deepEqual([byClass(el, "tg-node").flatMap((n) => byClass(n, "role-tile")), byClass(el, "tg-node-by")], [[], []]);
    const tile = (/** @type {string} */ id) => one(one(drawGraph(graphView(s.reading), { h: fakeH, now: NOW, chosen: id, crew: "team", members: LED }).el, "tg-card"), "tg-card-by");
    assert.deepEqual(["t1", "t2", "t3"].map((id) => [tile(id).attrs.class, tile(id).attrs.html]), [
      ["tg-card-by role-tile is-xs", ICONS.eye],
      ["tg-card-by role-tile is-xs", ICONS.hammer],
      ["tg-card-by role-tile is-xs", ICONS.hammer],
    ]);
    assert.ok(one(nodeOf(el, "t2"), "tg-node-bar"), "its reviewer reads: the bar slides");
    assert.equal(one(nodeOf(el, "t2"), "tg-mark").attrs.class, "tg-mark is-review", "a review is work going on: its arc turns");
    assert.equal(textOf(one(el, "tg-figs")), "1 of 3 done · 2 running · 5 min · $0.50 by workers");
    // Its reviewer asked for changes; its builder fixes them, its newest tool from the feed.
    const asked = drawGraph(graphView(s.asked), { h: fakeH, now: NOW, crew: "team", members: LED }).el;
    assert.deepEqual([lineOf(asked, "t2"), one(nodeOf(asked, "t2"), "tg-node-bar")], ["changes asked · round 1 of 2", undefined], "nobody reads it now");
    progress.set("t2", { agent: "sa-2", round: 5, tool: { name: "edit", args: "src/parse.js" }, asking: null });
    assert.equal(textOf(nodeOf(drawGraph(graphView(s.fixing), { h: fakeH, now: NOW, progress, crew: "team", members: LED }).el, "t2")), "t2|Fix the parser|fixing its review · round 1 of 2 · edit src/parse.js");
    // The review to start: next, held with the graph, or stopped by the developer.
    assert.equal(lineOf(drawGraph(graphView(s.queued), { h: fakeH, now: NOW, crew: "team", members: LED }).el, "t2"), "Reviewer · round 1 of 2 · starts next");
    assert.equal(lineOf(drawGraph(graphView(hold(s.queued, T0 + 205_000)), { h: fakeH, now: NOW, crew: "team", members: LED }).el, "t2"), "Reviewer · round 1 of 2 · held until the lead's next tasks call");
    const stopped = stepped(s.reading, (g) => tg.reviewEnded(g, "t2", END("sa-4", { status: "stopped", stoppedBy: "harness", report: null }), T0 + 210_000)?.graph);
    assert.equal(lineOf(drawGraph(graphView(stopped), { h: fakeH, now: NOW, crew: "team", members: LED }).el, "t2"), "Reviewer · round 1 of 2 · stopped by the developer");
  });

  // (fails before: yes — the same refusal; and a task's detail said nothing of a review)
  test("a task's card: its review, each round with its reviewer and Open for its conversation, the one reading now, and what its review spent", () => {
    const s = teamSteps();
    /** @type {string[]} */
    const opened = [];
    const fix = drawGraph(graphView(s.fixing), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED, onOpenAgent: (id) => opened.push(id) }).el;
    // One card (D9), a part a section: what it needs in its head, then its brief, its report, its details.
    const secs = byClass(one(fix, "tg-card"), "tg-sec").map((x) => textOf(x));
    assert.equal(textOf(one(one(fix, "tg-card"), "tg-card-head")), "t2|Fix the parser|running|Builder — sa-2 · started 4 min ago|Needs|t1");
    assert.deepEqual(secs, [
      "Goal|parse() takes a trailing comma",
      "Steps|2 steps|Fix parse.js|Run npm test",
      "Done when|npm test passes",
      "Its report|Open sa-2|Status|done · acceptance met|What it did|Took the trailing comma in parse()|Evidence|npm test: 41 passed|Changed|src/parse.js (+30 −0)|Ran|npm test → exit 0|Spent|$0.25 · 1 min · $0.35 with its review|Review 1|changes asked — parse() must take a lone comma · |sa-4",
      "Writes|src/parse.js|Review|a reviewer reads its change before it merges",
    ]);
    buttonsOf(one(fix, "tg-card")).find((b) => textOf(b) === "sa-4").dispatch("click");
    assert.deepEqual(opened, ["sa-4"]);
    // Its reviewer reads now: the round it reads.
    assert.match(textOf(one(drawGraph(graphView(s.reading), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED }).el, "tg-card")), /\|Spent\|\$0\.25 · 1 min\|Review 1\|reading the change now · \|sa-4\|Goal\|/);
  });

  // (fails before: yes — the same refusal; and a worker's call waiting for your answer showed in the Team view alone,
  // and the graph spoke of the agent and its sub-agents whoever planned)
  test("a worker that asks you, in orange with its call; under a lead the agent's own task waits for a member, and the holds speak of the lead and its workers", () => {
    const s = teamSteps();
    /** @type {Map<string, any>} */
    const progress = new Map([["t3", { agent: "sa-3", round: 2, tool: null, asking: { tool: "bash", args: "npm install" } }]]);
    const { el } = drawGraph(graphView(s.queued), { h: fakeH, now: NOW, progress, crew: "team", members: LED });
    assert.deepEqual([textOf(nodeOf(el, "t3")), lineOf(el, "t3")], ["t3|Test the comma|Asks you", "Tester · wants to run npm install"]);
    assert.deepEqual([one(nodeOf(el, "t3"), "tg-pill").attrs.class, one(nodeOf(el, "t3"), "tg-mark").attrs.class], ["tg-pill is-asking", "tg-mark is-asking"]);
    assert.deepEqual([nodeOf(el, "t3").attrs.class, nodeOf(el, "t3").attrs["aria-label"], one(nodeOf(el, "t3"), "tg-node-bar")], ["tg-node is-asking is-on", "t3 Test the comma: asks you (Tester); needs t1", undefined]);
    // Its card (D9): what it asks you first, its report still to come — its worker runs.
    // (fails before: yes — the card said Filament would start it once a slot was free: a worker that asks you is at work)
    assert.match(textOf(one(el, "tg-card")), /^t3\|Test the comma\|asks you\|Tester — sa-3 · started 4 min ago\|Needs\|t1\|It asks you\|wants to run npm install\|Goal\|.*\|Its report\|Its report shows here once its worker ends\.\|/);
    // (fails before: yes — the Hunter of p4b: a review still to start was counted running, where its box's bar stood
    // still)
    assert.equal(textOf(one(el, "tg-figs")), "1 of 3 done · |1 asks you| · 5 min · $0.50 by workers", "its review starts next: nothing runs; the worker asks you");
    // A call of the worker that held the task before — a send-back's — is not this one's.
    progress.set("t3", { agent: "sa-0", round: 9, tool: null, asking: { tool: "bash", args: "rm -rf build" } });
    assert.equal(lineOf(drawGraph(graphView(s.queued), { h: fakeH, now: NOW, progress, crew: "team", members: LED }).el, "t3"), "Tester · started 4 min ago");
    // (fails before: yes — a reviewer's call waiting for your answer was drawn as its reading: "in review", its bar
    // sliding, counted running, and its card's answer opened the builder's thread)
    // Its reviewer asks you: the same orange, its thread a press away, and it runs not meanwhile.
    /** @type {string[]} */
    const opened = [];
    const reviewer = new Map([["t2", { agent: "sa-4", round: 2, tool: null, asking: { tool: "bash", args: "npm test" } }]]);
    const reads = drawGraph(graphView(s.reading), { h: fakeH, now: NOW, progress: reviewer, chosen: "t2", crew: "team", members: LED, onOpenAgent: (id) => opened.push(id) }).el;
    assert.deepEqual([textOf(nodeOf(reads, "t2")), lineOf(reads, "t2"), one(nodeOf(reads, "t2"), "tg-node-bar")], ["t2|Fix the parser|Asks you", "Reviewer · wants to run npm test", undefined]);
    assert.equal(textOf(one(reads, "tg-figs")), "1 of 3 done · 1 running · |1 asks you| · 5 min · $0.50 by workers");
    assert.match(textOf(one(reads, "tg-card")), /^t2\|Fix the parser\|asks you\|.*\|It asks you\|wants to run npm test\|.*\|Review 1\|reading the change now · \|sa-4\|/);
    buttonsOf(one(reads, "tg-card")).find((b) => textOf(b) === "Answer in its thread").dispatch("click");
    assert.deepEqual(opened, ["sa-4"]);
    // A graph the agent planned, now the lead's: its own task waits for a member; the lead's words in the holds.
    const own = drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, chosen: "t4", crew: "team", members: LED }).el;
    assert.deepEqual([textOf(nodeOf(own, "t4")), lineOf(own, "t4")], ["t4|Release", "the agent's own: it waits for a worker"]);
    assert.equal(textOf(one(own, "tg-card")), "t4|Release|waiting|the agent's own — it waits for the lead to give it to a worker · added 5 min ago|Needs|t2|t3|When it is done|The lead gives it to a worker and Filament starts it, or the lead marks it done or drops it; it shows here.");
    assert.deepEqual(byClass(one(own, "tg-card"), "tg-chip").map((x) => x.attrs.title), ["t2: running", "t3: running"]);
    assert.equal(textOf(one(own, "tg-figs")), "1 of 4 done · 2 running · 5 min · $0.25 by workers");
    const stopped = drawGraph(graphView(hold(MAPPED, T0 + 105_000)), { h: fakeH, now: NOW, crew: "team", members: LED }).el;
    assert.deepEqual([textOf(one(stopped, "tg-callout")), lineOf(stopped, "t2")], ["Held| — since your stop: Filament starts no worker's task until the lead's next tasks call.", "held until the lead's next tasks call"]);
  });

  // (fails before: yes — the review of 11-03: with no team's members at hand, the Tester's seat read "tester" under the bot)
  test("a seat of the shipped crew with no member list at hand: its seat's name and its card's glyph, from the settings answer's crew", () => {
    const el = drawGraph(graphView(teamSteps().queued), { h: fakeH, now: NOW, crew: "agent", shippedCrew: SHIPPED_CREW, chosen: "t3" }).el;
    assert.deepEqual([tipOf(el, "t3")[2], one(one(el, "tg-card"), "tg-card-by").attrs.html], ["Tester: it changes files in its own worktree", ICONS.hammer]);
  });

  // (fails before: yes — the same refusal; and nothing could open a task from elsewhere)
  test("the Plan view opens a task chosen from elsewhere, following it into view once", async () => {
    const view = graphView(teamSteps().reading);
    /** The view as tall as it is laid out: 0 while it is hidden; t1's box at 144–196 px. */
    const size = { height: 0 };
    const page = laidOut(size);
    const chat = /** @type {any} */ (chatOf("chosen-elsewhere", { turns: [turnWith([{ n: 1, type: "graph", round: 1, graph: view }])] }));
    chat.view.settings.engine = { mode: "team", team: "architect", teams: [] };
    /** @type {any} */
    let shown;
    const draw = () => {
      const body = fakeH("div");
      shown = renderPlan(body, { chat }, { h: page.h, api: async () => null, now: () => NOW });
      return body;
    };
    let body = draw();
    assert.equal(one(body, "tg-foot"), undefined, "no foot: the head has Run log");
    // The Team view's tasks still to come read the same graph.
    assert.deepEqual(planView.graphOf(chat, { api: async () => null, onLand: () => {} }).tasks.map((/** @type {any} */ t) => [t.id, t.state]), [["t1", "done"], ["t2", "review"], ["t3", "running"]]);
    // A waiting card of the Team view opens its task: its card, the view following it into sight though it was chosen
    // — once: the developer's own scroll holds after.
    planView.chooseTask(chat, "t1");
    size.height = 100;
    body = draw();
    assert.match(textOf(one(body, "tg-card")), /^t1\|Map the callers\|done\|/);
    assert.deepEqual([page.inSight(nodeOf(body, "t1")), page.scroller().scrollTop], [true, 96]);
    // The same view drawn again (a view made anew is a showing of its own, the owner's of 11-11): t1's card still, the
    // view where they put it.
    const scroller = page.scroller();
    scroller.scrollTop = 0;
    scroller.dispatch("scroll");
    chat.taskProgress = new Map([["t3", { agent: "", round: 2, tool: null }]]);
    shown.paint();
    assert.match(textOf(one(body, "tg-card")), /^t1\|Map the callers\|done\|/);
    assert.deepEqual([page.inSight(nodeOf(body, "t1")), page.scroller().scrollTop], [false, 0]);
  });

  // (fails before: yes — G3-7: the feed dropped the call a task's worker asks you about, and the conversation's rows
  // spoke of the agent under a lead, with no words for a stopped review)
  test("the page keeps a task's worker's waiting call from the feed; the conversation's rows speak of whoever plans, a stopped review in its own words", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    assert.match(app, /tool: msg\.progress\?\.tool \|\| null, asking: msg\.progress\?\.asking \|\| null \}\);/);
    const who = "“t2: Fix the parser”";
    assert.deepEqual([{ task: "" }, { task: "t2", state: "failed" }, { task: "t2", state: "waiting" }, { task: "t2", state: "review" }].map((r) => teamLib.taskNote(r, who, true).text), [
      "Filament started the graph's ready tasks — the lead heard which here",
      "Task “t2: Fix the parser” failed — the lead heard it here, with its choices",
      "Task “t2: Fix the parser” was stopped — it waits for the lead's next tasks call",
      "The review of task “t2: Fix the parser” was stopped — it waits for the lead's next tasks call",
    ]);
    assert.equal(teamLib.taskNote({ task: "t2", state: "review" }, who, false).text, "The review of task “t2: Fix the parser” was stopped — it waits for the agent's next tasks call");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const rows = cardsEl\(cell, \{ live, lead: turn\.engine\?\.kind === "team", runId: turn\.runId,/);
    assert.match(timeline, /kept\("report", cell\.reports \|\| \[\], \(r\) => reportNote\(r, lead\)\);/);
  });
});

describe("TaskGraph G3: a review to its end, and the Plan view under a lead", () => {
  // (fails before: yes — the core refused a team's roles, and the view knew no review; a test the mutation pass asked
  // for: no test drew a review to its end, a merge on the lead's word, a reviewer alone at work, or a graph the agent
  // planned carried on by a team)
  test("a review to its end — passed and merged, failed at its last round and merged on the lead's word, or never made — a reviewer alone at work, and a team carrying on the agent's graph", () => {
    const s = teamSteps();
    // Its builder fixed the changes asked; a second reviewer reads them.
    const reread = stepped(
      s.fixing,
      ended("t2", END("sa-2", { report: { status: "done", did: "Took the lone comma too", met: true, evidence: "npm test: 42 passed", left: "" }, files: [{ path: "src/parse.js", added: 34, removed: 2 }], wrote: true, ran: [{ command: "npm test", exit: 0 }], spentUsd: 0.15, ms: 40_000 }), T0 + 260_000),
      (g) => tg.reviewLaunched(g, "t2", "sa-5"),
    );
    /** The second round's end. @param {boolean} met */
    const round2 = (met) => (/** @type {any} */ g) =>
      tg.reviewEnded(g, "t2", END("sa-5", { report: { status: "done", did: "Read the change", met, evidence: met ? "a lone comma parses" : "a lone comma still throws", left: met ? "" : "parse() must take a lone comma" }, spentUsd: 0.05, ms: 20_000 }), T0 + 280_000)?.graph;
    const merged = stepped(reread, round2(true), (g) => taskMerged(g, "t2", [{ path: "src/parse.js", added: 34, removed: 2 }], T0 + 290_000));
    const done = drawGraph(graphView(merged), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED }).el;
    assert.equal(lineOf(done, "t2"), "applied · 1 file (+34 −2)");
    /** The card's part that says how the task's work ended. @param {any} el */
    const report = (el) => byClass(one(el, "tg-card"), "tg-sec").map((x) => textOf(x)).find((x) => /^(Its report|Why it failed)\|/.test(x));
    assert.equal(report(done), "Its report|Status|done · acceptance met|What it did|Took the lone comma too|Evidence|npm test: 42 passed|Applied|1 file (+34 −2)|Ran|npm test → exit 0|Spent|$0.15 · under a minute · $0.55 with its review|Review 1|changes asked — parse() must take a lone comma · |sa-4|Review 2|it does what the task asks — a lone comma parses · |sa-5");
    // Its last round still asked for changes: it failed, and the lead merges its change as it stands.
    const failed = stepped(reread, round2(false));
    assert.equal(lineOf(drawGraph(graphView(failed), { h: fakeH, now: NOW, crew: "team", members: LED }).el, "t2"), "its review still asked for changes at round 2 of 2: parse() must take a lone comma");
    const overruled = stepped(failed, (g) => /** @type {any} */ (applyTasks(g, { action: "merge", id: "t2", reason: "the lone comma is t5's" }, { at: T0 + 290_000, crew: LED })).graph);
    const lead = drawGraph(graphView(overruled), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED }).el;
    assert.equal(lineOf(lead, "t2"), "3-way apply · on the lead's word");
    assert.match(textOf(one(lead, "tg-card")), /\|Review\|a reviewer reads its change before it merges\|Merge\|as it stands, on the lead's word: the lone comma is t5's$/);
    // Its reviewer ended with no report: no review was made, and the task failed in those words.
    const unmade = stepped(s.reading, (g) => tg.reviewEnded(g, "t2", END("sa-4", { report: null, words: "I ran out of room" }), T0 + 230_000)?.graph);
    assert.equal(
      report(drawGraph(graphView(unmade), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED }).el),
      "Why it failed|its review could not be made: its reviewer ended without its report|Status|done · acceptance met|What it did|Took the trailing comma in parse()|Evidence|npm test: 41 passed|Changed|src/parse.js (+30 −0)|Ran|npm test → exit 0|Spent|$0.25 · 1 min · $0.50 with its review|Review 1|no report — its last words: I ran out of room · |sa-4",
    );
    // Its tester done, its reviewer alone at work: the card is the review's, and the time runs on.
    const alone = stepped(s.queued, ended("t3", END("sa-3", { report: { status: "done", did: "Added the test", met: true, evidence: "the new test passes", left: "" } }), T0 + 205_000), (g) => tg.reviewLaunched(g, "t2", "sa-4"));
    const a = drawGraph(graphView(alone), { h: fakeH, now: NOW, crew: "team", members: LED }).el;
    assert.match(textOf(one(a, "tg-card")), /^t2\|Fix the parser\|in review\|Builder — sa-2 · started 4 min ago\|/);
    assert.equal(textOf(one(a, "tg-figs")), "2 of 3 done · 1 running · 5 min · $0.75 by workers");
    // The builder's newest step is its own: its reviewer's line waits for the reviewer's. A worker's report is to come.
    /** @type {Map<string, any>} */
    const builders = new Map([["t2", { agent: "sa-2", round: 7, tool: { name: "edit", args: "src/parse.js" }, asking: null }]]);
    const reading = drawGraph(graphView(s.reading), { h: fakeH, now: NOW, progress: builders, crew: "team", members: LED }).el;
    assert.equal(lineOf(reading, "t2"), "Reviewer · round 1 of 2");
    assert.match(textOf(one(reading, "tg-card")), /\|Needs\|.*\|Its report\|Its report shows here once its worker ends\.\|/);
    // A graph the agent planned, carried on by a team: a started task runs as the role the lead's team gives it.
    const carried = drawGraph(graphView(stepped(MAPPED, tookAs("t2", "sa-2", T0 + 110_000, "builder"))), { h: fakeH, now: NOW, crew: "team", members: LED }).el;
    assert.deepEqual(
      [nodeOf(carried, "t2").attrs["aria-label"], tipOf(carried, "t2")[2], lineOf(carried, "t2"), nodeOf(carried, "t3").attrs["aria-label"], tipOf(carried, "t3")[2]],
      ["t2 Fix the parser: running (Builder); needs t1", "Builder: it changes files in its own worktree", "Builder · started 4 min ago", "t3 Test the comma: ready (an agent); needs t1", "An agent does it, in its own worktree"],
    );
  });

  // (fails before: yes — the Plan view spoke of the agent alone; a test the mutation pass asked for: no test had a task
  // chosen again, or no graph yet under a lead)
  test("the Plan view under a lead: the checklist planned last, the graph from before a press away and followed into sight; a task chosen again is brought back; no graph yet, in the lead's words", () => {
    const view = graphView(teamSteps().reading);
    // The view 200 px tall; t3's box at 236–288 px.
    const page = laidOut({ height: 200 });
    /** A lead's session whose turn carried these events. @param {string} id @param {any[]} events */
    const leadChat = (id, events) => {
      const c = /** @type {any} */ (chatOf(id, { turns: [turnWith(events)] }));
      c.view.settings.engine = { mode: "team", team: "architect", teams: [] };
      return c;
    };
    /** @type {any} */
    let shown;
    const draw = (/** @type {any} */ c) => {
      const body = fakeH("div");
      shown = renderPlan(body, { chat: c }, { h: page.h, api: async () => null, now: () => NOW });
      return body;
    };
    const chat = leadChat("lead-plan", [{ n: 1, type: "graph", round: 1, graph: view }, { n: 2, type: "plan", round: 2, items: [{ text: "Write the release notes", status: "doing" }] }]);
    // The checklist was planned last: its page, the graph from before a press away (`pageOf`).
    const before = draw(chat);
    assert.match(textOf(one(before, "pv-column")), /^Checklist\|0 of 1 done\|Write the release notes\|now\|The lead keeps a checklist for work this short\. .*\|The session's task graph is from before: 1 of 3 done\. \|Show the graph$/);
    // Show the graph: the graph from before, the checklist a press back, and the view follows its choice.
    /** @type {any} */ (buttonsOf(before).find((b) => textOf(b) === "Show the graph")).dispatch("click");
    assert.deepEqual([byClass(before, "pv-column").length, byClass(before, "pv-back").length], [0, 1]);
    assert.deepEqual([page.inSight(nodeOf(before, "t3")), page.scroller().scrollTop], [true, 88], "the view follows its choice");
    // The developer scrolls away, and the same view drawn again stays there (a view made anew is a showing of its own,
    // the owner's of 11-11); the task chosen again from the Team view is brought back.
    let body = draw(chat);
    const scroller = page.scroller();
    scroller.scrollTop = 0;
    scroller.dispatch("scroll");
    chat.taskProgress = new Map([["t3", { agent: "", round: 2, tool: null }]]);
    shown.paint();
    assert.deepEqual([page.inSight(nodeOf(body, "t3")), page.scroller().scrollTop], [false, 0]);
    planView.chooseTask(chat, "t3");
    body = draw(chat);
    assert.deepEqual([page.inSight(nodeOf(body, "t3")), page.scroller().scrollTop], [true, 88]);
    // A lead's session with its checklist and no graph yet: its checklist, in the lead's words.
    body = draw(leadChat("lead-none", [{ n: 1, type: "plan", round: 1, items: [{ text: "Write the release notes", status: "doing" }] }]));
    assert.equal(textOf(one(body, "pv-quiet")), "The lead keeps a checklist for work this short. When work has pieces that wait on each other, or could run in parallel, it keeps a task graph — and the graph shows here instead.");
    assert.equal(byClass(body, "pv-other").length, 0, "no graph from before");
  });

  // (fails before: yes — the G3f drive: a review's row led with its reviewer's link, a colon after it — "sa-4 ›:
  // changes asked" — where what the round found belongs first)
  test("a review's round says what it found first and its reviewer's link after it; the round reading now the same", () => {
    const s = teamSteps();
    /** The card's report part. @param {any} el */
    const reportOf = (el) => byClass(one(el, "tg-card"), "tg-sec").find((x) => textOf(x).startsWith("Its report|"));
    const end = reportOf(drawGraph(graphView(s.fixing), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED, onOpenAgent: () => {} }).el);
    const kv = one(end, "tg-kv").kids;
    const parts = kv[kv.findIndex((/** @type {any} */ k) => textOf(k) === "Review 1") + 1].kids[0].kids;
    assert.deepEqual(parts.map((/** @type {any} */ p) => (typeof p === "string" ? p : `${p.tag}.${p.attrs.class}: ${textOf(p)}`)), ["changes asked — parse() must take a lone comma · ", "button.inst-link: sa-4"]);
    const reading = reportOf(drawGraph(graphView(s.reading), { h: fakeH, now: NOW, chosen: "t2", crew: "team", members: LED }).el);
    assert.match(textOf(reading), /\|Review 1\|reading the change now · \|sa-4$/, "with no way to open it, its id as words");
  });
});

// The owner's word of 10-23, a screenshot of the Plan tab after the agent's turn had ended: "saw this still running …
// it should also have been paused or something." The graph keeps the agent's own task running until its next turn;
// nothing works on it meanwhile. Drawn paused until E41 P4; since then (HarnessV4_TaskGraphPlus_Design D1-1) drawn
// between turns — running, its arc still, no bar — for *paused* is now a pause's alone: a task the agent left on
// purpose, with its checkpoint (E36).
describe("TaskGraph: the agent's own task between its turns", () => {
  const BETWEEN = "between turns — goes on at the agent's next turn";
  // (fails before: yes — the box spun, its bar slid and the head counted it running 52 min after the turn ended)
  test("not at work: the agent's own running task is drawn between turns — its box, mark, line, head and card; no bar", () => {
    const { el } = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, atWork: false });
    // (fails before: yes — the owner's of 11-09: the head counted it among what runs at once, and the rail's step said
    // "at work") The graph keeps it running; nothing works on it until the agent's next turn.
    assert.equal(textOf(one(el, "tg-head")), "Task graph|1 of 4 done · 5 min|Ship the parser", "nothing runs at once between turns");
    assert.equal(textOf(nodeOf(el, "t2")), "t2|Parser|between turns", "its line's two words: the rest in its tooltip");
    // (fails before: yes — the review of 11-05: its tooltip said it twice, "running — between turns · between turns —
    // …", and a paused task's "paused · paused · …")
    assert.equal(tipOf(el, "t2")[1], `running · ${BETWEEN}`);
    const paused = drawGraph(viewAfter([...RUN, [{ action: "pause", id: "t2", checkpoint: "Half the parser done; next the commas" }, T0 + 250_000]]), { h: fakeH, now: NOW }).el;
    assert.match(tipOf(paused, "t2")[1], /^paused · checkpoint 1, \S+$/);
    // Blocked as well: each word once.
    const pv = viewAfter([...RUN, [{ action: "pause", id: "t2", checkpoint: "Half the parser done; next the commas" }, T0 + 250_000]]);
    const blocked = drawGraph({ ...pv, tasks: pv.tasks.map((/** @type {any} */ t) => (t.id === "t2" ? { ...t, blocked: true } : t)) }, { h: fakeH, now: NOW }).el;
    assert.match(tipOf(blocked, "t2")[1], /^paused · blocked · checkpoint 1, \S+$/);
    assert.deepEqual([nodeOf(el, "t2").attrs.class, nodeOf(el, "t2").attrs["aria-label"]], ["tg-node is-running is-still is-on", "t2 Parser: running, between turns; needs t1"]);
    assert.deepEqual([one(nodeOf(el, "t2"), "tg-mark").attrs.class, one(nodeOf(el, "t2"), "tg-mark").attrs.title], ["tg-mark is-running is-still", "running — between turns"]);
    assert.equal(byClass(el, "tg-node-bar").length, 0, "nothing slides: nothing works on it");
    assert.equal(byClass(el, "tg-pill").length, 0, "it calls for no one: the agent's next turn takes it on");
    assert.equal(textOf(one(el, "tg-card")), "t2|Parser|between turns|the agent · started 2 min ago · between the agent's turns|Needs|t1|Needed by|t4|Writes|src/parse.js, src/ast.js");
    assert.deepEqual(byClass(el, "tg-node").map((n) => n.attrs.class), ["tg-node is-done", "tg-node is-running is-still is-on", "tg-node is-ready", "tg-node is-waiting"], "the task between turns is the one the card shows, as a running one is");
    // (fails before: yes — the Hunter of p4b: its chips spun in the Needs, Needed by and side-by-side rows)
    const t4 = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, atWork: false, chosen: "t4" }).el;
    assert.deepEqual(byClass(one(t4, "tg-card"), "tg-chip").filter((x) => textOf(x) === "t2").map((x) => [x.attrs.title, one(x, "tg-mark").attrs.class]), [["t2: running, between turns", "tg-mark is-running is-still"]]);
    // At work, or not said: as the graph says.
    for (const o of [{ atWork: true }, {}]) {
      const at = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, ...o }).el;
      assert.equal(textOf(one(at, "tg-figs")), "1 of 4 done · 1 running · 5 min");
      assert.equal(textOf(nodeOf(at, "t2")), "t2|Parser|started 2 min ago");
      assert.equal(byClass(at, "is-still").length, 0);
    }
    // The view itself is left as it was: the core's graph keeps the task running.
    const view = viewAfter(RUN);
    const between = tgv.betweenTurns(view);
    assert.deepEqual([view.tasks[1].state, between.tasks[1].state, between.tasks[1].between, view.tasks[1].between, between.tasks[0]], ["running", "running", true, undefined, view.tasks[0]]);
    const none = viewAfter(RUN.slice(0, 1));
    assert.equal(tgv.betweenTurns(none), none, "nothing of its own running: the same view");
  });

  // (fails before: no — a guard: what runs without the agent's turn stays running)
  test("a sub-agent's task runs on without the agent's turn, and a team's lead plans apart from it: both stay as they are", () => {
    const subs = drawGraph(graphView(AT_WORK), { h: fakeH, now: NOW, atWork: false }).el;
    assert.deepEqual(["t2", "t3"].map((id) => nodeOf(subs, id).attrs.class.split(" ")[1]), ["is-running", "is-running"]);
    assert.match(textOf(one(subs, "tg-figs")), /· 2 running ·/);
    assert.equal(byClass(subs, "is-paused").length, 0);
    const team = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, atWork: false, crew: "team", members: LED }).el;
    assert.equal(nodeOf(team, "t2").attrs.class.split(" ")[1], "is-running");
  });

  // (fails before: yes — the Plan view drew the graph's word whatever the chat's turn did)
  test("the Plan view: between turns while no turn is at work; at work while this page's turn is live, the runs say one goes on, or another window holds it", async () => {
    const chat = chatOf("between");
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: fakeH, api: async () => ({ inForce: { graph: viewAfter(RUN), goal: null } }), now: () => NOW });
    await settle();
    const says = () => [textOf(one(body, "tg-figs")), lineOf(body, "t2")];
    assert.deepEqual(says(), ["1 of 4 done · 5 min", BETWEEN]);
    try {
      state.runningChains.add(chat.chainId);
      view.paint();
      assert.deepEqual(says(), ["1 of 4 done · 1 running · 5 min", "started 2 min ago"], "the runs say its run goes on");
      state.runningChains.delete(chat.chainId);
      view.paint();
      assert.deepEqual(says(), ["1 of 4 done · 5 min", BETWEEN], "its run ended: between turns again");
      state.holders.set(chat.chainId, { window: "w2" });
      view.paint();
      assert.equal(says()[1], "started 2 min ago", "another window holds its turn");
      state.holders.delete(chat.chainId);
      const turn = { n: 2, status: "streaming", aligned: alignEvents([{ n: 1, type: "graph", round: 1, graph: viewAfter(RUN) }]) };
      chat.turns.push(turn);
      chat.live = /** @type {any} */ ({ turn });
      assert.equal(atWork(chat.chainId, chat), true);
      view.paint();
      assert.equal(says()[1], "started 2 min ago", "this page's turn is live");
    } finally {
      state.runningChains.delete(chat.chainId);
      state.holders.delete(chat.chainId);
    }
    assert.deepEqual([atWork(null), atWork(undefined, { live: null }), atWork("chain-none")], [false, false, false]);
  });

  // (fails before: yes — nothing painted the Plan tab when a run ended: the page waited for the next pulse)
  test("a run that begins or ends, or a turn's holder that comes or goes, paints the views again; the left bar's spinner reads the same rule", () => {
    const side = readFileSync(new URL("../src/ui/harness/sidebar.js", import.meta.url), "utf8");
    assert.match(side, /if \(!same\) cb\.onAtWork\?\.\(\);/);
    assert.match(side, /else state\.holders\.delete\(msg\.chainId\);\n\s+patchChats\(\[msg\.chainId\]\);\n\s+cb\.onAtWork\?\.\(\);/);
    assert.match(side, /if \(moved\.size\) \{\n\s+patchChats\(moved\);\n\s+cb\.onAtWork\?\.\(\);/);
    assert.match(side, /const busy = atWork\(s\.id, chat\);/);
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    // The crafter's line over the box reads the same moments (crafter-line.js).
    assert.match(app, /onAtWork: \(\) => \{ views\.pulse\(\); paintCrafterLine\(\); paintBrowserLine\(\); paintAgents\(\); \},/);
  });
});
