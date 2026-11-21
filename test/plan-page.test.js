// @ts-check
// The Plan page as one page (HarnessV4_TaskGraphPlus_Design, E41 P4; the owner's words of 10-25: "the Plan Page could
// itself don't need three tabs. Raw does not need to be shown … The Checklist Tab itself can be probably moved into
// single page"): the graph, or the checklist the agent keeps now with an older graph a press away; the width rule
// (D15) — the card beside the canvas or under it — the room the page's whole width, one workspace the window's height
// (the owner's of 11-10); one drawing in any room, a
// canvas that zooms (Fit, − and +, kept per chat) and pans, a hunt box that folds (the Product agent's redesign of
// 11-05, the owner's yes); beside the chat (D12, D14) the steps down a rail, no card until one is chosen; the finished
// steps folded (D16); a card's More; Copy plan, Beside the chat and Run them side by side (case 19); and what the
// Hunters of p4b and p4c found: a page off screen that drew on, an answer heard by the newest page alone, a card lost to
// the fold, an empty card column, a task named "fold". On the fake DOM; the layout's numbers are graph-boxes.test.js's.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyTasks, graphView, launched, slotWaited, taskEnded } from "../src/core/task-graph.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { FOLD } from "../src/ui/harness/lib/graph-lanes.js";
import { BOX, boxesOf } from "../src/ui/harness/lib/graph-boxes.js";
import { drawGraph, layoutOf, lightLines, linesSvg, planText, rearrangeWords, zoomOf, zoomStep } from "../src/ui/harness/views/task-graph.js";
import { renderPlan } from "../src/ui/harness/views/plan.js";
import { fakeH, textOf, buttonsOf } from "./helpers/fake-dom.js";

const T0 = 1_000_000;
const NOW = T0 + 320_700;
const settle = () => new Promise((r) => setImmediate(r));

/** The graph after these calls, each at its own time, as the view draws it. @param {[any, number][]} calls @returns {any} */
function viewAfter(calls) {
  /** @type {any} */
  let g = null;
  for (const [input, at] of calls) {
    const r = /** @type {any} */ (applyTasks(g, input, { at, crew: "agent" }));
    assert.ok(r.ok, r.error);
    g = r.graph;
  }
  return graphView(g);
}
/** The parser's graph: t1 done, t2 running, t3 ready, t4 waiting on both. */
const RUN = /** @type {[any, number][]} */ ([
  [{ action: "add", goal: "Ship the parser", tasks: [
    { id: "t1", name: "Lexer", writes: ["src/lex.js"] },
    { id: "t2", name: "Parser", needs: ["t1"], writes: ["src/parse.js"] },
    { id: "t3", name: "Docs", needs: ["t1"] },
    { id: "t4", name: "Release", needs: ["t2", "t3"] },
  ] }, T0],
  [{ action: "start", id: "t1" }, T0 + 60_000],
  [{ action: "done", id: "t1", summary: "Lexer with 40 tests" }, T0 + 180_000],
  [{ action: "start", id: "t2" }, T0 + 200_000],
]);
/** A task and `n` tasks that need it: a step `n` boxes wide under it. @param {number} n */
const fork = (n) => viewAfter([[{ action: "add", goal: "Fork", tasks: [{ id: "r", name: "Root" }, ...Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, name: `Part ${i + 1}`, needs: ["r"] }))] }, T0]]);
/**
 * An 80-task graph: three parts of needs of their own and tasks on their own, the first part's first ten done.
 * @returns {any}
 */
const eighty = () => {
  /** @type {any[]} */
  const tasks = [];
  for (let i = 0; i < 30; i++) tasks.push({ id: `w${i}`, name: `Wide ${i}`, ...(i ? { needs: [`w${Math.floor((i - 1) / 3)}`, ...(i > 6 && i % 4 === 0 ? [`w${i - 5}`] : [])] } : {}) });
  for (let i = 0; i < 20; i++) tasks.push({ id: `f${i}`, name: `Fan ${i}`, ...(i === 0 ? {} : i === 19 ? { needs: Array.from({ length: 18 }, (_, k) => `f${k + 1}`) } : { needs: ["f0"] }) });
  for (let i = 0; i < 14; i++) tasks.push({ id: `c${i}`, name: `Chain ${i}`, ...(i ? { needs: [`c${i - 1}`] } : {}) });
  for (let i = 0; i < 16; i++) tasks.push({ id: `s${i}`, name: `Solo ${i}` });
  return viewAfter([
    [{ action: "add", goal: "Eighty", tasks }, T0],
    ...Array.from({ length: 10 }, (_, i) => /** @type {[any, number][]} */ ([[{ action: "start", id: `w${i}` }, T0 + i * 1000 + 100], [{ action: "done", id: `w${i}`, summary: `Did ${i}` }, T0 + i * 1000 + 500]])).flat(),
  ]);
};
/** A chain t1 → … → t5, the first four done: three finished steps fold (D16). */
const CHAIN = viewAfter([
  [{ action: "add", goal: "Chain", tasks: [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, name: `Step ${i}`, ...(i > 1 ? { needs: [`t${i - 1}`] } : {}) })) }, T0],
  ...[1, 2, 3, 4].flatMap((i) => /** @type {[any, number][]} */ ([[{ action: "start", id: `t${i}` }, T0 + i * 10_000], [{ action: "done", id: `t${i}`, summary: `Did ${i}` }, T0 + i * 10_000 + 5000]])),
  [{ action: "start", id: "t5" }, T0 + 60_000],
]);

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
/** A task's box, wide or narrow. @param {any} el @param {string} id */
const boxOf = (el, id) => all(el, (x) => x.attrs?.["data-id"] === id)[0];
/** A button by its words. @param {any} n @param {string} words */
const press = (n, words) => buttonsOf(n).find((b) => textOf(b) === words);
/** A turn whose run carried these events. @param {any[]} events */
const turnWith = (events) => ({ n: 1, status: "done", aligned: alignEvents(events) });
/** A chat of the page's: its session and its turns. @param {string} id @param {any[]} turns */
const chatOf = (id, turns = []) => ({ id, chainId: `chain-${id}`, title: id, turns, live: null, view: { settings: {} } });
/** A graph event and a checklist event, in this order. @param {any} graph @param {string[]} [items] */
const events = (graph, items) => [
  ...(graph ? [{ n: 1, type: "graph", round: 1, graph }] : []),
  ...(items ? [{ n: 2, type: "plan", round: 2, items: items.map((text) => ({ text, status: "doing" })) }] : []),
];
/** The page's `h`, its scroller as wide as `width.px` says. @param {{ px: number }} width @returns {any} */
const sizedH = (width) => (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
  const n = fakeH(tag, attrs, ...kids);
  if (attrs?.class === "pv-scroll") Object.defineProperty(n, "clientWidth", { get: () => width.px });
  return n;
};
/** Draw the page for a chat. @param {any} chat @param {Record<string, any>} [ctx] @param {Record<string, any>} [o] */
const page = (chat, ctx = {}, o = {}) => {
  const body = fakeH("div");
  const view = renderPlan(body, { chat, ...ctx }, { h: fakeH, api: async () => null, now: () => NOW, ...o });
  return { body, view };
};

describe("the Plan page: one page", () => {
  // (fails before: yes — the Hunter of p4c: a closed graph from before drew over the checklist the agent keeps now,
  // while the tab's badge counted that checklist)
  test("the checklist the agent keeps now, over a graph from before: Show the graph and Back to the checklist; planning on the graph again forgets the press", async () => {
    const closed = viewAfter([...RUN, [{ action: "close", reason: "Shipped" }, T0 + 300_000]]);
    const chat = chatOf("older", [turnWith(events(closed, ["Write the notes"]))]);
    const { body, view } = page(chat);
    await settle();
    assert.match(textOf(one(body, "pv-column")), /^Checklist\|0 of 1 done\|Write the notes\|between turns\|/);
    assert.equal(textOf(one(body, "pv-other")), "The session's task graph is from before: 1 of 1 done, closed. |Show the graph");
    press(body, "Show the graph")?.dispatch("click");
    assert.equal(byClass(body, "pv-column").length, 0);
    assert.equal(textOf(one(body, "pv-back")), "The agent keeps a checklist now; the task graph is from before. |Back to the checklist");
    assert.match(textOf(one(body, "tg-closed")), /^Closed\| — Shipped$/);
    press(body, "Back to the checklist")?.dispatch("click");
    assert.ok(one(body, "pv-column"), "back to the checklist");
    // Pressed again, then the agent plans on the graph: the press has served — a checklist after that shows first.
    press(body, "Show the graph")?.dispatch("click");
    chat.turns.push(turnWith(events(viewAfter(RUN))));
    view.paint();
    assert.equal(byClass(body, "pv-back").length, 0, "the graph is its newest plan: no line of an older one");
    chat.turns.push(turnWith(events(null, ["Tidy up"])));
    view.paint();
    assert.match(textOf(one(body, "pv-column")), /^Checklist\|0 of 1 done\|Tidy up\|/);
  });

  // (fails before: yes — the Hunter of p4c: the room was the scroller's whole width, past the graph's widest; the
  // Product agent's redesign of 11-05: the canvas zooms and pans to the room it is given, so the card's place is the
  // room's alone)
  // (fails before: yes — the owner's of 11-10, "the left canvas of the graph size is not great": the room stopped at
  // 1400 px however wide the window, the canvas drawn smaller than it had room for)
  test("the width rule (D15): the card beside the canvas where the room holds the card and a canvas worth the name, else under it; the room the scroller's whole width; another placing draws again", () => {
    const width = { px: 1640 };
    const chat = chatOf("wide", [turnWith(events(fork(5)))]);
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: sizedH(width), api: async () => null, now: () => NOW });
    // A step five boxes wide, 1384 px drawn. No card opens by itself (the owner's of 11-11): the canvas has the
    // scroller's 1600, less its frame — 1598: all of it at 100%.
    assert.deepEqual([one(body, "tg-body").attrs.class, one(body, "tg-body").kids.map((/** @type {any} */ k) => k.attrs.class), textOf(one(body, "tg-zoom-v"))], ["tg-body is-under", ["tg-graph"], "100%"]);
    // A task pressed: its card beside it all the same, the canvas fitting it in what the card leaves — 1196: 86% (it
    // stopped at 1400 before, 996: 71%).
    boxOf(body, "a1").dispatch("click");
    assert.equal(one(body, "tg-body").attrs.class, "tg-body is-beside");
    assert.deepEqual(one(body, "tg-body").kids.map((/** @type {any} */ k) => k.attrs.class), ["tg-graph", "tg-card"]);
    assert.equal(textOf(one(body, "tg-zoom-v")), "86%");
    // Narrower: under, the same boxes; drawn again as the room changes.
    width.px = 700;
    view.paint();
    assert.equal(one(body, "tg-body").attrs.class, "tg-body is-under");
    assert.equal(byClass(body, "tg-node").length, 6, "the same boxes");
    // The rule itself: the card's 402 beside a canvas of 360 at least; a width not measured: under.
    assert.deepEqual([layoutOf(762), layoutOf(761), layoutOf(0), layoutOf(null)], ["beside", "under", "under", "under"]);
  });

  // (fails before: yes — the owner's of 11-10: the canvas was as tall as its drawing, a strip over an empty page or
  // running past the window, and the card beside it scrolled the canvas away)
  test("the graph's page is one workspace the window's height; the checklist, the empty page and the rail beside the chat scroll as before", async () => {
    const graph = page(chatOf("ws", [turnWith(events(viewAfter(RUN)))]));
    assert.equal(one(graph.body, "pv-inner").attrs.class, "pv-inner is-workspace");
    const list = page(chatOf("ws-list", [turnWith(events(null, ["Write the notes"]))]));
    await settle();
    assert.equal(one(list.body, "pv-inner").attrs.class, "pv-inner");
    const pane = page(chatOf("ws-pane", [turnWith(events(viewAfter(RUN)))]), { pane: true });
    assert.equal(one(pane.body, "pv-inner").attrs.class, "pv-inner");
    const empty = page(chatOf("ws-none"));
    await settle();
    assert.equal(one(empty.body, "pv-inner").attrs.class, "pv-inner");
    // Back to the checklist from the graph: the class goes with the graph.
    const chat = chatOf("ws-back", [turnWith(events(viewAfter(RUN)))]);
    const back = page(chat);
    chat.turns.push(turnWith(events(null, ["Tidy up"])));
    back.view.paint();
    assert.equal(one(back.body, "pv-inner").attrs.class, "pv-inner");
    // Its CSS: the inner box at least the scroller's height, the body growing into what the head leaves, a canvas worth
    // the name at least; beside the card, one row the body's height, the card and the canvas stretched to it.
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const rule = (/** @type {string} */ sel) => (new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")} \\{([^}]*)\\}`).exec(css) || [])[1] || "";
    assert.match(rule(".pv-inner.is-workspace"), /min-height: 100%;.*display: flex; flex-direction: column;/);
    assert.match(rule(".pv-inner.is-workspace > .tg-view > .tg-body.is-beside"), /flex: 1 1 0; min-height: 440px; grid-template-rows: minmax\(0, 1fr\); align-items: stretch;/);
    assert.doesNotMatch(css, /max-width: 1400px/, "no cap on the graph's width");
    // Beside the canvas the card is its inspector, 380 px: as tall as the canvas, scrolling itself, its title row held at
    // its top (the review of 67038d835's test below) — no longer a sticky card in the page's scroll, taller than the window.
    assert.match(rule(".tg-body.is-beside"), /grid-template-columns: minmax\(0, 1fr\) 380px;/);
    assert.match(rule(".pv-inner.is-workspace .tg-body.is-beside > .tg-card"), /display: flex; flex-direction: column; min-height: 0; overflow-y: auto;/);
    assert.match(rule(".pv-inner.is-workspace .tg-body.is-beside > .tg-card > .tg-card-head > .tg-card-title"), /position: sticky; top: 0;/);
    assert.match(rule(".pv-inner.is-workspace .tg-body.is-beside > .tg-card > .tg-card-foot"), /margin-top: auto;/, "Hunt for bugs at the inspector's foot");
    // (fails before: yes — the review of d5aa58d31: held on a short window, the hunt's words and Hunters left the parts a
    // sliver) Held in sight only on a card that leaves the parts room (the review of 67038d835: not the window).
    assert.match(css, /\n@container inspector \(min-height: 600px\) \{\n {2}\.pv-inner\.is-workspace \.tg-body\.is-beside > \.tg-card > \.tg-card-foot \{ position: sticky; bottom: 0;/);
    assert.doesNotMatch(rule(".pv-inner.is-workspace .tg-body.is-beside > .tg-card > .tg-card-foot"), /sticky/);
    // (fails before: yes — the same review: the workspace's rule grew the line back to the checklist over an older graph)
    assert.match(css, /\n\.pv-inner\.is-workspace > \.tg-view:not\(\.pv-back\) \{ flex: 1 1 auto;/);
    assert.equal(rule(".pv-inner.is-workspace > .tg-view"), "");
    // (fails before: yes — the same review: on a phone a swipe on the canvas never reached the page past its end)
    assert.match(rule(".tg-canvas-view"), /overscroll-behavior-x: contain;/);
    assert.equal(rule(".tg-body.is-beside > .tg-card"), "", "no sticky card in the page's scroll");
  });

  // (fails before: yes — the owner's of 11-10, "the right panel which shows details is messed up": a hairline a part,
  // the done-when's words grey, its evidence under a shouting caption, Hunt for bugs broken over two lines in its row,
  // and the gap a failure or a stop leaves before its report's rows drawn by rules that matched nothing)
  test("the inspector reads as one: its head on a hairline, its parts apart by their room, one label for each, the evidence a quote, Hunt for bugs headed as every part", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const rule = (/** @type {string} */ sel) => (new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\>~:,]/g, "\\$&")} \\{([^}]*)\\}`).exec(css) || [])[1] || "";
    assert.match(rule(".tg-card-head"), /border-bottom: 1px solid var\(--inst-sep\);/);
    assert.match(rule(".tg-card-head ~ .tg-sec"), /border-top: 0;/, "no hairline between its parts");
    assert.match(rule(".tg-sec"), /border-top: 1px solid var\(--inst-sep\);/, "the kept card's and the foot's hairline stay");
    assert.equal(rule(".tg-card-text.is-q"), "", "what it is to be done when, read as the rest");
    assert.doesNotMatch(rule(".tg-well-who"), /uppercase|letter-spacing/);
    assert.match(rule(".tg-well"), /box-shadow: inset 2px 0 0 var\(--inst-label-3\);/, "a quote, its bar on the left");
    assert.doesNotMatch(rule(".tg-well"), /background/);
    assert.match(rule(".tg-kv dt"), /font-size: var\(--text-ui-xs\); font-weight: 600; color: var\(--inst-label-2\);/, "a row's name as a part's");
    assert.match(rule(".tg-sec-h"), /font-size: var\(--text-ui-xs\); font-weight: 600; color: var\(--inst-label-2\);/);
    for (const dead of [".tg-card > .ix-error + .tg-kv", ".tg-card > .tg-card-text + .tg-kv", ".tg-card > .tg-card-stopped + .tg-kv", ".tg-hunt-t"]) assert.equal(rule(dead), "", dead);
    assert.match(rule(".tg-sec > :is(.ix-error, .tg-card-text, .tg-card-stopped) + .tg-kv"), /margin-top: 10px;/);
    assert.match(rule(".tg-hunt-acts .tg-act"), /margin-left: auto;/, "the chip, then Hunt bugs at the row's end");
  });

  // (fails before: yes — at seven lanes or more, and in any room under about 210 px a lane, the graph drew a row a task
  // with its lines in a gutter of staggered lanes; then islands of boxes, each wrapped to its room, a heading over each)
  test("an 80-task graph is one drawing in any room: on the Plan tab one canvas, a row a step; beside the chat a rail, a line a task", () => {
    const v = eighty();
    const lay = boxesOf(v.tasks);
    for (const o of [{ width: 1400 }, { width: 300 }]) {
      const g = drawGraph(v, { h: fakeH, now: NOW, ...o });
      assert.deepEqual([byClass(g.el, "tg-isle").length, byClass(g.el, "tg-isle-head").length, byClass(g.el, "tg-canvas").length], [0, 0, 1], JSON.stringify(o));
      const boxes = byClass(g.el, "tg-node");
      assert.equal(boxes.length + lay.hidden.length, 80, "every task a box, or in the fold");
      for (const b of boxes) assert.match(b.attrs.style, /^left:\d+(\.5)?px;top:\d+px;width:\d+px;height:\d+px$/);
      assert.equal(new Set(boxes.map((b) => /top:(\d+)px/.exec(b.attrs.style)?.[1])).size, lay.rows.length, "a row a step, none wrapped");
      assert.equal(byClass(g.el, "tg-edges").length, 1, "the lines one picture, under the boxes");
    }
    const rail = drawGraph(v, { h: fakeH, now: NOW, width: 300, pane: true }).el;
    assert.deepEqual([byClass(rail, "tg-canvas").length, byClass(rail, "tg-zoom").length, byClass(rail, "tg-st").length], [0, 0, lay.rows.length]);
    assert.equal(byClass(rail, "tg-node").length + lay.hidden.length, 80);
  });

  // (fails before: yes — a graph wider than its room wrapped its steps into rows, or scrolled each island apart; the
  // redesign of 11-05: one canvas that zooms; the drive of 11-05: a graph six tasks wide opened at 38%, its words
  // unreadable)
  test("the zoom: the canvas opens fitted no smaller than its words read, the rest panned to; Fit draws a wide graph whole, never past 100%; − and + are the person's, kept for the chat, and Fit too", () => {
    const width = { px: 740 };
    const chat = chatOf("zoom", [turnWith(events(fork(5)))]);
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: sizedH(width), api: async () => null, now: () => NOW });
    const zoomed = (/** @type {any} */ b) => [textOf(one(b, "tg-zoom-v")), one(b, "tg-zoom-fit").attrs["aria-pressed"], one(b, "tg-canvas").attrs.style, one(b, "tg-canvas-size").attrs.style];
    // 698 px of room, the card under: the 1384 px graph whole would be 50%; it opens at 80%, wider than its room.
    assert.deepEqual(zoomed(body), ["80%", "false", "width:1384px;height:192px;--tg-h:52px;--tg-strip:30px;transform:scale(0.8)", "width:1108px;height:154px"]);
    press(body, "Fit")?.dispatch("click");
    assert.deepEqual(zoomed(body), ["50%", "true", "width:1384px;height:192px;--tg-h:52px;--tg-strip:30px;transform:scale(0.5)", "width:692px;height:96px"]);
    buttonsOf(body).find((b) => b.attrs["aria-label"] === "Zoom in")?.dispatch("click");
    assert.deepEqual(zoomed(body).slice(0, 2), ["60%", "false"], "the next step up from Fit's");
    assert.deepEqual(zoomed(page(chat).body).slice(0, 2), ["60%", "false"], "kept for the chat");
    press(body, "Fit")?.dispatch("click");
    assert.deepEqual(zoomed(body).slice(0, 2), ["50%", "true"]);
    assert.deepEqual(zoomed(page(chat, {}, { h: sizedH(width) }).body).slice(0, 2), ["50%", "true"], "Fit kept for the chat");
    // A graph narrower than its room: 100%, never past it, its drawing unscaled — whole as it opens, so Fit is on.
    const small = page(chatOf("small", [turnWith(events(fork(2)))]), {}, { h: sizedH(width) }).body;
    assert.deepEqual(zoomed(small).slice(0, 3), ["100%", "true", "width:556px;height:192px;--tg-h:52px;--tg-strip:30px"]);
    // The rule: the person's within its bounds; Fit the whole drawing in the room; as it opens, Fit no smaller than
    // 80%; the steps snap to tenths.
    assert.deepEqual(
      [zoomOf(null, 2000, 1000), zoomOf("fit", 2000, 1000), zoomOf(null, 1100, 1000), zoomOf(null, 500, 1000), zoomOf("fit", 500, 1000), zoomOf(null, 2000, 0), zoomOf("fit", 1e6, 10), zoomOf(2, 1, 1), zoomOf(0.1, 1, 1)],
      [0.8, 0.5, 0.9, 1, 1, 1, 0.25, 1.5, 0.25],
    );
    assert.deepEqual([zoomStep(0.55, 1), zoomStep(0.55, -1), zoomStep(0.6, 1), zoomStep(1.5, 1), zoomStep(0.25, -1), zoomStep(0.25, 1)], [0.6, 0.5, 0.7, 1.5, 0.25, 0.3]);
  });

  // (fails before: yes — the owner's of 11-10: a box's name had what its id and its fact left of one line, cut at a
  // few words — "Before s…", "Clean…")
  test("on the canvas a task reads on two lines: its mark, its name the whole first line, its id and fact under it; the rail keeps one line", () => {
    assert.deepEqual([BOX.w, BOX.h], [248, 52]);
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const rule = (/** @type {string} */ sel) => (new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")} \\{([^}]*)\\}`).exec(css) || [])[1] || "";
    assert.match(rule(".tg-canvas .tg-node"), /display: grid; grid-template-columns: 15px auto minmax\(0, 1fr\) auto;/);
    assert.match(rule(".tg-canvas .tg-node > .tg-node-name"), /grid-row: 1; grid-column: 2 \/ -1;/);
    assert.match(rule(".tg-canvas .tg-node > .tg-node-id"), /grid-row: 2; grid-column: 2;/);
    assert.match(rule(".tg-canvas .tg-node > .tg-node-fact"), /grid-row: 2; grid-column: 3;/);
    // Its spans as they were: the rail and the tests read them the same.
    const g = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, width: 1400 });
    assert.deepEqual(boxOf(g.el, "t1").kids.filter((/** @type {any} */ k) => k && typeof k === "object").map((/** @type {any} */ k) => String(k.attrs.class).split(" ")[0]), ["tg-mark", "tg-node-id", "tg-node-name", "tg-node-fact"]);
    assert.match(boxOf(g.el, "t1").attrs.style, /width:248px;height:52px$/);
  });

  // (fails before: yes — the owner's of 11-10: Fit fitted the width alone, so a tall graph ran past the canvas's foot
  // with Fit pressed; the canvas's height was never asked)
  test("Fit both ways: the canvas's height as laid out, measured after the draw and kept for the chat; a height that moves Fit draws once more; Still open opened asks again", () => {
    const width = { px: 1640 };
    const tall = { px: 100 };
    /** The page's `h`, the canvas's scroller as tall as `tall.px` says. @type {any} */
    const laidH = (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = sizedH(width)(tag, attrs, ...kids);
      if (attrs?.class === "tg-canvas-view") Object.defineProperty(n, "clientHeight", { get: () => tall.px });
      return n;
    };
    const chat = chatOf("fit-down", [turnWith(events(fork(5)))]);
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: laidH, api: async () => null, now: () => NOW });
    // 1384 × 192 drawn, 1598 px of room across — no card open — and 100 down: as it opens, no smaller than its words read
    // (80%, where the width alone said 100%); Fit the whole of it, 52%.
    assert.equal(textOf(one(body, "tg-zoom-v")), "80%");
    press(body, "Fit")?.dispatch("click");
    assert.equal(textOf(one(body, "tg-zoom-v")), "52%");
    // Kept for the chat: the page opened again draws to the height at once.
    const again = fakeH("div");
    renderPlan(again, { chat }, { h: laidH, api: async () => null, now: () => NOW });
    assert.equal(textOf(one(again, "tg-zoom-v")), "52%");
    // A task pressed, its card beside the canvas: 1196 px across, the height the tighter still. The canvas taller (Still
    // open folded, the window grown): asked again, Fit follows — the width the tighter now.
    boxOf(body, "a1").dispatch("click");
    assert.equal(textOf(one(body, "tg-zoom-v")), "52%");
    tall.px = 400;
    view.paint();
    assert.equal(textOf(one(body, "tg-zoom-v")), "86%");
    // The rule, both ways: the tighter way wins; a height unknown bounds nothing.
    assert.deepEqual(
      [zoomOf("fit", { w: 800, h: 1200 }, { w: 1000, h: 600 }), zoomOf(null, { w: 800, h: 1200 }, { w: 1000, h: 600 }), zoomOf("fit", { w: 2000, h: 300 }, { w: 1000, h: null }), zoomOf("fit", { w: 500, h: 300 }, { w: 1000, h: 600 }), zoomOf(null, { w: 900, h: 700 }, { w: 1000, h: 630 })],
      [0.5, 0.8, 0.5, 1, 0.9],
    );
  });

  // (fails before: yes — nothing held a hunt's fixes, nor folded them away once done)
  test("a hunt box with nothing open in it folds to one strip; opened, it stays so for the chat; its chevron folds it again", () => {
    const v = viewAfter([
      [{ action: "add", goal: "Hunted", tasks: [{ id: "a", name: "Alpha" }, { id: "f", name: "Fix it", needs: ["a"] }, { id: "b", name: "Beta", needs: ["a"] }] }, T0],
      [{ action: "start", id: "a" }, T0 + 1000], [{ action: "done", id: "a", summary: "A" }, T0 + 2000],
      [{ action: "start", id: "f" }, T0 + 3000], [{ action: "done", id: "f", summary: "F" }, T0 + 4000],
    ]);
    // f is a hunt's finding on a, as the core marks one (hunt-found.test.js).
    const hunted = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "f" ? { ...t, foundBy: { agent: "sa_1", name: "Reviewer", task: "a" } } : t)) };
    const chat = chatOf("hunted", [turnWith(events(hunted))]);
    const { body } = page(chat);
    const strip = one(body, "tg-hunt-strip");
    assert.deepEqual([strip.tag, strip.attrs["aria-expanded"], textOf(strip)], ["button", "false", "Hunted · 1 fixed"]);
    assert.equal(boxOf(body, "f"), undefined, "folded into its strip");
    strip.dispatch("click");
    assert.ok(boxOf(body, "f"), "opened");
    assert.equal(textOf(one(body, "tg-hunt-strip")), "Reviewer's hunt · 1 fix · 1 done");
    assert.ok(boxOf(page(chat).body, "f"), "kept for the chat");
    buttonsOf(body).find((b) => b.attrs.class === "tg-hunt-fold")?.dispatch("click");
    assert.equal(boxOf(body, "f"), undefined, "folded again");
    // (fails before: yes — the review of 11-05: a fix chosen held its box open, the chevron did nothing, and a second
    // press opened it for good) Folded with a fix in it chosen: it folds, and the choice is let go.
    one(body, "tg-hunt-strip").dispatch("click");
    boxOf(body, "f").dispatch("click");
    assert.match(textOf(one(body, "tg-card")), /^f\|Fix it\|done\|/);
    buttonsOf(body).find((b) => b.attrs.class === "tg-hunt-fold")?.dispatch("click");
    assert.equal(boxOf(body, "f"), undefined, "folded with its fix chosen");
    assert.doesNotMatch(textOf(one(body, "tg-card")), /^f\|/, "the fix's choice let go");
    assert.deepEqual([one(body, "tg-hunt-strip").attrs["aria-expanded"], boxOf(page(chat).body, "f")], ["false", undefined], "folded for the chat");
  });

  // (fails before: yes — the boxes were drawn anew at each pulse of a run: a graph scrolled sideways went back; the
  // owner's of 11-02: kept from another drawing, the scroll opened it cut at its left)
  test("the canvas panned stays where it was left across draws at one zoom; at another it opens at its start", () => {
    let clock = NOW;
    const width = { px: 400 };
    const chat = chatOf("slid", [turnWith(events(fork(3)))]);
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: sizedH(width), api: async () => null, now: () => clock });
    const zoomIn = () => buttonsOf(body).find((b) => b.attrs["aria-label"] === "Zoom in")?.dispatch("click");
    zoomIn();
    const scroller = one(body, "tg-canvas-view");
    assert.equal(scroller.scrollLeft, 0, "it opens at its start");
    scroller.scrollLeft = 40;
    scroller.dispatch("scroll");
    // A minute on, the time words move: the page draws anew.
    clock += 60_000;
    view.paint();
    const again = one(body, "tg-canvas-view");
    assert.notEqual(again, scroller, "drawn anew");
    assert.equal(again.scrollLeft, 40);
    // Another zoom — Fit's —: its start again (− and + keep its middle: the review of 67038d835's test below).
    press(body, "Fit")?.dispatch("click");
    assert.equal(one(body, "tg-canvas-view").scrollLeft, 0);
  });

  // (fails before: yes — the owner's of 11-07: "the hand gesture shows but pressing a moving doesn't do anything …
  // zoom in and out with scroller" — the canvas drawn anew at each step of a task at work left a drag on one gone, the
  // page never moved up or down, and the wheel zoomed nothing)
  test("the canvas moved by hand: a press and a move pan it both ways, a draw asked meanwhile waits for the drag's end and keeps where it was left; the wheel zooms it about the pointer, kept for the chat", () => {
    let clock = NOW;
    const width = { px: 400 };
    /** The page's `h`, each node laid out at the page's top left. @type {any} */
    const laidH = (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = sizedH(width)(tag, attrs, ...kids);
      n.getBoundingClientRect = () => ({ left: 0, top: 0, width: width.px, height: 600 });
      return n;
    };
    /** @type {Record<string, Set<Function>>} */
    const heard = {};
    /** @type {Function[]} */
    const frames = [];
    const win = {
      addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => void (heard[t] ||= new Set()).add(f),
      removeEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => void heard[t]?.delete(f),
      requestAnimationFrame: (/** @type {Function} */ f) => void frames.push(f),
    };
    const fire = (/** @type {string} */ t, /** @type {any} */ e) => [...(heard[t] || [])].forEach((f) => f(e));
    const chat = chatOf("by-hand", [turnWith(events(fork(12)))]);
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: laidH, api: async () => null, now: () => clock, win });
    const scroll = one(body, "pv-scroll");
    const canvas = () => one(body, "tg-canvas-view");
    const first = canvas();
    // A press on a task in it: its target is inside the canvas drawn now.
    const onIt = { closest: (/** @type {string} */ sel) => (sel === ".tg-canvas-view" ? canvas() : null) };
    scroll.dispatch("pointerdown", { button: 0, pointerId: 7, clientX: 300, clientY: 300, target: onIt });
    fire("pointermove", { pointerId: 7, clientX: 240, clientY: 260 });
    // Both ways in the canvas's own scroller, the page left where it is (the owner's of 11-10).
    assert.deepEqual([first.scrollLeft, first.scrollTop, scroll.scrollTop], [60, 40, 0], "sideways and down");
    // A minute on, the time words move: the draw waits for the drag.
    clock += 60_000;
    view.paint();
    assert.equal(canvas(), first, "not drawn anew mid-drag");
    fire("pointermove", { pointerId: 7, clientX: 200, clientY: 250 });
    fire("pointerup", { pointerId: 7 });
    assert.notEqual(canvas(), first, "drawn once the drag ended");
    assert.deepEqual([canvas().scrollLeft, canvas().scrollTop, scroll.scrollTop], [100, 50, 0], "where the drag left it");
    // The wheel over it, toward you: zoomed in about the pointer, the bar saying so, kept for the chat.
    const zoomWords = () => textOf(one(body, "tg-zoom-v"));
    const was = zoomWords();
    let prevented = false;
    scroll.dispatch("wheel", { deltaY: -100, deltaMode: 0, clientX: 200, clientY: 200, target: onIt, preventDefault: () => void (prevented = true) });
    assert.ok(prevented, "the page does not scroll under it");
    frames.splice(0).forEach((f) => f());
    assert.ok(Number.parseInt(zoomWords(), 10) > Number.parseInt(was, 10), `${was} → ${zoomWords()}`);
    assert.equal(textOf(one(page(chat).body, "tg-zoom-v")), zoomWords(), "kept for the chat");
  });

  // (fails before: yes — the review of 25e25a0e8: beside the chat, where the graph is a rail with no canvas, every wheel
  // of the page's scroller still waited on a listener that may cancel it)
  test("beside the chat the graph has no canvas: its scroller's wheel waits on no listener", () => {
    /** @type {{ type: string, opts: any }[]} */
    const listened = [];
    /** @type {any} */
    const heardH = (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = fakeH(tag, attrs, ...kids);
      if (String(attrs?.class || "").split(/\s+/).includes("pv-scroll")) {
        const add = n.addEventListener;
        n.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn, /** @type {any} */ opts) => (listened.push({ type, opts }), add(type, fn));
      }
      return n;
    };
    const chat = chatOf("beside", [turnWith(events(fork(3)))]);
    renderPlan(fakeH("div"), { chat, pane: true }, { h: heardH, api: async () => null, now: () => NOW });
    assert.ok(listened.some((l) => l.type === "wheel"), "its own: the wheel is a hand's move");
    assert.deepEqual(listened.filter((l) => l.type === "wheel" && !l.opts?.passive), []);
    listened.length = 0;
    renderPlan(fakeH("div"), { chat }, { h: heardH, api: async () => null, now: () => NOW });
    assert.equal(listened.filter((l) => l.type === "wheel" && l.opts?.passive === false).length, 1, "the Plan tab's canvas: one");
  });

  // (fails before: yes — one row a layer: the docs site's island was 3208 px wide in a Plan tab of 1111)
  test("the docs site on the Plan tab at 1111 px: its step of twelve opens where its words read, the rest a pan away; Fit draws it at its least, never wrapped; beside the chat at 420, a line a task down the rail", () => {
    const docs = viewAfter([[{ action: "add", goal: "Docs", tasks: [
      { id: "d1", name: "Pick the site generator" },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `d${i + 2}`, name: `Page ${i + 1}`, needs: ["d1"] })),
      { id: "d14", name: "Search index", needs: Array.from({ length: 12 }, (_, i) => `d${i + 2}`) },
    ] }, T0]]);
    const g = drawGraph(docs, { h: fakeH, now: NOW, width: 1111 });
    assert.equal(g.mode, "beside");
    // Twelve side by side are 3316 px, in the 707 the card leaves: as it opens, 80%, the rest a pan away; Fit at its
    // least, 25%, and one row still.
    assert.match(one(g.el, "tg-canvas").attrs.style, /^width:3316px;.*;transform:scale\(0\.8\)$/);
    const fit = drawGraph(docs, { h: fakeH, now: NOW, width: 1111, zoom: { z: "fit", set: () => {} } }).el;
    assert.match(one(fit, "tg-canvas").attrs.style, /^width:3316px;.*;transform:scale\(0\.25\)$/);
    assert.equal(one(fit, "tg-canvas-size").attrs.style.split(";")[0], `width:${Math.ceil(3316 * 0.25)}px`);
    assert.equal(new Set(byClass(g.el, "tg-node").map((b) => /top:(\d+)px/.exec(b.attrs.style)?.[1])).size, 3, "three steps, three rows");
    const rail = drawGraph(docs, { h: fakeH, now: NOW, width: 420, pane: true }).el;
    assert.equal(byClass(rail, "tg-node").length, 14);
    assert.deepEqual(byClass(rail, "tg-st-h").map(textOf), ["Step 1", "Step 2| · 12 can run at once", "Step 3"]);
  });

  // (fails before: yes — the page had no place beside the chat, D12, D14)
  test("beside the chat: no tile, tools or card of its own, the steps down a rail; a task chosen opens its card under its line, chosen again it closes; a narrow page keeps its canvas and the card under it", () => {
    const chat = chatOf("pane", [turnWith(events(viewAfter(RUN)))]);
    const { body } = page(chat, { pane: true, toSide: () => {} });
    assert.deepEqual([byClass(body, "tg-tile").length, byClass(body, "tg-ib").length, byClass(body, "tg-beside").length, byClass(body, "tg-card").length], [0, 0, 0, 0]);
    assert.equal(one(body, "plan-view").attrs.class, "plan-view is-pane");
    assert.deepEqual([byClass(body, "tg-rail").length, byClass(body, "tg-canvas").length], [1, 0]);
    // The rail (the redesign of 11-05): a step a box of lines, the step at work in blue, what a waiting task waits for.
    // No turn is at work here: the agent's own t2 is between turns, and its step says so (the owner's of 11-09).
    assert.deepEqual(byClass(body, "tg-st").map((s) => [s.attrs.class, textOf(one(s, "tg-st-h"))]), [["tg-st is-done", "Step 1| · done"], ["tg-st is-between", "Step 2| · between turns"], ["tg-st is-later", "Step 3"]]);
    assert.equal(textOf(boxOf(body, "t4")), "t4|Release|after t2, t3");
    boxOf(body, "t3").dispatch("click");
    assert.match(textOf(one(body, "tg-card")), /^t3\|Docs\|ready\|/);
    const icard = one(body, "tg-icard");
    const blk = byClass(body, "tg-blk")[1];
    assert.equal(blk.kids[blk.kids.indexOf(boxOf(body, "t3")) + 1], icard, "its card right under its line");
    assert.match(String(boxOf(body, "t1").attrs.class), /\bis-rel\b/, "what it needs, lit");
    boxOf(body, "t3").dispatch("click");
    assert.equal(byClass(body, "tg-card").length, 0, "chosen again: closed");
    // On the page, however narrow: the same boxes, no card until one is chosen (the owner's of 11-11); a box chosen, its
    // card under the canvas.
    const narrow = fakeH("div");
    renderPlan(narrow, { chat: chatOf("narrow", [turnWith(events(viewAfter(RUN)))]) }, { h: sizedH({ px: 300 }), api: async () => null, now: () => NOW });
    assert.deepEqual([byClass(narrow, "tg-rail").length, byClass(narrow, "tg-node").length], [0, 4]);
    assert.deepEqual(one(narrow, "tg-body").kids.map((/** @type {any} */ k) => k.attrs.class), ["tg-graph"]);
    boxOf(narrow, "t3").dispatch("click");
    assert.deepEqual(one(narrow, "tg-body").kids.map((/** @type {any} */ k) => k.attrs.class), ["tg-graph", "tg-card"]);
    assert.match(textOf(one(narrow, "tg-card")), /^t3\|Docs\|/);
  });

  // (fails before: yes — the bar's Copy plan copied the checklist alone; there was no Beside the chat, nor an offer to
  // run tasks side by side, E41 P3 case 19). Its press opens the side-run sheet where the page has one (10-28,
  // test/side-run.test.js); here, with none, it sends the person's own sentence at once, and the offer says so.
  // (fails before: yes — the owner's of 11-10: the Plan offered them by itself; it draws the agent's suggestion alone)
  test("the head: Copy plan copies what shows, Beside the chat puts it in the right bar; Run them in parallel… stands where the agent suggested them, and sends the person's own sentence where no sheet opens, the agent's alone", () => {
    /** @type {string[]} */
    const sent = [];
    let sides = 0;
    const ADD_TWO = { action: "add", goal: "Two parts", tasks: [{ id: "a", name: "A", writes: ["src/a.js"], steps: ["Write a"] }, { id: "b", name: "B", writes: ["src/b.js"], steps: ["Write b"] }] };
    const unsaid = viewAfter([[ADD_TWO, T0]]);
    assert.equal(byClass(page(chatOf("sbs-none", [turnWith(events(unsaid))]), { send: () => {} }).body, "tg-sbs").length, 0, "no suggestion: no offer of Filament's own");
    const two = viewAfter([[ADD_TWO, T0], [{ action: "parallel", ids: ["a", "b"] }, T0 + 1]]);
    assert.deepEqual(two.offer.ids, ["a", "b"], "the agent's suggestion: two ready tasks of its own that need none of each other");
    const { body } = page(chatOf("sbs", [turnWith(events(two))]), { send: (/** @type {string} */ t) => sent.push(t), toSide: () => sides++ });
    assert.equal(textOf(one(body, "tg-sbs")), "Your agent suggests |a| and |b| |run in parallel| — none needs another's work.|Run them in parallel…");
    const run = press(body, "Run them in parallel…");
    assert.equal(run?.attrs.title, "Opens a sheet: each task's model and where it works. Nothing starts until you press Run.");
    run?.dispatch("click");
    assert.deepEqual(sent, ["Run a and b in parallel on sub-agents."]);
    assert.match(textOf(one(body, "tg-sbs")), /\|Asked your agent \d\d:\d\d — waiting for it to start them$/);
    press(body, "Beside the chat")?.dispatch("click");
    assert.equal(sides, 1);
    // A team's lead gives its tasks to members: no offer of sub-agents.
    const led = chatOf("sbs-team", [turnWith(events(two))]);
    /** @type {any} */ (led.view.settings).engine = { mode: "team", team: "architect", teams: [] };
    assert.equal(byClass(page(led, { send: () => {} }).body, "tg-sbs").length, 0);
    // Copy plan: the checklist page copies the checklist.
    const copied = /** @type {string[]} */ ([]);
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: (/** @type {string} */ s) => { copied.push(s); return new Promise(() => {}); } } } });
    try {
      const list = page(chatOf("copy", [turnWith([{ n: 1, type: "plan", round: 1, items: [{ text: "Read", status: "done" }, { text: "Fix", status: "doing" }] }])]));
      buttonsOf(list.body).find((b) => b.attrs["aria-label"] === "Copy plan")?.dispatch("click");
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was);
    }
    assert.deepEqual(copied, ["[x] Read\n[ ] Fix"]);
    // The graph in words: its goal, how much is done, each step's tasks with their states and needs.
    assert.equal(planText(viewAfter(RUN)), "Task graph — Ship the parser\n1 of 4 done\n\nStep 1\n- [x] t1 Lexer — done\n\nStep 2\n- [ ] t2 Parser — running · needs t1\n- [ ] t3 Docs — ready · needs t1\n\nStep 3\n- [ ] t4 Release — waiting · needs t2, t3");
    // (fails before: yes — the review of 11-05: a fix in its hunt box was a step of its own in the words, so the steps
    // after it were numbered one on from the page's) A hunt's fix is in its hunted task's step, as on the page.
    const v = viewAfter([[{ action: "add", goal: "Hunted", tasks: [{ id: "h", name: "Hunted" }, { id: "f", name: "Fix it", needs: ["h"] }, { id: "x", name: "After the fix", needs: ["f"] }] }, T0]]);
    const hunted = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "f" ? { ...t, foundBy: { agent: "sa_1", name: "Reviewer", task: "h" } } : t)) };
    assert.equal(planText(hunted), "Task graph — Hunted\n0 of 3 done\n\nStep 1\n- [ ] h Hunted — ready\n- [ ] f Fix it — waiting · needs h\n\nStep 2\n- [ ] x After the fix — waiting · needs f");
    // A Reviewer sent from the fix: it stands apart, a step of its own, as on the page.
    assert.match(planText(hunted, null, (id) => id === "f"), /\n\nStep 1\n- \[ \] h Hunted — ready\n\nStep 2\n- \[ \] f Fix it — waiting · needs h\n\nStep 3\n- \[ \] x After the fix/);
  });

  // (fails before: yes — every finished step stood at the top of a long graph, D16; the Hunter of p4b: a task chosen
  // that then folded away lost its card, and nothing chose another)
  test("the finished steps fold, Show them and Fold them kept per chat; a choice that folded away lets its card go, the page's own pick only where its caller lets it", () => {
    const chat = chatOf("fold", [turnWith(events(CHAIN))]);
    const { body } = page(chat);
    assert.equal(textOf(one(body, "tg-fold")), "3 finished steps · 3 tasks done · took under a minute|Show them");
    assert.deepEqual(["t1", "t2", "t3", "t4", "t5"].map((id) => !!boxOf(body, id)), [false, false, false, true, true]);
    // The row is the press (the redesign of 11-05).
    assert.equal(one(body, "tg-fold").tag, "button");
    one(body, "tg-fold").dispatch("click");
    assert.equal(textOf(one(body, "tg-fold-open")), "3 finished steps · 3 tasks done · took under a minute — shown| · |Fold them");
    // Said in the canvas's band, before the layout's buttons and the zoom bar, so the box under it is all canvas (the
    // owner's of 11-10).
    assert.deepEqual(one(body, "tg-canvas-bar").kids.map((/** @type {any} */ k) => k.attrs.class), ["tg-fold-open", "tg-arrange-said", "tg-arrange", "tg-zoom"]);
    assert.ok(boxOf(body, "t1"));
    // Kept for the chat: a page drawn anew shows them still.
    assert.ok(boxOf(page(chat).body, "t1"));
    // t1 chosen, then folded again: no card opens by itself on the page either (the owner's of 11-11), as beside the chat.
    boxOf(body, "t1").dispatch("click");
    assert.match(textOf(one(body, "tg-card")), /^t1\|/);
    press(body, "Fold them")?.dispatch("click");
    assert.equal(byClass(body, "tg-card").length, 0);
    assert.equal(byClass(drawGraph(CHAIN, { h: fakeH, now: NOW, chosen: "t1", pane: true }).el, "tg-card").length, 0);
    // The drawing's own pick, where its caller lets it (`autoPick`): the running t5, between the agent's turns here.
    assert.match(textOf(one(drawGraph(CHAIN, { h: fakeH, now: NOW, chosen: "t1", atWork: false }).el, "tg-card")), /^t5\|Step 5\|between turns\|/);
  });

  // (fails before: yes — D14: beside the chat a card held every part at once)
  test("beside the chat a card shows its first parts; More opens the rest, kept for the chat; Less folds them", () => {
    const chat = chatOf("more", [turnWith(events(viewAfter([[{ action: "add", goal: "More", tasks: [
      { id: "m1", name: "Many parts", goal: "A goal", steps: ["One", "Two"], acceptance: "it passes", writes: ["src/m.js"] },
      { id: "m2", name: "After", needs: ["m1"] },
    ] }, T0]])))]);
    const { body } = page(chat, { pane: true });
    boxOf(body, "m1").dispatch("click");
    const more = one(body, "tg-more");
    assert.match(textOf(more), /^More: /);
    const before = byClass(one(body, "tg-card"), "tg-sec").length;
    more.dispatch("click");
    assert.equal(textOf(one(body, "tg-more")), "Less");
    assert.ok(byClass(one(body, "tg-card"), "tg-sec").length > before, "the rest of its parts");
    // The page shown again opens with no task chosen (the owner's of 11-11): m1 chosen there has its parts open still.
    const again = page(chat, { pane: true }).body;
    assert.equal(byClass(again, "tg-card").length, 0, "shown again: none chosen");
    boxOf(again, "m1").dispatch("click");
    assert.equal(textOf(one(again, "tg-more")), "Less", "kept for the chat");
    press(body, "Less")?.dispatch("click");
    assert.match(textOf(one(body, "tg-more")), /^More: /);
  });

  // (fails before: yes — the Hunter of p4c: a page whose nodes had left the screen drew on, and took the pops from the
  // one on screen; an answer landing drew the newest page alone, never the one it was asked for; beside the chat the
  // page drew before its run was read)
  test("a page off screen draws no more; each page hears its own session's answer; beside the chat it waits for its run", async () => {
    const chat = chatOf("gone", [turnWith(events(viewAfter(RUN)))]);
    const { body, view } = page(chat);
    const scroll = one(body, "pv-scroll");
    scroll.isConnected = true;
    view.paint();
    const drawn = one(body, "tg-view");
    scroll.isConnected = false;
    /** @type {any} */ (chat).taskProgress = new Map([["t2", { agent: "", round: 4, tool: null }]]);
    view.paint();
    assert.equal(one(body, "tg-view"), drawn, "off screen: not drawn again");
    // Two chats' pages, the first one's answer landing last: it draws its own.
    /** @type {(v: any) => void} */
    let land = () => {};
    const a = page(chatOf("answer-a"), {}, { api: () => new Promise((r) => (land = r)) });
    page(chatOf("answer-b"));
    await settle();
    land({ inForce: { graph: viewAfter(RUN), goal: null } });
    await settle();
    assert.equal(textOf(one(a.body, "tg-figs")), "1 of 4 done · 5 min", "its own page drew it: no turn at work, nothing runs");
    // Beside the chat, while the run its plan is read from is on its way: nothing; then drawn; then it stands.
    let reading = true;
    const side = page(chatOf("reading", [turnWith(events(viewAfter(RUN)))]), { pane: true, reading: () => reading });
    assert.deepEqual(one(side.body, "pv-inner").kids, []);
    reading = false;
    side.view.paint();
    const standing = one(side.body, "tg-view");
    assert.ok(standing);
    reading = true;
    side.view.paint();
    assert.equal(one(side.body, "tg-view"), standing, "drawn already: it stands until the read lands");
  });
});

// The owner's of 11-09, a screenshot of the rail: "Step 1 · at work · 2 in parallel" over tasks a and e, both the
// agent's own — and the agent does one thing at a time. A step's header counted the boxes in its row, whatever their
// state and whoever works on them; now it says what runs at once, and who, and the head's figure counts the same way.
describe("the rail's steps: what runs at once, and who (the owner's of 11-09)", () => {
  const BRIEF = { goal: "It works", steps: ["Do it"], acceptance: "its test passes" };
  /** p the agent's own, q and r sub-agents', all in step 1; d after them. */
  const SUBS = /** @type {any} */ (applyTasks(null, { action: "add", goal: "Subs", tasks: [
    { id: "p", name: "Own part" },
    { id: "q", name: "Q part", by: "sub-agent", writes: ["src/q.js"], ...BRIEF },
    { id: "r", name: "R part", by: "sub-agent", writes: ["src/r.js"], ...BRIEF },
    { id: "d", name: "Release", needs: ["p", "q", "r"] },
  ] }, { at: T0, crew: "agent" })).graph;
  /** The graph after each step the core took. @param {any} g @param {((g: any) => any)[]} steps @returns {any} */
  const stepped = (g, ...steps) => steps.reduce((x, step) => {
    const next = step(x);
    assert.ok(next, "a step the core took");
    return next;
  }, g);
  /** @param {string} id @param {string} agent */
  const took = (id, agent) => (/** @type {any} */ g) => launched(g, id, agent, T0 + 1000, "sub-agent");
  /** @param {string} id @param {string} agent */
  const waits = (id, agent) => (/** @type {any} */ g) => slotWaited(g, id, agent, "m, 4 of 4 busy", T0 + 1000);
  /** The rail's steps — each one's class and header — and the head's figures. @param {any} v @param {Record<string, any>} [o] */
  const railed = (v, o = {}) => {
    const el = drawGraph(v, { h: fakeH, now: NOW, pane: true, ...o }).el;
    return { steps: byClass(el, "tg-st").map((s) => [s.attrs.class, textOf(one(s, "tg-st-h"))]), figs: textOf(one(el, "tg-figs")) };
  };

  // (fails before: yes — "Step 1 · at work · 2 in parallel" and "2 running" over the agent's two own tasks)
  test("the agent's own tasks are one lane however many run: its step at work says the agent, the head counts one; between its turns neither", () => {
    const own = viewAfter([
      [{ action: "add", goal: "Own", tasks: [{ id: "a", name: "Alpha" }, { id: "e", name: "Echo" }, { id: "z", name: "After", needs: ["a", "e"] }] }, T0],
      [{ action: "start", ids: ["a", "e"] }, T0 + 1000],
    ]);
    assert.deepEqual(own.tasks.map((/** @type {any} */ t) => [t.id, t.state]), [["a", "running"], ["e", "running"], ["z", "waiting"]]);
    assert.deepEqual(railed(own, { atWork: true }), { steps: [["tg-st is-now", "Step 1| · |at work| · the agent"], ["tg-st is-later", "Step 2"]], figs: "0 of 3 done · 1 running · 5 min" });
    // Between its turns nothing works on them: the boxes say "between turns", and so do the step and the head.
    assert.deepEqual(railed(own, { atWork: false }), { steps: [["tg-st is-between", "Step 1| · between turns"], ["tg-st is-later", "Step 2"]], figs: "0 of 3 done · 5 min" });
  });

  // (fails before: yes — "3 in parallel" over two sub-agents, and one waiting for its slot counted running)
  test("each sub-agent at work is one, named; one waiting for its slot runs not and is not counted; with the agent's own, both said", () => {
    const two = graphView(stepped(SUBS, took("q", "sa-q"), took("r", "sa-r")));
    assert.deepEqual(railed(two), { steps: [["tg-st is-now", "Step 1| · |at work| · 2 sub-agents"], ["tg-st is-later", "Step 2"]], figs: "0 of 4 done · 2 running · 5 min" });
    const slot = stepped(SUBS, took("q", "sa-q"), took("r", "sa-r"), waits("r", "sa-r"));
    assert.deepEqual(railed(graphView(slot)), { steps: [["tg-st is-now", "Step 1| · |at work| · 1 sub-agent"], ["tg-st is-later", "Step 2"]], figs: "0 of 4 done · 1 running · 5 min" });
    // (fails before: yes — the box of one waiting for its slot slid its bar, as if it ran)
    const bars = byClass(drawGraph(graphView(slot), { h: fakeH, now: NOW, pane: true }).el, "tg-node").map((n) => [n.attrs["data-id"], !!one(n, "tg-node-bar")]);
    assert.deepEqual(bars, [["p", false], ["q", true], ["r", false], ["d", false]]);
    const mixed = graphView(stepped(slot, (g) => /** @type {any} */ (applyTasks(g, { action: "start", id: "p" }, { at: T0 + 2000, crew: "agent" })).graph));
    assert.deepEqual(railed(mixed, { atWork: true }).steps[0], ["tg-st is-now", "Step 1| · |at work| · 1 sub-agent + the agent"]);
    assert.equal(railed(mixed, { atWork: true }).figs, "0 of 4 done · 2 running · 5 min");
    // Both waiting for a slot: nothing runs — the step waits, and its boxes can run at once.
    const none = graphView(stepped(SUBS, took("q", "sa-q"), took("r", "sa-r"), waits("q", "sa-q"), waits("r", "sa-r")));
    assert.deepEqual(railed(none), { steps: [["tg-st is-waiting", "Step 1| · waiting| · 3 can run at once"], ["tg-st is-later", "Step 2"]], figs: "0 of 4 done · 5 min" });
  });

  // (fails before: yes — the header read the row's boxes alone, never a step box's sub-tasks: "Step 2 · at work")
  test("a step box whose sub-tasks run on sub-agents says them", () => {
    const g = /** @type {any} */ (applyTasks(null, { action: "add", goal: "Steps", tasks: [
      { id: "map", name: "Map the code" },
      { id: "s1", name: "Sub-tasks", needs: ["map"] },
      { id: "c1", name: "One", under: "s1", by: "sub-agent", writes: ["src/one.js"], ...BRIEF },
      { id: "c3", name: "Three", under: "s1", by: "sub-agent", writes: ["src/three.js"], ...BRIEF },
    ] }, { at: T0, crew: "agent" })).graph;
    const mapped = stepped(g, (x) => /** @type {any} */ (applyTasks(x, { action: "start", ids: ["map"] }, { at: T0 + 500, crew: "agent" })).graph, (x) => /** @type {any} */ (applyTasks(x, { action: "done", id: "map", summary: "Mapped" }, { at: T0 + 800, crew: "agent" })).graph);
    const v = graphView(stepped(mapped, took("c1", "sa-1"), took("c3", "sa-3")));
    assert.deepEqual(railed(v), { steps: [["tg-st is-done", "Step 1| · done"], ["tg-st is-now", "Step 2| · |at work| · 2 sub-agents"]], figs: "1 of 3 done · 2 running · 5 min" });
  });

  // (fails before: yes — every merge, check and reading counted, two merges as two; no step said who)
  test("a reviewer reading, a command's runs, Filament's check and a merge are named; merges are one lane, Filament applying one change at a time", () => {
    const v = fork(5);
    /** @type {Record<string, any>} */
    const as = {
      r: { state: "done" },
      a1: { state: "checking", check: ["npm test"] },
      a2: { state: "merging", step: null },
      a3: { state: "merging", step: null },
      a4: { state: "running", by: "command", run: ["npm test"], items: [], progress: { ran: 0, passed: 0, of: 1, lanes: 1 } },
      a5: { state: "review", step: "reading", reviewer: "sa-r" },
    };
    const busy = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => ({ ...t, ...as[t.id] })) };
    const drawn = railed(busy);
    assert.deepEqual(drawn.steps[1], ["tg-st is-now", "Step 2| · |at work| · 1 reviewer + 1 command + 1 check + a merge"]);
    assert.match(drawn.figs, / · 4 running · /);
  });

  // (fails before: yes — "at work" over a step whose only open task failed, or asks you: CALLS was counted as work)
  test("a step where nothing runs and a task calls for you says the call, in its box's word and colour", () => {
    const end = /** @type {any} */ ({ agent: "sa-q", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Wrote Q", met: false, evidence: "its test fails", left: "" }, words: "", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1000, cut: false });
    const solo = /** @type {any} */ (applyTasks(null, { action: "add", goal: "Solo", tasks: [{ id: "q", name: "Q part", by: "sub-agent", writes: ["src/q.js"], ...BRIEF }, { id: "d", name: "Release", needs: ["q"] }] }, { at: T0, crew: "agent" })).graph;
    const failed = /** @type {any} */ (graphView(stepped(solo, took("q", "sa-q"), (g) => taskEnded(g, "q", end, T0 + 5000)?.graph)));
    assert.equal(failed.tasks[0].state, "failed");
    const el = drawGraph(failed, { h: fakeH, now: NOW, pane: true }).el;
    const step = byClass(el, "tg-st")[0];
    assert.deepEqual([step.attrs.class, textOf(one(step, "tg-st-h")), one(step, "tg-fig-call").attrs.class], ["tg-st is-calls", "Step 1| · |failed", "tg-fig-call is-failed"]);
    assert.equal(byClass(step, "tg-st-now").length, 0, "nothing at work");
    // Its sub-agent's call waits for your answer: it asks you, and runs not meanwhile.
    const asking = graphView(stepped(solo, took("q", "sa-q")));
    const progress = new Map([["q", { agent: "sa-q", round: 2, tool: null, asking: { tool: "bash", args: "npm install" } }]]);
    assert.deepEqual(railed(asking, { progress }), { steps: [["tg-st is-calls", "Step 1| · |asks you"], ["tg-st is-later", "Step 2"]], figs: "0 of 2 done · |1 asks you| · 5 min" });
  });

  // (fails before: yes — "Step 2 · paused · 2 in parallel")
  test("a paused step keeps its word, and says how many of its boxes can run at once", () => {
    const paused = viewAfter([...RUN, [{ action: "pause", id: "t2", checkpoint: "Half the parser" }, T0 + 250_000]]);
    assert.deepEqual(railed(paused).steps[1], ["tg-st is-paused", "Step 2| · paused| · 2 can run at once"]);
  });

  // (fails before: yes — "Step 2 · 2 can run at once" over t2 done and t3 ready, the row's boxes counted whatever their state)
  test("what can run at once counts the boxes still open: a done or dropped one is not, and one open box says nothing", () => {
    const three = [{ action: "add", goal: "Fork", tasks: [{ id: "t1", name: "Root" }, { id: "t2", name: "Left", needs: ["t1"] }, { id: "t3", name: "Right", needs: ["t1"] }, { id: "t4", name: "Mid", needs: ["t1"] }] }, T0];
    const rooted = /** @type {[any, number][]} */ ([three, [{ action: "start", id: "t1" }, T0 + 1000], [{ action: "done", id: "t1", summary: "Root" }, T0 + 2000]]);
    const doneOne = viewAfter([...rooted, [{ action: "start", id: "t2" }, T0 + 3000], [{ action: "done", id: "t2", summary: "Left" }, T0 + 4000], [{ action: "drop", ids: ["t4"], reason: "not needed" }, T0 + 5000]]);
    assert.deepEqual(doneOne.tasks.map((/** @type {any} */ t) => t.state), ["done", "done", "waiting", "dropped"]);
    assert.deepEqual(railed(doneOne).steps[1], ["tg-st is-later", "Step 2"]);
    const dropped = viewAfter([...rooted, [{ action: "drop", ids: ["t4"], reason: "not needed" }, T0 + 5000]]);
    assert.deepEqual(railed(dropped).steps[1], ["tg-st is-later", "Step 2| · 2 can run at once"]);
    // A step of dropped tasks alone is not done, and nothing in it can run.
    const gone = viewAfter([...rooted, [{ action: "drop", ids: ["t2", "t3", "t4"], reason: "not needed" }, T0 + 5000]]);
    assert.deepEqual(railed(gone).steps[1], ["tg-st is-later", "Step 2"]);
  });

  // (fails before: yes — "at work · 1 sub-agent" over q failed beside r at work, while the head said "1 failed")
  test("a step at work keeps what calls for you: a failed task or one that asks you beside one at work is said, as the head says it", () => {
    const end = /** @type {any} */ ({ agent: "sa-q", status: "done", stoppedBy: null, error: null, report: { status: "done", did: "Wrote Q", met: false, evidence: "its test fails", left: "" }, words: "", files: [], shared: false, wrote: false, workError: null, ran: [], calls: [], written: [], spentUsd: 0, ms: 1000, cut: false });
    const failed = /** @type {any} */ (graphView(stepped(SUBS, took("q", "sa-q"), took("r", "sa-r"), (g) => taskEnded(g, "q", end, T0 + 5000)?.graph)));
    assert.equal(failed.tasks.find((/** @type {any} */ t) => t.id === "q").state, "failed");
    const el = drawGraph(failed, { h: fakeH, now: NOW, pane: true }).el;
    const step = byClass(el, "tg-st")[0];
    assert.deepEqual([step.attrs.class, textOf(one(step, "tg-st-h")), byClass(step, "tg-fig-call").map((s) => s.attrs.class)], ["tg-st is-now", "Step 1| · |at work| · 1 sub-agent| · |failed", ["tg-fig-call is-failed"]]);
    assert.equal(textOf(one(el, "tg-figs")), "0 of 4 done · 1 running · |1 failed| · 5 min");
    // q's call waits for your answer while r works.
    const progress = new Map([["q", { agent: "sa-q", round: 2, tool: null, asking: { tool: "bash", args: "npm install" } }]]);
    const asking = railed(graphView(stepped(SUBS, took("q", "sa-q"), took("r", "sa-r"))), { progress });
    assert.deepEqual(asking, { steps: [["tg-st is-now", "Step 1| · |at work| · 1 sub-agent| · |asks you"], ["tg-st is-later", "Step 2"]], figs: "0 of 4 done · 1 running · |1 asks you| · 5 min" });
  });

  // (fails before: yes — "Step 1 · between turns" over a between turns and e paused, while the head said "1 paused")
  test("a pause in a step between turns, or at work, is said, as the head says it", () => {
    const own = viewAfter([
      [{ action: "add", goal: "Own", tasks: [{ id: "a", name: "Alpha" }, { id: "e", name: "Echo" }, { id: "z", name: "After", needs: ["a", "e"] }] }, T0],
      [{ action: "start", ids: ["a", "e"] }, T0 + 1000],
      [{ action: "pause", id: "e", checkpoint: "Half of it" }, T0 + 2000],
    ]);
    assert.deepEqual(own.tasks.map((/** @type {any} */ t) => [t.id, t.state]), [["a", "running"], ["e", "paused"], ["z", "waiting"]]);
    assert.deepEqual(railed(own, { atWork: false }), { steps: [["tg-st is-between", "Step 1| · between turns| · paused"], ["tg-st is-later", "Step 2"]], figs: "0 of 3 done · 1 paused · 5 min" });
    assert.deepEqual(railed(own, { atWork: true }), { steps: [["tg-st is-now", "Step 1| · |at work| · the agent| · paused"], ["tg-st is-later", "Step 2"]], figs: "0 of 3 done · 1 running · 1 paused · 5 min" });
  });
});

describe("what is still open, first on the page", () => {
  const CMD = { key: "command:bg_1", line: "background command bg_1: `npm run dev` in H:\\p, running for 3 min", dismissed: false, view: { group: "running", tone: "run", title: "npm run dev", detail: "Background command, running 3 min · in p" } };
  const SUB = { key: "agent:sa_1:working", line: "sub-agent sa_1 (\"Review: auth flow\"): still working; its report comes to you", dismissed: false, view: { group: "running", tone: "run", title: "Review: auth flow", detail: "Sub-agent at work: its report comes to the agent", act: "thread", agent: "sa_1" } };
  // (fails before: yes — the owner's of 11-05: the list a chat's agent is told after a compaction could be seen nowhere)
  test("a folded card over the graph, the checklist or the empty page: its counts, the rows a press away, and how the list works on its ⓘ", async () => {
    const answer = { inForce: { graph: null, goal: null }, open: { lines: [`- ${CMD.line}`, `- ${SUB.line}`], told: false, items: [CMD, SUB] } };
    const chat = chatOf("open", [turnWith(events(null, ["Write the notes"]))]);
    const { body, view } = page(chat, {}, { api: async () => answer });
    await settle();
    view.paint();
    const inner = one(body, "pv-inner");
    const card = one(body, "pv-open");
    assert.equal(inner.kids[0], card, "first on the page");
    assert.ok(card.attrs.class.includes("is-checklist"), "as wide as the checklist");
    assert.equal("open" in card.attrs, false, "folded");
    assert.equal(textOf(one(card, "pv-open-head")), "Still open|2 running");
    assert.deepEqual(byClass(card, "pv-open-t").map(textOf), ["npm run dev", "Review: auth flow"]);
    assert.match(textOf(one(card, "pv-open-due")), /^The agent compacted its context since it last heard this list/);
    assert.match(one(card, "pv-open-info").attrs.title, /^What this chat has waiting, running and left behind\. Filament keeps the list itself/);
    // Opened, it stays open for the chat as the page draws again.
    card.attrs.open = "";
    card.dispatch("toggle", { currentTarget: { open: true } });
    answer.open = { lines: [`- ${CMD.line}`], told: true, items: [CMD] };
    /** @type {any} */ (chat).turns = [...chat.turns, { ...turnWith(events(null, ["Write the notes"])), n: 2 }];
    view.paint();
    await settle();
    view.paint();
    const again = one(body, "pv-open");
    assert.notEqual(again, card);
    assert.deepEqual(["open" in again.attrs, textOf(one(again, "pv-open-head")), one(again, "pv-open-due")], [true, "Still open|1 running", undefined]);
    // Nothing open, over the empty page; a server that says nothing of it, no card.
    const none = page(chatOf("none"), {}, { api: async () => ({ inForce: { graph: null, goal: null }, open: { lines: [], told: false, items: [] } }) });
    await settle();
    none.view.paint();
    const empty = one(none.body, "pv-open");
    assert.deepEqual([empty.attrs.class, textOf(one(empty, "pv-open-head"))], ["pv-open is-empty", "Still open|nothing"]);
    assert.equal(textOf(one(empty, "pv-open-empty")), "Nothing is waiting or running.");
    assert.equal(one(empty, "pv-open-due"), undefined, "nothing open: nothing is told with the next message");
    const old = page(chatOf("old"), {}, { api: async () => ({ inForce: { graph: null, goal: null } }) });
    await settle();
    old.view.paint();
    assert.equal(one(old.body, "pv-open"), undefined);
  });
});

describe("the graph drawn: what the Hunter of p4b found", () => {
  // (fails before: yes)
  test("room for a card beside the canvas and none open: the canvas takes it all; with one, it stands beside it; no key either way", () => {
    const none = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, width: 2000, autoPick: false });
    assert.deepEqual([none.mode, one(none.el, "tg-body").attrs.class, byClass(none.el, "tg-card").length], ["beside", "tg-body is-under", 0]);
    const chosen = drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, width: 2000, autoPick: false, chosen: "t3" });
    assert.equal(one(chosen.el, "tg-body").attrs.class, "tg-body is-beside");
    // A line means "needs" and nothing else (the redesign of 11-05): nothing to key.
    assert.deepEqual([byClass(none.el, "tg-key").length, byClass(chosen.el, "tg-key").length], [0, 0]);
  });

  // (fails before: yes — the fold row's id was "fold", an id a task may have: its lines came out of the fold row)
  test("a task named fold is a task: its lines leave its own box", () => {
    assert.notEqual(FOLD, "fold");
    const lay = boxesOf([{ id: "fold", needs: [], state: "done" }, { id: "x", needs: ["fold"], state: "waiting" }]);
    const B = /** @type {any} */ (lay.boxes.get("fold"));
    const [r] = lay.lines;
    assert.deepEqual([r.from, r.a], ["fold", { x: B.x + B.w / 2, y: B.y + B.h }], "straight down out of its box's foot");
  });

  // (fails before: yes — a running task the agent's red check sent back said "Changed, at its last pause": nothing
  // paused)
  test("a running task's files are its so far", () => {
    const v = viewAfter(RUN);
    const changed = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t2" ? { ...t, changed: ["src/parse.js", "notes.md"], beyond: ["notes.md"] } : t)) };
    const card = textOf(one(drawGraph(changed, { h: fakeH, now: NOW, chosen: "t2" }).el, "tg-card"));
    assert.match(card, /\|Changed so far\|2 files\|src\/parse\.js\|notes\.md\|notes\.md changed too, beyond its writes\.\|/);
  });

  // (fails before: yes — the graph keeps the first 200 files a task changed, by path, and the page counted those as all)
  test("a task that changed more files than the graph keeps by name: its counts say over", () => {
    const v = viewAfter(RUN);
    const files = Array.from({ length: 200 }, (_, k) => `f${String(k).padStart(3, "0")}.js`);
    const changed = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t2" ? { ...t, changed: files, changedMore: true } : t)) };
    const card = textOf(one(drawGraph(changed, { h: fakeH, now: NOW, chosen: "t2" }).el, "tg-card"));
    assert.match(card, /\|Changed so far\|over 200 files\|f000\.js\|.*\|f011\.js\|and over 188 more\|/);
  });
});

describe("a paused task (E36 CP5, case 24)", () => {
  const WHERE = "The grammar is in; the quote tests are next. Re-read src/parse.js's tokenizer.";
  /** What the graph keeps, as the page reads it: the checkpoint's note, read whole. @param {any[]} asked @returns {any} */
  const keptWith = (asked) => ({
    of: () => ({ list: { notes: [], files: [] }, error: null }), opened: () => null, onOpen: () => {}, fileUrl: () => "", graphShown: false, onGraph: () => {},
    note: (/** @type {string} */ task, /** @type {string} */ title) => (asked.push([task, title]), { text: WHERE, error: null }),
  });

  // (fails before: no — built with the page (p4b); guarded since the look, which found it untested)
  test("its own mark and word on its box; chosen, its newest checkpoint is its card's first part, read whole", () => {
    const paused = viewAfter([...RUN, [{ action: "pause", id: "t2", checkpoint: WHERE }, T0 + 260_000]]);
    // The checkpoint's note behind it, as the server keeps it on the pause (graph-runner) and the view marks it.
    const v = { ...paused, tasks: paused.tasks.map((/** @type {any} */ t) => (t.id === "t2" ? { ...t, kept: { notes: 1, files: 0 } } : t)) };
    const t2 = v.tasks.find((/** @type {any} */ t) => t.id === "t2");
    assert.equal(t2.state, "paused");
    /** @type {any[]} */
    const asked = [];
    const g = drawGraph(v, { h: fakeH, now: NOW, chosen: "t2", kept: keptWith(asked) });
    const box = boxOf(g.el, "t2");
    assert.equal(one(box, "tg-mark").attrs.class, "tg-mark is-paused", "a pause's own mark, never the still arc of between turns");
    assert.match(textOf(box), /\|paused · checkpoint 1/);
    assert.deepEqual(asked, [["t2", t2.checkpoint.title]], "the note its checkpoint names, by its title");
    const cardEl = one(g.el, "tg-card");
    const card = textOf(cardEl);
    assert.ok(textOf(cardEl.kids[1]).includes(WHERE), "where it stood, its first part, under its head");
    assert.match(textOf(one(cardEl, "tg-card-head")), /\|Needs\|t1\|/, "what it needs, in its head");
    assert.match(card, new RegExp(`\\|${t2.checkpoint.title}\\|`));
  });
});

describe("the lines as SVG (the redesign of 11-05)", () => {
  // (fails before: yes — a line said nowhere which tasks it stands for, so the task the pointer rests on could light
  // none; and lines ran at right angles, a crossing masked, a run of one look grouped)
  test("a path a line, in the order given — the quiet first, the chosen task's last — each with its look and the tasks it stands for; the task the pointer rests on lights its own", () => {
    const svg = linesSvg([{ cls: "e done", d: "M0,0 C0,10 50,10 50,20", ids: ["a", "b"] }, { cls: "e on", d: "M50,40 C50,50 90,50 90,60", ids: ["b", "c"] }], 140, 60);
    assert.equal(svg, '<svg width="140" height="60" viewBox="0 0 140 60"><path class="e done" d="M0,0 C0,10 50,10 50,20" data-ids="a b"/><path class="e on" d="M50,40 C50,50 90,50 90,60" data-ids="b c"/></svg>');
    // The graph's: out of finished work first, then the rest; the chosen task's last.
    const html = (/** @type {string | null} */ chosen) => String(one(drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, autoPick: false, chosen }).el, "tg-edges").attrs.html);
    const looks = (/** @type {string} */ s) => [...s.matchAll(/<path class="([^"]*)" d="[^"]*" data-ids="([^"]*)"/g)].map((m) => `${m[1]}: ${m[2]}`);
    assert.deepEqual(looks(html(null)), ["e done: t1 t2", "e done: t1 t3", "e: t2 t4", "e: t3 t4"]);
    assert.deepEqual(looks(html("t3")), ["e done: t1 t2", "e: t2 t4", "e done on: t1 t3", "e on: t3 t4"]);
    // Lit as the pointer comes to rest on a task, unlit as it leaves.
    const paths = ["a b", "b c", "c d"].map((ids) => {
      const on = new Set();
      return { on, getAttribute: () => ids, classList: { toggle: (/** @type {string} */ c, /** @type {boolean} */ yes) => (yes ? on.add(c) : on.delete(c)) } };
    });
    lightLines({ querySelectorAll: () => paths }, "b");
    assert.deepEqual(paths.map((p) => p.on.has("hov")), [true, true, false]);
    lightLines({ querySelectorAll: () => paths }, null);
    assert.deepEqual(paths.map((p) => p.on.has("hov")), [false, false, false]);
  });
});

// What a read-only review of 67038d835 found (sa_94a47ed9), each shown failing first.
describe("the review of 67038d835", () => {
  /** The page on its tab, as wide as `px` says. @param {any} chat @param {number} px */
  const wide = (chat, px = 1640) => {
    const body = fakeH("div");
    const view = renderPlan(body, { chat }, { h: sizedH({ px }), api: async () => null, now: () => NOW });
    return { body, view };
  };

  // (fails before: yes — its 1: the card beside the canvas scrolls itself, and is drawn anew at every draw, so a part
  // read halfway down went back to the card's head at the work's next step)
  test("the card beside the canvas keeps where it was scrolled to through the draws that follow; another task's opens at its top", () => {
    const chat = chatOf("inspector", [turnWith(events(viewAfter(RUN)))]);
    const { body, view } = wide(chat);
    boxOf(body, "t2").dispatch("click");
    const card = one(body, "tg-card");
    card.scrollTop = 140;
    card.dispatch("scroll");
    // A step of its work alone: said in the drawing as it stands (task-graph.js `patch`), the card where it was.
    chat.taskProgress = new Map([["t2", { agent: "", round: 2, tool: null }]]);
    view.paint();
    assert.deepEqual([one(body, "tg-card") === card, one(body, "tg-card").scrollTop], [true, 140]);
    // The work moves — t3 starts —: drawn anew, the card where it was scrolled to.
    chat.turns = [turnWith(events(viewAfter([...RUN, [{ action: "start", id: "t3" }, T0 + 210_000]])))];
    view.paint();
    assert.notEqual(one(body, "tg-card"), card, "drawn anew");
    assert.equal(one(body, "tg-card").scrollTop, 140);
    // Another task chosen: its card at its top; back to t2, its own again at its top — the card opened anew.
    boxOf(body, "t3").dispatch("click");
    assert.equal(Number(one(body, "tg-card").scrollTop) || 0, 0);
    one(body, "tg-card").scrollTop = 60;
    one(body, "tg-card").dispatch("scroll");
    chat.taskProgress = new Map([["t2", { agent: "", round: 3, tool: null }]]);
    view.paint();
    assert.equal(one(body, "tg-card").scrollTop, 60);
  });

  // (fails before: yes — its 2: the checklist's item in progress turned and said "now" whatever the turn did, the
  // agent's turn over; and a task's card's Steps turned between turns while its own mark stood still)
  test("between the agent's turns the checklist's item in progress and a card's step in progress stand still, and say so", () => {
    const items = (/** @type {any} */ c) => byClass(c, "pv-item").map((i) => [textOf(i), one(i, "tg-mark").attrs.class]);
    const idle = chatOf("list-idle", [turnWith(events(null, ["Write the notes"]))]);
    assert.deepEqual(items(page(idle).body), [["Write the notes|between turns", "tg-mark is-running is-still"]]);
    const live = chatOf("list-live", [turnWith(events(null, ["Write the notes"]))]);
    /** @type {any} */ (live).live = { status: "streaming" };
    assert.deepEqual(items(page(live).body), [["Write the notes|now", "tg-mark is-running"]]);
    // A team's lead keeps its checklist apart from the chat's turn: as before.
    const led = chatOf("list-led", [turnWith(events(null, ["Write the notes"]))]);
    /** @type {any} */ (led.view.settings).engine = { mode: "team", team: "architect", teams: [] };
    assert.deepEqual(items(page(led).body), [["Write the notes|now", "tg-mark is-running"]]);
    // The agent's own running task, its checklist on its card (the owner's of 11-11).
    const v = viewAfter(RUN);
    const listed = { ...v, tasks: v.tasks.map((/** @type {any} */ t) => (t.id === "t2" ? { ...t, list: [{ text: "Read", status: "done" }, { text: "Fix", status: "doing" }] } : t)) };
    const steps = (/** @type {boolean} */ atWork) => byClass(one(one(drawGraph(listed, { h: fakeH, now: NOW, chosen: "t2", atWork }).el, "tg-card"), "tg-steps"), "tg-mark").map((m) => m.attrs.class);
    assert.deepEqual(steps(false), ["tg-mark is-done", "tg-mark is-running is-still"]);
    assert.deepEqual(steps(true), ["tg-mark is-done", "tg-mark is-running"]);
  });

  // (fails before: yes — its 6: the inspector held its whole head at its top — its name over as many lines as it took,
  // every task it needs and that needs it — and its foot by the window's height, however many Reviewers it listed: on a
  // task many need, the two held parts left the parts between them a sliver)
  test("the inspector holds its title row alone, its name two lines at most; what a task needs and what needs it capped, the rest a press away; its foot held by the card's own height, bounded", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const IN = ".pv-inner.is-workspace .tg-body.is-beside > .tg-card";
    const rule = (/** @type {string} */ sel) => (new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\>:]/g, "\\$&")} \\{([^}]*)\\}`).exec(css) || [])[1] || "";
    assert.match(rule(`${IN} > .tg-card-head`), /^ display: contents; $/, "the head's rows its card's own");
    assert.match(rule(`${IN} > .tg-card-head > .tg-card-title`), /position: sticky; top: 0;/);
    assert.match(rule(`${IN} > .tg-card-head > .tg-card-title > .tg-card-name`), /-webkit-line-clamp: 2;/);
    assert.match(rule(IN), /container: inspector \/ size;/);
    assert.match(css, /\n@container inspector \(min-height: 600px\) \{\n {2}\.pv-inner\.is-workspace \.tg-body\.is-beside > \.tg-card > \.tg-card-foot \{ position: sticky; bottom: 0;[^}]* max-height: 40cqh; overflow-y: auto;/);
    assert.doesNotMatch(css, /@media \(min-height: 960px\)/, "the window's height says nothing of the card's");
    // r needed by twelve: six chips, and the rest a press away, kept as the page draws again; its name whole in its title.
    const chat = chatOf("needed", [turnWith(events(fork(12)))]);
    const { body, view } = wide(chat);
    boxOf(body, "r").dispatch("click");
    const rel = () => one(one(body, "tg-card"), "tg-card-rel");
    assert.deepEqual([byClass(rel(), "tg-chip").length, textOf(one(rel(), "tg-chip-more"))], [6, "and 6 more"]);
    assert.equal(one(one(body, "tg-card"), "tg-card-name").attrs.title, "Root");
    one(rel(), "tg-chip-more").dispatch("click");
    chat.taskProgress = new Map([["a1", { agent: "", round: 1, tool: null }]]);
    view.paint();
    assert.deepEqual([byClass(rel(), "tg-chip").length, textOf(one(rel(), "tg-chip-more")), one(rel(), "tg-chip-more").attrs["aria-expanded"]], [12, "Fewer", "true"]);
    one(rel(), "tg-chip-more").dispatch("click");
    assert.equal(byClass(rel(), "tg-chip").length, 6);
    // Seven are all shown: "and 1 more" says less than the chip would.
    const seven = wide(chatOf("needed-7", [turnWith(events(fork(7)))]));
    boxOf(seven.body, "r").dispatch("click");
    assert.deepEqual([byClass(one(seven.body, "tg-card-rel"), "tg-chip").length, byClass(seven.body, "tg-chip-more").length], [7, 0]);
  });

  // (fails before: yes — its 7: − and + sent the canvas back to its start, whatever the person had panned to: the pan
  // kept was another zoom's)
  test("the zoom bar's − and + zoom about the canvas's middle, the point there staying there; Fit opens it at its start", () => {
    /** The page's `h`, the canvas laid out at the page's top left, 358 × 200, its drawing where its scroll puts it. @type {any} */
    const laidH = (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = sizedH({ px: 400 })(tag, attrs, ...kids);
      if (attrs?.class === "tg-canvas-view") {
        Object.assign(n, { clientWidth: 358, clientHeight: 200, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
        n.querySelector = (/** @type {string} */ sel) => (sel === ".tg-canvas-size" ? { getBoundingClientRect: () => ({ left: -n.scrollLeft, top: -n.scrollTop }) } : null);
      }
      return n;
    };
    const chat = chatOf("zoom-mid", [turnWith(events(fork(12)))]);
    const body = fakeH("div");
    renderPlan(body, { chat }, { h: laidH, api: async () => null, now: () => NOW });
    const zoomBy = (/** @type {string} */ label) => buttonsOf(body).find((b) => b.attrs["aria-label"] === label)?.dispatch("click");
    const at = () => [textOf(one(body, "tg-zoom-v")), Math.round(one(body, "tg-canvas-view").scrollLeft * 1000) / 1000];
    // Panned to 500 px at 80%: the middle, 179 px across, is the drawing's 848.75 px.
    one(body, "tg-canvas-view").scrollLeft = 500;
    one(body, "tg-canvas-view").dispatch("scroll");
    zoomBy("Zoom in");
    assert.deepEqual(at(), ["90%", 584.875], "848.75 × 0.9 − 179");
    zoomBy("Zoom out");
    assert.deepEqual(at(), ["80%", 500]);
    press(body, "Fit")?.dispatch("click");
    assert.equal(one(body, "tg-canvas-view").scrollLeft, 0);
  });

  // (fails before: yes — its 10: the Plan's marks drawn elsewhere breathed and turned on where the app's Animations
  // were Reduced, which the Plan's own marks hold still for; only the system's setting stilled them)
  test("the Plan's marks elsewhere — the pane button's dot, the status panel's spinner, the plan card's — hold still where Animations are Reduced", () => {
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    for (const sel of [".pbtn-works", ".sp-plan-ic.is-live svg", ".plan-ic.doing.is-live svg"]) assert.ok(css.includes(`\n[data-motion="reduced"] ${sel} { animation: none; }`), sel);
  });

  // (fails before: yes — its 13: the card's More line said a padding and a rule over it that a card's parts' own rule
  // always overrode; and the inspector, a scroller of its own, had no name to be told by)
  test("the card's More line says only what it draws; the card is named for its task", () => {
    const css = readFileSync(new URL("../src/ui/harness/views/views.css", import.meta.url), "utf8");
    const more = (/\n\.tg-more \{([^}]*)\}/.exec(css) || [])[1] || "";
    assert.ok(more, "the More line's rule");
    assert.doesNotMatch(more, /padding|border-top/, "a part of the card: `.tg-card-head ~ .tg-sec` places it");
    const card = one(drawGraph(viewAfter(RUN), { h: fakeH, now: NOW, chosen: "t2" }).el, "tg-card");
    assert.equal(card.attrs["aria-label"], "t2 Parser");
  });
});

describe("the canvas's layout: Rearrange, and top to bottom or left to right (the owner's of 11-14)", () => {
  // e needs a and d, which the view's order put either side of b: b's two lines cross e's.
  const KNOT = viewAfter([[{ action: "add", goal: "Knot", tasks: [
    { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C", needs: ["b"] }, { id: "d", name: "D" },
    { id: "e", name: "E", needs: ["a", "d"] }, { id: "f", name: "F", needs: ["c"] }, { id: "g", name: "G", needs: ["b"] }, { id: "h", name: "H", needs: ["c"] },
  ] }, T0]]);
  /** A box's place on the canvas, left and top. @param {any} body @param {string} id */
  const placed = (body, id) => (/^left:([\d.]+)px;top:([\d.]+)px;/.exec(boxOf(body, id).attrs.style) || []).slice(1, 3).map(Number);
  /** The way buttons, by the way each draws, pressed or not. @param {any} body */
  const ways = (body) => byClass(body, "tg-arrange-dir").map((b) => `${b.attrs["data-dir"]}:${b.attrs["aria-pressed"]}`);
  /** @param {any} body @param {"down" | "right"} dir */
  const turn = (body, dir) => byClass(body, "tg-arrange-dir").find((b) => b.attrs["data-dir"] === dir).dispatch("click");

  // (fails before: yes — the canvas's bar held the zoom alone: no press laid the graph out again, nor drew it across)
  test("a fresh canvas is drawn top to bottom; Left to right draws a column a step, kept for the chat, and Top to bottom draws it down again; another chat opens top to bottom", () => {
    const chat = chatOf("turned", [turnWith(events(viewAfter(RUN)))]);
    const { body } = page(chat);
    // The note's place always there, empty while nothing is said: the focus put back after a draw finds its button.
    assert.deepEqual(one(body, "tg-canvas-bar").kids.map((/** @type {any} */ k) => k.attrs.class), ["tg-arrange-said", "tg-arrange", "tg-zoom"]);
    assert.equal(textOf(one(body, "tg-arrange-said")), "");
    assert.equal(textOf(one(body, "tg-arrange")), "Rearrange");
    assert.equal(one(body, "tg-arrange").attrs["aria-label"], "Layout");
    assert.deepEqual(ways(body), ["down:true", "right:false"]);
    assert.ok(placed(body, "t1")[1] < placed(body, "t2")[1], "t2 under t1");
    turn(body, "right");
    assert.deepEqual(ways(body), ["down:false", "right:true"]);
    assert.match(one(body, "tg-canvas").attrs.class, /\bis-across\b/);
    assert.ok(placed(body, "t1")[0] < placed(body, "t2")[0] && placed(body, "t2")[0] === placed(body, "t3")[0] && placed(body, "t3")[0] < placed(body, "t4")[0], "a column a step");
    assert.ok(placed(body, "t2")[1] < placed(body, "t3")[1], "t2 over t3");
    // Each line leaves a right side straight across: its first bend is level with where it starts.
    for (const d of String(one(body, "tg-edges").attrs.html).match(/d="[^"]+"/g) || []) {
      const [, y0, y1] = /^d="M[\d.]+,([\d.]+) C[\d.]+,([\d.]+)/.exec(d) || [];
      assert.equal(y0, y1, d);
    }
    assert.match(one(page(chat).body, "tg-canvas").attrs.class, /\bis-across\b/, "kept for the chat");
    assert.doesNotMatch(one(page(chatOf("other", [turnWith(events(viewAfter(RUN)))])).body, "tg-canvas").attrs.class, /\bis-across\b/, "another chat opens top to bottom");
    turn(body, "down");
    assert.deepEqual(ways(body), ["down:true", "right:false"]);
    assert.ok(placed(body, "t1")[1] < placed(body, "t2")[1]);
  });

  // (fails before: yes — the order was the view's, swept six times, and it crossed what it crossed)
  test("Rearrange uncrosses what the view's order crossed and says so a moment; the order holds as tasks come; a second press says it found none clearer", () => {
    const chat = chatOf("knot", [turnWith(events(KNOT))]);
    /** @type {{ fn: () => void, ms: number }[]} */
    const timers = [];
    const { body, view } = page(chat, {}, { later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => void timers.push({ fn, ms }) });
    assert.ok(placed(body, "b")[0] < placed(body, "d")[0], "b between a and d");
    press(body, "Rearrange")?.dispatch("click");
    assert.ok(placed(body, "a")[0] < placed(body, "d")[0] && placed(body, "d")[0] < placed(body, "b")[0], "d beside a, b after them");
    assert.equal(textOf(one(body, "tg-arrange-said")), "Rearranged · no lines cross");
    assert.equal(one(body, "tg-arrange-said").attrs.role, "status");
    assert.deepEqual(one(body, "tg-canvas-bar").kids.map((/** @type {any} */ k) => k.attrs.class), ["tg-arrange-said", "tg-arrange", "tg-zoom"]);
    assert.deepEqual(timers.map((t) => t.ms), [4000]);
    timers.splice(0).forEach((t) => t.fn());
    assert.equal(textOf(one(body, "tg-arrange-said")), "", "said a moment");
    // (fails before: yes — the review of 11-14: the Plan hidden and shown again within the moment is a view made anew,
    // which the first one's timer never drew again: the words stood) A view made anew clears what is said in its time.
    press(body, "Rearrange")?.dispatch("click");
    timers.splice(0);
    const again0 = page(chat, {}, { later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => void timers.push({ fn, ms }) });
    assert.equal(textOf(one(again0.body, "tg-arrange-said")), "No clearer layout found");
    assert.deepEqual(timers.map((t) => t.ms), [4000]);
    timers.splice(0).forEach((t) => t.fn());
    assert.equal(textOf(one(again0.body, "tg-arrange-said")), "");
    // A task the agent adds goes in under what it needs; what was arranged stays as it is.
    chat.turns.push(turnWith(events(viewAfter([[{ action: "add", goal: "Knot", tasks: [
      { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C", needs: ["b"] }, { id: "d", name: "D" },
      { id: "e", name: "E", needs: ["a", "d"] }, { id: "f", name: "F", needs: ["c"] }, { id: "g", name: "G", needs: ["b"] }, { id: "h", name: "H", needs: ["c"] },
      { id: "i", name: "I", needs: ["d"] },
    ] }, T0]]))));
    view.paint();
    const xs = ["e", "i", "c", "g"].map((id) => placed(body, id)[0]);
    assert.deepEqual([...xs].sort((p, q) => p - q), xs, "e, i, c, g");
    assert.ok(placed(body, "d")[0] < placed(body, "b")[0], "the order holds");
    press(body, "Rearrange")?.dispatch("click");
    const again = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => placed(body, id).join());
    press(body, "Rearrange")?.dispatch("click");
    assert.equal(textOf(one(body, "tg-arrange-said")), "No clearer layout found");
    assert.deepEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => placed(body, id).join()), again, "nothing moved");
    // (fails before: yes — the review of 11-14: Copy plan listed each step in the view's order) Copy plan says each step
    // in the order the page draws.
    const kept = /\nStep 1\n- \[ \] a A — ready\n- \[ \] d D — ready\n- \[ \] b B — ready\n/;
    assert.match(planText(KNOT, null, null, boxesOf(KNOT.tasks, { keep: boxesOf(KNOT.tasks).order, thorough: true }).order), kept);
    assert.doesNotMatch(planText(KNOT), kept, "the view's order");
    const copied = /** @type {string[]} */ ([]);
    const was = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: (/** @type {string} */ s) => { copied.push(s); return new Promise(() => {}); } } } });
    try {
      buttonsOf(body).find((b) => b.attrs["aria-label"] === "Copy plan")?.dispatch("click");
    } finally {
      if (was) Object.defineProperty(globalThis, "navigator", was);
      else delete (/** @type {any} */ (globalThis)).navigator;
    }
    assert.match(copied[0] || "", kept, "the page's Copy plan");
    // A new plan in the chat, its ids the same: laid out afresh, the order kept for the graph it was found on.
    chat.turns.push(turnWith(events(viewAfter([[{ action: "add", goal: "Knot again", tasks: KNOT.tasks.map((/** @type {any} */ t) => ({ id: t.id, name: t.name, needs: t.needs })) }, T0 + 9000]]))));
    view.paint();
    assert.ok(placed(body, "b")[0] < placed(body, "d")[0], "b between a and d again");
  });

  test("what a Rearrange found, in few words", () => {
    const at = (/** @type {number} */ n, /** @type {string[][]} */ order) => ({ order, crossings: n });
    assert.deepEqual([
      rearrangeWords(at(3, [["a", "b"]]), at(1, [["b", "a"]])),
      rearrangeWords(at(2, [["a", "b"]]), at(1, [["b", "a"]])),
      rearrangeWords(at(2, [["a", "b"]]), at(0, [["b", "a"]])),
      rearrangeWords(at(0, [["a", "b"]]), at(0, [["b", "a"]])),
      rearrangeWords(at(1, [["a", "b"]]), at(1, [["a", "b"]])),
    ], ["Rearranged · 2 fewer crossings", "Rearranged · 1 fewer crossing", "Rearranged · no lines cross", "Rearranged · shorter lines", "No clearer layout found"]);
  });

  // (fails before: yes — the review of 11-14: turned, the canvas opened at its start and followed nothing, the task
  // chosen out of sight)
  test("turned, the canvas brings the task chosen into sight", () => {
    /** @type {any} */
    let port = null;
    const body = fakeH("div");
    /** The page's `h`, the canvas 358 × 200 at the page's top left, each box where its place, the zoom and the scroll put it. @type {any} */
    const laidH = (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
      const n = sizedH({ px: 400 })(tag, attrs, ...kids);
      if (attrs?.class === "pv-scroll") Object.assign(n, { clientHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 600 }) });
      if (attrs?.class === "tg-canvas-view") port = Object.assign(n, { clientWidth: 358, clientHeight: 200, getBoundingClientRect: () => ({ left: 0, top: 0, right: 358, bottom: 200 }) });
      if (attrs?.["data-id"])
        n.getBoundingClientRect = () => {
          const [x, y, w, hh] = (/left:([\d.]+)px;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px/.exec(String(n.attrs.style)) || []).slice(1).map(Number);
          const s = Number(/scale\(([\d.]+)\)/.exec(String(one(body, "tg-canvas")?.attrs.style || ""))?.[1] || 1);
          return { left: x * s - port.scrollLeft, right: (x + w) * s - port.scrollLeft, top: y * s - port.scrollTop, bottom: (y + hh) * s - port.scrollTop };
        };
      return n;
    };
    renderPlan(body, { chat: chatOf("turn-sight", [turnWith(events(fork(12)))]) }, { h: laidH, api: async () => null, now: () => NOW });
    boxOf(body, "a12").dispatch("click");
    turn(body, "right");
    const r = boxOf(body, "a12").getBoundingClientRect();
    assert.ok(r.top >= 0 && r.bottom <= 200 && r.left >= 0 && r.right <= 358, JSON.stringify(r));
  });

  test("beside the chat the steps run down a rail: no layout's buttons", () => {
    const { body } = page(chatOf("pane", [turnWith(events(KNOT))]), { pane: true });
    assert.deepEqual([byClass(body, "tg-arrange").length, byClass(body, "tg-canvas").length], [0, 0]);
  });
});
