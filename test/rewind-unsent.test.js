// @ts-check
// A row drawn as its send went, which turns out to be on no record (history.js `unsent`): the send waits for the chat,
// or a card stopped it before it was sent. Its user row is drawn once, as the send began; its Rewind goes when the row
// is known to be on no record — there is nothing of it to rewind.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {any} */
let tl;
/** @type {any} */
let host;
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
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  host = document.createElement("div");
  tl = createTimeline(host, /** @type {any} */ ({ onPauseChange() {}, onRewind() {}, onRetry() {}, onFork() {} }));
});
after(() => {
  for (const k of ADDED) delete g[k];
  dom.restore();
});

/** A chat whose newest turn is a send just begun, drawn. */
const sending = () => {
  const done = /** @type {any} */ ({ n: 1, status: "done", userText: "first", blocks: [{ type: "text", text: "ok" }], steers: [], segments: [], startedAt: Date.now() });
  const turn = /** @type {any} */ ({ n: 2, status: "streaming", userText: "next", blocks: [], steers: [], segments: [], startedAt: Date.now(), requestId: null });
  const live = /** @type {any} */ ({ turn, reply: { blocks: [], tailClosed: false }, blockHandles: [] });
  const chat = /** @type {any} */ ({ turns: [done, turn], live });
  live.chat = chat;
  tl.render(chat);
  tl.startLive(live);
  return { turn, live };
};
/** The rows' Rewind buttons, oldest first. */
const rewinds = () => host.querySelectorAll(".u-rewind").length;

// (fails before: yes — the review of 7884b1c14: the row kept its Rewind, which said "This message never went")
test("a send that waits for the chat: its row's Rewind goes as the waiting row's foot is drawn", () => {
  const { turn } = sending();
  assert.equal(rewinds(), 2, "while it goes, as any message");
  turn.status = "waiting";
  turn.waitingText = "Waiting — the move to another folder";
  tl.drawFoot(turn);
  assert.equal(rewinds(), 1, "the turn on record keeps its own");
});

// (fails before: yes — the review of 7884b1c14: the row a card stopped kept its Rewind)
test("a send a card stopped before it was sent: its row's Rewind goes as the send ends", async () => {
  const { turn, live } = sending();
  assert.equal(rewinds(), 2);
  turn.reply = { httpStatus: 409, errorBody: { needsCompaction: true, why: "past the line", sentTokens: 9 } };
  turn.error = "past the line";
  await tl.finish(live, "error");
  assert.equal(rewinds(), 1);
});
