// @ts-check
// The Plan view says a running task's newest step — its round, its tool, from the feed — in the drawing as it stands
// (task-graph.js `patch`, plan.js `paintNow`): the owner's of 11-17, the page drew its whole graph again at each step of
// each agent, some 33,000 elements a minute while six ran. Each line's words and tooltip are set where they stand, and a
// task's pop let go, as a drawing made then would have it; what else a step moves — a task's drawn state, what one asks
// you — draws it anew. The oracle: the drawing patched equals the one drawn afresh with the same steps.
// (fails before: yes — there was no patch, and a step drew the page anew)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTasks, graphView, launched, taskEnded } from "../src/core/task-graph.js";
import * as tg from "../src/core/task-graph.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { drawGraph } from "../src/ui/harness/views/task-graph.js";
import { renderPlan } from "../src/ui/harness/views/plan.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { MEMBERS as LED } from "./helpers/roster.js";

const T0 = 1_000_000;
const NOW = T0 + 320_700;

/** A drawing as data: each node's tag, its attributes but its handlers, and its children. @param {any} n @returns {any} */
const tree = (n) =>
  n == null || typeof n !== "object"
    ? String(n)
    : { tag: n.tag, attrs: Object.fromEntries(Object.entries(n.attrs || {}).filter(([, v]) => typeof v !== "function")), kids: (n.kids || []).map(tree) };
/** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
const all = (n, pred, out = []) => {
  if (n && typeof n === "object") {
    if (pred(n)) out.push(n);
    for (const k of n.kids || []) all(k, pred, out);
  }
  return out;
};
/** @param {any} el @param {string} id */
const nodeOf = (el, id) => all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes("tg-node") && String(x.attrs["aria-label"]).startsWith(`${id} `))[0];
/** A stand-in `h` that counts the elements it makes. */
const counting = () => {
  const c = { made: 0, h: /** @type {typeof fakeH} */ ((...a) => (c.made++, fakeH(...a))) };
  return c;
};

const END = (/** @type {string} */ agent, /** @type {Record<string, any>} */ o = {}) => ({ agent, status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Found the 3 callers", met: true, evidence: "rg listed them", left: "" }, words: "", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0.25, ms: 90_000, cut: false, ...o });
/** @param {any} g @param {((g: any) => any)[]} steps @returns {any} */
const stepped = (g, ...steps) => steps.reduce((x, step) => { const next = step(x); assert.ok(next, "a step the core took"); return next; }, g);
const took = (/** @type {string} */ id, /** @type {string} */ agent, /** @type {number} */ at, /** @type {any} */ as = undefined) => (/** @type {any} */ g) => launched(g, id, agent, at, as);
const ended = (/** @type {string} */ id, /** @type {any} */ end, /** @type {number} */ at) => (/** @type {any} */ g) => taskEnded(g, id, end, at)?.graph;
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
/** t1 done; t2 and t3 at work, sa-2's and sa-3's. */
const AT_WORK = stepped(/** @type {any} */ (applyTasks(null, HANDED, /** @type {any} */ ({ at: T0 }))).graph, took("t1", "sa-1", T0 + 10_000), ended("t1", END("sa-1"), T0 + 100_000), took("t2", "sa-2", T0 + 110_000), took("t3", "sa-3", T0 + 110_000));

/** Running steps, by task. @param {Record<string, any>} by @returns {Map<string, any>} */
const steps = (by) => new Map(Object.entries(by));
const at = (/** @type {string} */ agent, /** @type {number} */ round, /** @type {string | null} */ tool, /** @type {any} */ asking = null) => ({ agent, round, tool: tool ? { name: tool.split(" ")[0], args: tool.split(" ").slice(1).join(" ") } : null, asking });

test("drawn, then patched with the next steps: equal to the drawing made with them, a task's pop let go, nothing made — on the canvas and on the rail, a task's card open", () => {
  for (const pane of [false, true]) {
    const view = graphView(AT_WORK);
    const o = { now: NOW, chosen: "t2", autoPick: false, pane, width: 1400 };
    const c = counting();
    const g = drawGraph(view, { ...o, h: c.h, progress: steps({ t2: at("sa-2", 1, "bash npm test") }), popped: new Set(["t2"]) });
    assert.match(String(nodeOf(g.el, "t2").attrs.class), /is-new/, "t2 just started: it pops");
    const next = steps({ t2: at("sa-2", 2, "edit src/parse.js"), t3: at("sa-3", 1, "read test/parse.test.js") });
    const before = c.made;
    assert.equal(g.patch(next), true);
    assert.equal(c.made, before, "nothing made");
    const fresh = drawGraph(view, { ...o, h: fakeH, progress: next, popped: new Set() });
    assert.deepEqual(tree(g.el), tree(fresh.el), `the same drawing${pane ? ", on the rail" : ""}`);
    assert.match(textOf(nodeOf(g.el, "t2")), /round 2 · edit src\/parse\.js/);
    assert.match(textOf(nodeOf(g.el, "t3")), /round 1 · read test\/parse\.test\.js/);
    // A question to its lead is words on its line too (TG2-D49).
    const lead = steps({ t2: at("sa-2", 2, "edit src/parse.js", { tool: "ask", args: "which file?", to: "lead" }), t3: at("sa-3", 1, null) });
    assert.equal(g.patch(lead), true);
    assert.deepEqual(tree(g.el), tree(drawGraph(view, { ...o, h: fakeH, progress: lead }).el));
    // The steps gone: the lines say when they started, as drawn afresh.
    assert.equal(g.patch(null), true);
    assert.deepEqual(tree(g.el), tree(drawGraph(view, { ...o, h: fakeH, progress: null }).el));
  }
});

test("a step that moves more than words is no patch: a task that asks you, and what it asks changing while it asks; the same ask patches", () => {
  const view = graphView(AT_WORK);
  const o = { h: fakeH, now: NOW, chosen: "t2", autoPick: false, width: 1400 };
  const g = drawGraph(view, { ...o, progress: steps({ t2: at("sa-2", 1, "bash npm test") }) });
  const asks = steps({ t2: at("sa-2", 1, "bash npm test", { tool: "bash", args: "npm publish" }) });
  assert.equal(g.patch(asks), false, "t2 asks you: its mark, the head's figures and its card's It asks you change");
  const asking = drawGraph(view, { ...o, progress: asks });
  assert.equal(asking.patch(steps({ t2: at("sa-2", 1, "bash npm test", { tool: "bash", args: "rm -rf dist" }) })), false, "what it asks changed: its card says it");
  assert.equal(asking.patch(steps({ t2: at("sa-2", 1, "edit x", { tool: "bash", args: "npm publish" }), t3: at("sa-3", 2, "read y") })), true, "the same ask: the rest are words");
  assert.deepEqual(tree(asking.el), tree(drawGraph(view, { ...o, progress: steps({ t2: at("sa-2", 1, "edit x", { tool: "bash", args: "npm publish" }), t3: at("sa-3", 2, "read y") }) }).el));
});

test("a team's reviewer reading: its newest tool patched in, as drawn afresh", () => {
  const TEAM = { action: "add", goal: "Ship the parser", tasks: [
    { id: "t1", name: "Map the callers", by: "scout", goal: "Every caller of parse() is known", steps: ["Search for parse("], acceptance: "each caller listed" },
    { id: "t2", name: "Fix the parser", needs: ["t1"], by: "builder", review: true, writes: ["src/parse.js"], goal: "parse() takes a trailing comma", steps: ["Fix parse.js", "Run npm test"], acceptance: "npm test passes" },
    { id: "t3", name: "Test the comma", needs: ["t1"], by: "tester", writes: ["test/parse.test.js"], goal: "A test pins the trailing comma", steps: ["Add the test"], acceptance: "the new test passes" },
  ] };
  const start = /** @type {any} */ (applyTasks(null, TEAM, { at: T0, crew: LED })).graph;
  const reading = stepped(start, took("t1", "sa-1", T0 + 10_000, "scout"), ended("t1", END("sa-1"), T0 + 100_000), took("t2", "sa-2", T0 + 110_000, "builder"), took("t3", "sa-3", T0 + 110_000, "tester"),
    ended("t2", END("sa-2", { files: [{ path: "src/parse.js", added: 30, removed: 0 }], wrote: true }), T0 + 200_000), (g) => tg.reviewLaunched(g, "t2", "sa-4"));
  const view = graphView(reading);
  const o = { h: fakeH, now: NOW, crew: /** @type {const} */ ("team"), members: LED, width: 1400 };
  const g = drawGraph(view, { ...o, progress: steps({ t2: at("sa-4", 1, "read src/parse.js") }) });
  assert.match(textOf(nodeOf(g.el, "t2")), /round 1 of 2 · read src\/parse\.js/);
  const next = steps({ t2: at("sa-4", 2, "bash npm test"), t3: at("sa-3", 3, "edit test/parse.test.js") });
  assert.equal(g.patch(next), true);
  assert.deepEqual(tree(g.el), tree(drawGraph(view, { ...o, progress: next }).el));
  assert.match(textOf(nodeOf(g.el, "t2")), /round 1 of 2 · bash npm test/);
});

/** A chat in the page with this graph on its turn. @param {string} id @param {any} graph */
const chatOf = (id, graph) => /** @type {any} */ ({ id, chainId: `chain-${id}`, title: id, turns: [{ n: 1, status: "done", aligned: alignEvents([{ n: 1, type: "graph", round: 1, graph: graphView(graph) }]) }], live: null, view: { settings: {} } });

test("the Plan view: a step alone makes no element and draws as the page made afresh; a task that asks, a pick and a state change draw anew, and the steps after them patch again", () => {
  const c = counting();
  const chat = chatOf("patched", AT_WORK);
  const body = fakeH("div");
  const view = renderPlan(body, { chat }, { h: c.h, api: async () => null, now: () => NOW });
  /** The page made afresh for a chat as this one stands, the same task pressed. @param {string | null} pick */
  const fresh = (pick) => {
    const twin = chatOf(`fresh-${Math.random()}`, AT_WORK);
    Object.assign(twin, { turns: chat.turns, taskProgress: chat.taskProgress });
    const b = fakeH("div");
    renderPlan(b, { chat: twin }, { h: fakeH, api: async () => null, now: () => NOW });
    if (pick) nodeOf(b, pick).dispatch("click");
    return tree(b);
  };
  /** A paint, and how many elements it made. */
  const paint = () => {
    const was = c.made;
    view.paint();
    return c.made - was;
  };
  chat.taskProgress = steps({ t2: at("sa-2", 1, "bash npm test") });
  assert.equal(paint(), 0, "the first steps, where its line said when it started: words too");
  assert.deepEqual(tree(body), fresh(null));
  chat.taskProgress = steps({ t2: at("sa-2", 2, "edit src/parse.js") });
  assert.equal(paint(), 0, "a step alone: nothing made");
  assert.match(textOf(nodeOf(body, "t2")), /round 2 · edit src\/parse\.js/);
  assert.deepEqual(tree(body), fresh(null));
  // Moved in place, as the feed does it (app.js sets the task's entry).
  chat.taskProgress.set("t3", at("sa-3", 1, "read test/parse.test.js"));
  assert.equal(paint(), 0);
  assert.deepEqual(tree(body), fresh(null));
  assert.equal(paint(), 0, "nothing moved: nothing drawn");
  // The person's pick opens its card: drawn anew; its steps after patch, the card kept.
  nodeOf(body, "t2").dispatch("click");
  chat.taskProgress.set("t2", at("sa-2", 3, "bash npm test"));
  assert.equal(paint(), 0);
  assert.deepEqual(tree(body), fresh("t2"));
  // t2 asks you: drawn anew; the same ask with a new round of t3's patches.
  chat.taskProgress.set("t2", at("sa-2", 3, "bash npm test", { tool: "bash", args: "npm publish" }));
  assert.ok(paint() > 0, "a task that asks you: drawn anew");
  assert.match(textOf(body), /It asks you/);
  chat.taskProgress.set("t3", at("sa-3", 2, "edit test/parse.test.js"));
  assert.equal(paint(), 0);
  assert.deepEqual(tree(body), fresh("t2"));
  // t3's sub-agent ends: drawn anew, its task popping; the next step patches, and the pop goes as a fresh draw has it.
  chat.turns = chatOf("x", stepped(AT_WORK, ended("t3", END("sa-3", { files: [{ path: "test/parse.test.js", added: 5, removed: 0 }], wrote: true }), T0 + 300_000))).turns;
  assert.ok(paint() > 0, "a state change: drawn anew");
  assert.match(String(nodeOf(body, "t3").attrs.class), /is-new/, "it pops");
  chat.taskProgress.set("t2", at("sa-2", 4, "bash npm test", { tool: "bash", args: "npm publish" }));
  assert.equal(paint(), 0);
  assert.doesNotMatch(String(nodeOf(body, "t3").attrs.class), /is-new/);
  assert.deepEqual(tree(body), fresh("t2"));
});
