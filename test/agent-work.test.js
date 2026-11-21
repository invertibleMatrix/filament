// @ts-check
// Your agent's own work, drawn as a flow (HarnessV4_OneAgent_Plan L47, §16; the owner's word of 10-23: "A flow view of
// what your main agent did with its sub-agents on its own. this needs to be done. do it"): the picture from the chat's
// threads (lib/agent-work.js) — a step per reply of your agent, its agents side by side, each step's line true by the
// clock — its pane (views/agent-work.js) and the Agents tab's foot row that opens it (views/side.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STEPS_SHOWN, TOGETHER_MS, WORK_ITEM, boxWords, sentWords, workOf, workWords } from "../src/ui/harness/lib/agent-work.js";
import { WORK_LINE, createWorkPane } from "../src/ui/harness/views/agent-work.js";
import { WORK_ROW, createSideView } from "../src/ui/harness/views/side.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { NOW, agentRow, guestRowOf, sideIO, sideSeams } from "./helpers/side-view.js";

const S = 1000;
/**
 * An ask your agent made: its exchange. @param {number} start  seconds before NOW @param {number | null} end  seconds
 * before NOW, null while it runs @param {Record<string, any>} [o]
 */
const ask = (start, end, o = {}) => ({
  prompt: `PROMPT ${start}`, description: `Task ${start}`, by: "agent", runId: null, status: end == null ? "running" : "done", startedAt: NOW - start * S,
  endedAt: end == null ? null : NOW - end * S, delivery: "tool", report: end == null ? undefined : `ANSWER ${start}`, spentUsd: 0.01, ...o,
});
/** A thread of your agent's: a card and its asks. @param {string} id @param {string} name @param {any[]} exchanges @param {Record<string, any>} [o] */
const thread = (id, name, exchanges, o = {}) =>
  agentRow(id, { origin: "agent", card: { tag: name.toLowerCase(), name }, model: "zai/glm-5.3-flash", status: exchanges.some((x) => x.status === "running") ? "running" : "done", exchanges, ...o });
/** The reply that sent it. @param {string} run @param {number} round */
const sent = (run, round) => ({ sentIn: { run, round } });
const TURNS = [{ runId: "turn-1", n: 1, userText: "fix the parser and add tests" }, { runId: "turn-2", n: 2, userText: "and check the docs" }];
/** Each step's boxes by name, and its line. @param {import("../src/ui/harness/lib/agent-work.js").Work} w */
const shape = (w) => w.steps.map((s) => [s.boxes.map((b) => b.name), s.why]);

describe("the picture of your agent's own work", () => {
  // (fails before: yes — HarnessV4_OneAgent_Plan L47: nothing drew your agent's own work as a flow)
  test("one reply's agents side by side; a later reply below, its line saying who had answered; one sent while another worked; a new message of yours; a follow-up a box of its own", () => {
    const rows = [
      thread("s1", "Scout", [ask(100, 60, sent("turn-1", 3)), ask(20, 5, sent("turn-2", 1))]),
      thread("h1", "Helper", [ask(99.9, 70, sent("turn-1", 3))]),
      thread("b1", "Builder", [ask(50, 10, sent("turn-1", 5))]),
      thread("r1", "Reviewer", [ask(40, 30, sent("turn-1", 6))]),
    ];
    const w = workOf({ rows, turns: TURNS });
    assert.deepEqual(shape(w), [
      [["Scout", "Helper"], "After your message 1: “fix the parser and add tests”"],
      [["Builder"], "After Scout and Helper answered"],
      [["Reviewer"], "While Builder still worked"],
      [["Scout · 2nd ask"], "After your message 2: “and check the docs”"],
    ]);
    assert.deepEqual(w.steps[0].boxes.map((b) => [b.thread, b.n, b.run, b.round]), [["s1", 1, "turn-1", 3], ["h1", 1, "turn-1", 3]]);
    assert.deepEqual([w.agents, w.asks, w.working, w.asking], [4, 5, 0, 0]);
    assert.equal(workWords(w), "4 agents, 5 asks in 4 steps · $0.05");
  });

  // (fails before: yes — L47)
  test("after some answered while another still works; an ask that failed or was cut off says so in the line below it", () => {
    const rows = [
      thread("s1", "Scout", [ask(100, null, sent("turn-1", 2))]),
      thread("h1", "Helper", [ask(100, 80, sent("turn-1", 2))]),
      thread("b1", "Builder", [ask(60, null, sent("turn-1", 4))]),
      thread("x1", "Tester", [ask(60, 55, { ...sent("turn-1", 4), status: "failed", report: "" })]),
      thread("c1", "Checker", [ask(60, 54, { ...sent("turn-1", 4), status: "aborted", report: "" })]),
      thread("z1", "Fixer", [ask(40, 30, sent("turn-1", 6))]),
    ];
    const w = workOf({ rows, turns: TURNS });
    assert.equal(w.steps[1].why, "After Helper answered, while Scout still worked");
    assert.equal(w.steps[2].why, "After Checker was cut off and Tester failed, while Scout and Builder still worked");
    assert.deepEqual(w.steps[1].boxes.map((b) => [b.name, b.state]), [["Builder", "working"], ["Checker", "cut"], ["Tester", "failed"]]);
  });

  // (fails before: yes — L47-D4: the picture is your agent's own)
  test("not drawn: a thread you started, one that started by itself, a team's crew, a flow's box, an ask you sent in your agent's thread; with none, no row", () => {
    const rows = [
      agentRow("o1", { origin: "owner", exchanges: [ask(50, 40, { by: "owner" })] }),
      agentRow("w1", { origin: "self", exchanges: [ask(50, 40, { by: "self" })] }),
      agentRow("t1", { origin: "agent", team: { key: "architect", name: "Architect", role: "builder" }, exchanges: [ask(50, 40)] }),
      agentRow("f1", { origin: "flow", exchanges: [ask(50, 40, { by: "flow" })] }),
      thread("s1", "Scout", [ask(30, 20, { ...sent("turn-1", 1), by: "owner" })]),
    ];
    const w = workOf({ rows, turns: TURNS });
    assert.deepEqual([w.steps, w.asks], [[], 0]);
    assert.equal(workWords(w), null);
  });

  // (fails before: yes — L47-D5)
  test("with no reply recorded — a coding agent's own agents, a thread from before — by time: within 3 seconds of a step's first and none of it ended, side by side", () => {
    const own = [
      guestRowOf("g1", { startedAt: NOW - 200 * S, endedAt: NOW - 150 * S, agent: "Explore" }),
      guestRowOf("g2", { startedAt: NOW - 198 * S, endedAt: NOW - 120 * S, agent: "Plan" }),
      guestRowOf("g3", { startedAt: NOW - 100 * S, endedAt: NOW - 90 * S, agent: "general-purpose" }),
    ];
    const w = workOf({ rows: [], own, turns: [{ runId: "run_1", n: 4, userText: "look around" }] });
    assert.deepEqual(shape(w), [[["Explore", "Plan"], "After your message 4: “look around”"], [["general-purpose"], "After Explore and Plan answered"]]);
    assert.deepEqual([w.steps[0].boxes[0].of, sentWords(w.steps[0].boxes[0])], ["Claude Code", "Claude Code's own agent"]);
    assert.equal(TOGETHER_MS, 3000);
    const older = workOf({ rows: [
      thread("a", "Scout", [ask(100, 90)]),
      thread("b", "Helper", [ask(98, 80)]),
      thread("c", "Builder", [ask(96.5, 70)]),
      thread("d", "Tester", [ask(89, 85)]),
    ] });
    assert.deepEqual(shape(older), [[["Scout", "Helper"], ""], [["Builder"], "While Scout and Helper still worked"], [["Tester"], "While Helper and Builder still worked"]], "Builder came 3.5 s after Scout; Tester after Scout ended");
  });

  // (fails before: yes — L47 case 8, case 15)
  test("a box's state, live: at work, asking you; a graph's task tagged; the totals and the row's words; a box's line", () => {
    const rows = [
      thread("s1", "Scout", [ask(30, null, sent("turn-1", 1))], { progress: { round: 2, spent: 0.004, asking: { tool: "bash", args: "npm test", question: "" } } }),
      thread("h1", "Helper", [ask(30, null, sent("turn-1", 1))], { progress: { round: 1, spent: 0.002, asking: null } }),
      thread("t3", "Builder", [ask(30, 10, sent("turn-1", 1))], { task: "t3" }),
    ];
    const w = workOf({ rows, turns: TURNS });
    assert.deepEqual(w.steps[0].boxes.map((b) => [b.name, b.state, b.graph, b.usd]), [["Helper", "working", null, 0.002], ["Scout", "asking", null, 0.004], ["Builder", "done", "t3", 0.01]], "started together: by id");
    assert.equal(sentWords(w.steps[0].boxes[2]), "task t3 of your agent's graph");
    assert.equal(sentWords(w.steps[0].boxes[1]), "sent by your agent");
    assert.equal(workWords(w), "3 agents in 1 step · 1 asks you · 1 at work · $0.016");
    assert.equal(boxWords(w.steps[0].boxes[2], NOW), "GLM-5.3 Flash · 20s · $0.01");
    assert.equal(boxWords(w.steps[0].boxes[0], NOW), "GLM-5.3 Flash · 30s · $0.002", "a box at work: how long so far");
  });
});

describe("the pane: the picture on the Agents tab", () => {
  /** Every node under `n` that `pred` picks. @param {any} n @param {(x: any) => boolean} pred @param {any[]} [out] @returns {any[]} */
  const all = (n, pred, out = []) => {
    if (n && typeof n === "object") {
      if (pred(n)) out.push(n);
      for (const k of n.kids || []) all(k, pred, out);
    }
    return out;
  };
  /** @param {any} el @param {string} cls */
  const byClass = (el, cls) => all(el, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));
  /** @param {any[]} rows */
  const paneOf = (rows) => {
    /** @type {string[]} */
    const opened = [];
    let work = workOf({ rows, turns: TURNS });
    const pane = createWorkPane({ work: () => work, cards: () => [], openThread: (id) => opened.push(id), now: () => NOW }, { h: fakeH, place: (p, k) => p.replaceChildren(...k) });
    const chat = { chainId: "c1" };
    pane.paint(chat);
    return { pane, chat, opened, set: (/** @type {any[]} */ next) => { work = workOf({ rows: next, turns: TURNS }); } };
  };
  const ROWS = [
    thread("s1", "Scout", [ask(100, 60, sent("turn-1", 3))]),
    thread("h1", "Helper", [ask(99.9, 70, sent("turn-1", 3))]),
    thread("b1", "Builder", [ask(50, 10, sent("turn-1", 5))]),
  ];

  // (fails before: yes — L47)
  test("its head, its steps with their lines and boxes; a box pressed shows what it was asked and its answer, and opens its thread; pressed again it folds", () => {
    const v = paneOf(ROWS);
    const text = textOf(v.pane.el);
    assert.match(text, /Your agent's work\|3 agents in 2 steps · \$0\.03/);
    assert.match(text, new RegExp(WORK_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const steps = byClass(v.pane.el, "fl-step");
    assert.deepEqual(steps.map((s) => s.attrs["data-step"]), ["1", "2"]);
    assert.deepEqual(byClass(v.pane.el, "fl-why").map((x) => textOf(x)), ["After your message 1: “fix the parser and add tests”", "After Scout and Helper answered"]);
    const boxes = byClass(v.pane.el, "fl-box");
    assert.deepEqual(boxes.map((b) => b.attrs["data-box"]), ["s1#0", "h1#0", "b1#0"]);
    assert.match(textOf(boxes[0]), /^Scout\|Task 100\|GLM-5\.3 Flash · 40s · \$0\.01$/);
    assert.equal(byClass(v.pane.el, "fl-detail").length, 0);
    boxes[2].dispatch("click");
    const detail = byClass(v.pane.el, "fl-detail")[0];
    assert.ok(detail, "Builder's detail");
    assert.match(textOf(detail), /Builder\|sent by your agent · step 2 · GLM-5\.3 Flash · 40s · \$0\.01\|Done\|Asked\|PROMPT 50\|Its answer\|ANSWER 50\|Open its thread/);
    const open = all(detail, (x) => x.tag === "button")[0];
    open.dispatch("click");
    assert.deepEqual(v.opened, ["b1"]);
    byClass(v.pane.el, "fl-box")[2].dispatch("click");
    assert.equal(byClass(v.pane.el, "fl-detail").length, 0, "folded");
  });

  // (fails before: yes — L47 cases 10, 11; the pane is built again only when what it shows changes)
  test("past 12 steps the earlier fold under one press; with nothing sent, words that say what will show; the same picture is not built again", () => {
    const many = Array.from({ length: STEPS_SHOWN + 3 }, (_, i) => thread(`a${i}`, `Agent${i}`, [ask(1000 - i * 10, 995 - i * 10, sent("turn-1", i + 1))]));
    const v = paneOf(many);
    assert.equal(byClass(v.pane.el, "fl-step").length, STEPS_SHOWN);
    const earlier = byClass(v.pane.el, "fl-earlier")[0];
    assert.match(textOf(earlier), /^Earlier steps · 3/);
    earlier.dispatch("click");
    assert.equal(byClass(v.pane.el, "fl-step").length, STEPS_SHOWN + 3);
    const card = v.pane.el.kids[0];
    v.pane.paint(v.chat);
    assert.equal(v.pane.el.kids[0], card, "nothing moved: the same nodes");
    v.set([]);
    v.pane.paint(v.chat);
    assert.match(textOf(v.pane.el), /^Your agent has sent no agent of its own in this chat yet\./);
    assert.equal(v.pane.row(), null);
  });
});

describe("the Agents tab's foot row", () => {
  /** @param {string | null} work @param {string[]} painted */
  const viewOf = (work, painted) => {
    const io = sideIO({ rows: () => [], own: () => [], teams: { el: fakeH("div", { class: "tv-fake" }), items: () => [], paint: (/** @type {any} */ _c, /** @type {string} */ id) => painted.push(id), home: () => true, work: () => work } });
    const s = sideSeams();
    const view = createSideView(/** @type {any} */ (io), { h: fakeH, place: (p, k) => p.replaceChildren(...k), ...s.seams });
    view.paint(/** @type {any} */ ({ id: "chat-1", chainId: "c1", turns: [] }));
    return view;
  };
  /** @param {any} n @param {(x: any) => boolean} pred @returns {any} */
  const find = (n, pred) => {
    if (!n || typeof n !== "object") return null;
    if (pred(n)) return n;
    for (const k of n.kids || []) {
      const r = find(k, pred);
      if (r) return r;
    }
    return null;
  };

  // (fails before: yes — L47-D3: no row opened your agent's own work)
  test("while your agent sent any, a row at the foot opens its picture in the pane; with none, no row", () => {
    /** @type {string[]} */
    const painted = [];
    const view = viewOf("3 agents in 2 steps", painted);
    const row = find(view.el, (x) => x.attrs?.["data-id"] === WORK_ITEM);
    assert.ok(row, "the row");
    assert.match(textOf(row), new RegExp(`^${WORK_ROW}\\|as a flow\\|3 agents in 2 steps$`));
    row.dispatch("click");
    assert.equal(painted.at(-1), WORK_ITEM, "its pane is the picture");
    assert.equal(find(viewOf(null, []).el, (x) => x.attrs?.["data-id"] === WORK_ITEM), null);
  });
});
