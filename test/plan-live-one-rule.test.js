// @ts-check
// The checklist's step in progress turns while the turn's work goes on (the owner's of 11-10), by one rule wherever it
// is drawn — the transcript's plan card and the status panel's Progress (the review of 67038d835, its 11: the card
// turned while its turn waited for the person, the panel's did not). The real timeline is drawn here, on the stub
// document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
/** @type {typeof import("../src/ui/harness/lib/labels.js").alignEvents} */
let alignEvents;
/** @type {typeof import("../src/ui/harness/lib/overview.js")} */
let overview;
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));

before(async () => {
  dom = stubDocument();
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (dom.document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
  ({ alignEvents } = await import("../src/ui/harness/lib/labels.js"));
  overview = await import("../src/ui/harness/lib/overview.js");
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/**
 * A chat whose turn keeps a checklist, its second step in progress, and this far: streaming, or ended paused for the
 * person's answer; a question of the agent's waiting or none.
 * @param {"streaming" | "paused"} status @param {boolean} asks
 */
const chatWith = (status, asks) => {
  const turn = /** @type {any} */ ({ n: 1, status, past: false, blocks: [], steers: [], segments: [], runId: "r1", startedAt: Date.now(), ...(status === "paused" ? { paused: true, facts: { startedAt: 1, endedAt: 2 } } : {}) });
  turn.aligned = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "plan", round: 1, items: [{ text: "Read the parser", status: "done" }, { text: "Fix it", status: "doing" }] },
    ...(asks ? [{ type: "ask", round: 1, id: "q1", runId: "r1", kind: "question", waits: true, form: { kind: "question", question: "Which file?", options: [] } }] : []),
  ]);
  const chat = /** @type {any} */ ({ turns: [turn], live: null });
  if (status === "streaming") {
    chat.live = { turn, reply: { blocks: [], tailClosed: false }, blockHandles: [], chat };
  }
  return chat;
};
/** The plan card's step in progress as drawn: whether it turns. @param {any} chat */
const cardTurns = (chat) => {
  tl.render(chat);
  if (chat.live) tl.startLive(chat.live);
  const ic = host.querySelector(".plan-ic.doing");
  assert.ok(ic, "the plan card's step in progress");
  return String(ic.className).split(/\s+/).includes("is-live");
};

// (fails before: yes — the transcript's card turned for a turn paused for the person's answer, and for one whose
// question waited, where the status panel's Progress stood still)
test("the plan card's step in progress turns while the turn's work goes on, still while the turn waits for the person — as the status panel's Progress", () => {
  /** status, asks; the card turns; it waits for the person (the rule both read); This turn's phase. */
  const rows = /** @type {[string, boolean, boolean, boolean, string][]} */ ([]);
  for (const [status, asks] of /** @type {["streaming" | "paused", boolean][]} */ ([["streaming", false], ["streaming", true], ["paused", false]])) {
    const chat = chatWith(status, asks);
    // The status panel's: its turn's phase, running alone turning (status-panel.js `planSection`).
    rows.push([status, asks, cardTurns(chat), overview.waitsForYou(chat.turns[0]), overview.turnNow(chat).phase]);
  }
  assert.deepEqual(rows, [
    ["streaming", false, true, false, "running"],
    ["streaming", true, false, true, "asks"],
    ["paused", false, false, true, "ended"],
  ]);
});
