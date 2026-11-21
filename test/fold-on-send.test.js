// @ts-check
// A finished turn's work fold stays open until the chat's next turn starts (the Designer's recommendation, the owner's
// yes of 10-27): it used to close 300 ms after the turn ended, so the last steps vanished under the reader's eyes. One
// the reader opened or closed by hand stays as they left it, through the next turn too. The real timeline is drawn
// here, on the stub document, with timers that run.
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
/** The page's timers, run when the test says time has passed. @type {(() => void)[]} */
const timers = [];
const runTimers = () => { for (const f of timers.splice(0)) f(); };

before(async () => {
  dom = stubDocument();
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: (/** @type {() => void} */ f) => { timers.push(f); return timers.length; }, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
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

/** A running turn n, one command in. @param {number} n */
const runningTurn = (n) => {
  const turn = /** @type {any} */ ({ n, status: "streaming", past: false, blocks: [], steers: [], segments: [], runId: `r${n}`, startedAt: Date.now() });
  turn.aligned = alignEvents([
    { type: "round-start", round: 1, blocksBefore: 0 },
    { type: "tool-start", round: 1, name: "bash", args: "npm test", id: `t${n}`, input: { command: "npm test" } },
    { type: "tool-end", round: 1, name: "bash", ok: true, ms: 40, id: `t${n}`, chars: 2, preview: "ok" },
    { type: "round-start", round: 2, blocksBefore: 1 },
  ]);
  return turn;
};
/** A chat whose turn 1 runs. */
const running = () => {
  const turn = runningTurn(1);
  const live = /** @type {any} */ ({ turn, reply: { blocks: [{ type: "text", text: "Ran it." }], tailClosed: false }, blockHandles: [] });
  const chat = /** @type {any} */ ({ turns: [turn], live });
  live.chat = chat;
  return { turn, live, chat };
};
/** The next Send: turn 2 starts in the chat. @param {any} chat */
const send = (chat) => {
  const turn = runningTurn(2);
  const live = /** @type {any} */ ({ turn, reply: { blocks: [], tailClosed: false }, blockHandles: [], chat });
  chat.turns.push(turn);
  chat.live = live;
  tl.startTurn(turn);
  tl.startLive(live);
};
/** The work folds as drawn now, oldest first. */
const folds = () => host.querySelectorAll("details.work-fold");
/** A click on turn i's fold header, as the browser gives it: the click first, then the fold toggles. @param {number} i */
const clickHeader = (i) => {
  const det = folds()[i];
  det.querySelector("summary").dispatch("click");
  det.open = !det.open;
};

// (fails before: yes — the fold closed 300 ms after the turn ended, and was drawn closed when the chat was drawn again)
test("a finished turn's fold stays open after it ends and when the chat is drawn again; the next Send folds it", async () => {
  const { live, chat } = running();
  tl.render(chat);
  tl.startLive(live);
  assert.equal(folds()[0].open, true, "a running turn's work is open");
  await tl.finish(live, "done");
  runTimers();
  assert.equal(folds()[0].open, true, "the turn ended and time passed: its work is still open");
  chat.live = null;
  tl.render(chat);
  assert.equal(folds()[0].open, true, "the chat drawn again before the next Send: still open");
  send(chat);
  assert.equal(folds()[0].open, false, "the next Send folds the finished turn's work");
  chat.live = null;
  chat.turns[1].status = "done";
  tl.render(chat);
  assert.equal(folds()[0].open, false, "and it stays folded when the chat is drawn again");
});

test("a fold the reader opened or closed by hand stays as they left it through the next Send", async () => {
  const { live, chat } = running();
  tl.render(chat);
  tl.startLive(live);
  clickHeader(0);
  assert.equal(folds()[0].open, false, "closed by hand while it ran");
  await tl.finish(live, "done");
  runTimers();
  assert.equal(folds()[0].open, false, "closed at its end");
  clickHeader(0);
  assert.equal(folds()[0].open, true, "opened by hand after its end");
  send(chat);
  assert.equal(folds()[0].open, true, "the next Send leaves the fold the reader opened");
});
