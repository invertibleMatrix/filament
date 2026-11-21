// @ts-check
// A new chat's first turn draws in the transcript's own column (the owner's report of 10-29: in a fresh session the
// Working line stood to the right of the turn's rows until Filament was opened again). The empty chat's Start board
// widens the column (`.transcript-inner.draft`, 1024px); the live line's tail keeps 896px, both centred — so a column
// still marked draft once its first turn started put the line up to 64px off. The real timeline is drawn here, on the
// stub document.
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
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** Whether the transcript's column is the empty chat's wider one. */
const wide = () => host.querySelector(".transcript-inner").classList.contains("draft");

// (fails before: yes — startTurn hid the Start board and left the column marked draft until the chat was drawn again)
test("the first Send of a new chat gives the column back its width, as drawing the chat again does", () => {
  const chat = /** @type {any} */ ({ turns: [] });
  tl.render(chat);
  assert.equal(wide(), true, "the empty chat's Start board is drawn in the wider column");
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r1", startedAt: Date.now() });
  turn.aligned = alignEvents([{ type: "round-start", round: 1, blocksBefore: 0 }]);
  const live = /** @type {any} */ ({ turn, reply: { blocks: [], tailClosed: false }, blockHandles: [], chat });
  chat.turns.push(turn);
  chat.live = live;
  tl.startTurn(turn);
  tl.startLive(live);
  assert.equal(wide(), false, "the running turn is drawn in the column the live line shares");
  tl.render(chat);
  assert.equal(wide(), false, "and drawing the chat again agrees");
});
