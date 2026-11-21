// @ts-check
// An answered card for sub-agents that change files stands where its agent asked, not under its turn (the owner's of
// 11-16: "these cards are now stuck at the end of the chat pushing the work above, the card can move up if it needs to
// make space"): one waiting stays after the turn, where its answer is asked for; answered, it is one line after the box
// of the round that ran when it was asked, and the work that came after stands below it.
// (fails before: yes — every card stood after its turn, the turn's later work drawn above it)
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { alignEvents, cardBoxes } from "../src/ui/harness/lib/labels.js";
import { createTimeline } from "../src/ui/harness/conversation/timeline.js";
import { heldActions } from "../src/ui/harness/conversation/held-launch.js";

/** The globals a drawn timeline reads that node lacks, put in for one test and taken out after. @returns {() => void} */
function pageGlobals() {
  const g = /** @type {any} */ (globalThis);
  const added = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
  return () => { for (const k of added) delete g[k]; };
}

const T0 = Date.UTC(2026, 10, 16, 9, 0);
/** A card asked at `at`, as the transcript's read carries it. @param {string} id @param {number} at */
const card = (id, at) => ({
  type: "held", afterTurn: 1, id, chainId: "c1", at, until: at + 60_000, left: 60_000, turn: 1, onTimeout: "accept", why: "",
  launches: [{ n: 1, description: `Fix ${id}`, kind: "builder", model: "m", where: "copy", declines: "" }],
  state: "waiting", by: null, answeredAt: null, started: [], failed: [],
});

test("an answered card stands after the round its agent asked in; one waiting stays under the turn", async () => {
  // A waiting card's clock ticks each second: the test's own, so nothing keeps running after it.
  mock.timers.enable({ apis: ["setInterval"] });
  const dom = stubDocument();
  const restore = pageGlobals();
  /** @type {Map<string, any>} */
  const heard = new Map();
  /** @type {Set<() => void>} */
  const watchers = new Set();
  Object.assign(heldActions, {
    view: (/** @type {string} */ _c, /** @type {string} */ id) => heard.get(id) || null,
    watch: (/** @type {() => void} */ fn) => (watchers.add(fn), () => watchers.delete(fn)),
  });
  try {
    const host = /** @type {any} */ (document.createElement("div"));
    document.body.append(host);
    const tl = createTimeline(host, /** @type {any} */ ({}));
    const aligned = alignEvents([
      { type: "round-start", round: 0, blocksBefore: 0 },
      { type: "tool-start", round: 0, id: "t1", name: "agent", args: { description: "Fix a" }, ts: T0 + 1_000 },
      { type: "tool-end", round: 0, id: "t1", ok: true },
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "tool-start", round: 1, id: "t2", name: "read", args: { path: "x.js" }, ts: T0 + 9_000 },
      { type: "tool-end", round: 1, id: "t2", ok: true },
    ]);
    const asked = card("a", T0 + 1_500);
    const later = card("b", T0 + 9_500);
    const turn = { n: 1, status: "done", past: false, runId: "r1", blocks: [{ type: "text", text: "Done." }], steers: [], segments: [], boundaries: [], boundariesAfter: [asked, later], aligned, startedAt: T0 };
    tl.render(/** @type {any} */ ({ chainId: "c1", turns: [turn], live: null }));
    await new Promise((r) => queueMicrotask(() => r(null)));
    const after = () => [...host.querySelectorAll(".boundaries .is-held")].map((/** @type {any} */ r) => r.querySelector(".hl-card")?.getAttribute("data-held"));
    const inTurn = () => turn.segments.filter((/** @type {any} */ s) => s.kind === "hold").map((/** @type {any} */ s) => [s.round, s.el.querySelector(".hl-card")?.getAttribute("data-held")]);
    assert.deepEqual(inTurn(), [], "waiting: none in the turn");
    assert.equal(host.querySelectorAll(".is-held").length, 2, "both under the turn while they wait");
    // The first is answered: it moves up, after round 0's box and before round 1's.
    heard.set("a", { hold: { ...asked, state: "accepted", by: "person", answeredAt: T0 + 3_000, started: ["sa_1"], launches: [{ ...asked.launches[0], agent: "sa_1" }] }, heard: Date.now() });
    for (const fn of [...watchers]) fn();
    tl.heldMoved();
    assert.deepEqual(inTurn(), [[0, "a"]], "answered: in the turn, at round 0");
    const segs = turn.segments.map((/** @type {any} */ s) => (s.kind === "cards" ? `cards:${s.round}` : s.kind));
    assert.ok(segs.indexOf("hold") > segs.indexOf("cards:0"), segs.join(" "));
    assert.ok(segs.includes("cards:1") && segs.indexOf("hold") < segs.indexOf("cards:1"), `before round 1's box: ${segs.join(" ")}`);
    assert.deepEqual(after(), ["b"], "the waiting one stays under the turn");
    const line = /** @type {any} */ (turn.segments.find((/** @type {any} */ s) => s.kind === "hold"))?.el;
    assert.ok(line.textContent.includes("Fix a (sa_1) — Accepted: started it"), line.textContent);
    assert.equal(line.querySelectorAll("button").length, 0, "one line, no press");
    // (fails before: yes — the review of fe6b8d579: a redraw made the answered card's row after the turn, then another in
    // it, and the first, never in the document, followed its card for the page's life)
    tl.render(/** @type {any} */ ({ chainId: "c1", turns: [turn], live: null }));
    await new Promise((r) => queueMicrotask(() => r(null)));
    for (const fn of [...watchers]) fn();
    assert.deepEqual(inTurn(), [[0, "a"]], "drawn again: still in the turn");
    assert.deepEqual(after(), ["b"]);
    assert.equal(watchers.size, 2, "one row a card, each following it");
  } finally {
    Object.assign(heldActions, { view: null, watch: null });
    mock.timers.reset();
    restore();
    dom.restore();
  }
});

// (fails before: yes — the review of this change: rounds with nothing said between them share one box, and a card asked
// in the first stood after the whole box, under calls made after it was asked)
test("a round a card was asked in ends its box, drawn or not", () => {
  const cellOf = (/** @type {number} */ r) => ({ round: r, tools: new Map(), order: [`t${r}`], plan: null, hooks: [], marks: [], reports: [], compactions: [], detaches: [], steers: [], snapshots: [], vetoed: 0, visuals: [], writing: new Map(), blocksBefore: 1 });
  const text = { kind: "block", block: { type: "text" } };
  const byRound = new Map([[1, cellOf(1)], [2, cellOf(2)], [3, cellOf(3)]]);
  assert.deepEqual(cardBoxes([text], byRound, [1, 2, 3], false), [[1, 2, 3]], "no card: one box");
  assert.deepEqual(cardBoxes([text], byRound, [1, 2, 3], false, [1]), [[1], [2, 3]]);
  assert.deepEqual(cardBoxes([text], byRound, [1, 3], false, [2]), [[1], [3]], "asked in a round that drew no box: no box spans it");
  assert.deepEqual(cardBoxes([text], byRound, [1, 2, 3], false, [3]), [[1, 2, 3]], "the last round's: nothing after it to part");
});
