// @ts-check
// A work fold the reader closed while the turn ran stays closed when the turn ends (the Designer's read of 10-27, asked
// about the fold that "folds back in a jerk like motion"). A click on the fold's header held it whichever way it went, and
// a held fold was drawn open: the one the reader had closed sprang open at the turn's end, a screen of work pushed in
// under them, and again at every redraw of the chat. The real timeline is drawn here, on the stub document.
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

/** A running turn one command in. */
const running = () => {
  const turn = /** @type {any} */ ({ n: 1, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: "r1", startedAt: Date.now() });
  turn.aligned = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "tool-start", round: 1, name: "bash", args: "npm test", id: "t1", input: { command: "npm test" } },
    { type: "tool-end", round: 1, name: "bash", ok: true, ms: 40, id: "t1", chars: 2, preview: "ok" },
    { type: "round-start", round: 2, blocksBefore: 1 },
  ]);
  const live = /** @type {any} */ ({ turn, reply: { blocks: [{ type: "text", text: "Ran it." }], tailClosed: false }, blockHandles: [] });
  const chat = { turns: [turn], live };
  live.chat = chat;
  return { turn, live, chat };
};
/** The turn's work fold, as drawn now. */
const fold = () => host.querySelector("details.work-fold");
/** A click on the fold's header, as the browser gives it: the click first, then the fold toggles. */
const clickHeader = () => {
  const det = fold();
  det.querySelector("summary").dispatch("click");
  det.open = !det.open;
};

// (fails before: yes — the fold the reader closed was drawn open at the turn's end, and at the next render)
test("a work fold closed by hand while the turn runs stays closed at the turn's end and when the chat is drawn again", async () => {
  const { live, chat } = running();
  tl.render(chat);
  tl.startLive(live);
  assert.equal(fold().open, true, "a running turn's work is open");
  clickHeader();
  assert.equal(fold().open, false, "the reader closes it");
  await tl.finish(live, "done");
  assert.equal(fold().open, false, "the turn ends: it stays as the reader left it");
  chat.live = null;
  tl.render(chat);
  assert.equal(fold().open, false, "the chat drawn again: still closed");
});

test("a finished turn's fold opened by hand stays open when the chat is drawn again, and closed again stays closed", () => {
  const { turn, chat } = running();
  turn.status = "done";
  chat.live = null;
  tl.render(chat);
  assert.equal(fold().open, false, "a finished turn's work is folded");
  clickHeader();
  tl.render(chat);
  assert.equal(fold().open, true, "opened by hand, drawn again open");
  clickHeader();
  tl.render(chat);
  assert.equal(fold().open, false, "closed again by hand, drawn again closed");
});
