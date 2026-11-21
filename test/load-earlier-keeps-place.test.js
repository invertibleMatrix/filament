// @ts-check
// Load earlier keeps the reader's place (the Hunters' pass of 10-27 over the transcript). It drew the chat again, and
// a full render opens a chat on its latest turn: the reader who asked for the turns above was thrown to the bottom.
// The real timeline is drawn here, on the stub document, with a layout of its own: each turn 100 px below the last.
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
/** @type {any} */
let proto;
/** @type {any} */
let rectWas;

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
  tl = createTimeline(host, /** @type {any} */ ({}));
  // The layout: the scroller's top at 0; a turn's row at 100 px a turn, less how far the scroller is scrolled.
  const scroller = host.querySelector(".transcript");
  proto = Object.getPrototypeOf(scroller);
  rectWas = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    const n = this.getAttribute?.("data-turn");
    const top = this === scroller || n == null ? 0 : Number(n) * 100 - Number(scroller.scrollTop || 0);
    return { top, left: 0, right: 0, bottom: top, width: 0, height: 0 };
  };
  scroller.scrollHeight = 7000;
});
after(() => {
  if (proto) proto.getBoundingClientRect = rectWas;
  for (const k of ADDED) delete g[k];
  dom.restore();
});

// (fails before: yes — the scroller went to the bottom, 7,000, and followed the latest turn again)
test("Load earlier draws the turns above and leaves the reader where they were", () => {
  const turns = Array.from({ length: 70 }, (_, i) => /** @type {any} */ ({ n: i + 1, status: "done", past: false, blocks: [{ type: "text", text: `turn ${i + 1}` }], steers: [], segments: [], startedAt: Date.now() }));
  const chat = /** @type {any} */ ({ turns, live: null });
  tl.render(chat);
  const scroller = host.querySelector(".transcript");
  const button = host.querySelector(".load-earlier");
  assert.match(button.textContent, /Load earlier messages \(10\)/, "the first 10 of 70 wait above");
  // The reader scrolls up to the top of what is shown, and lets go of the latest turn.
  scroller.scrollTop = 1150;
  chat.following = false;
  button.onclick();
  assert.equal(host.querySelectorAll("section.turn").length, 70, "the earlier turns are drawn");
  assert.equal(scroller.scrollTop, 1150, "the turn that was first on the screen is where it was");
  assert.equal(chat.following, false, "and the chat does not follow its latest turn");
});

// (fails before: yes — every full render of the chat on the screen threw the reader to the bottom, following again: a
// followed turn's end, and the catch-up that reads another window's turn every two seconds)
test("the chat on the screen drawn again keeps its reader's place; one who follows the latest turn stays with it", () => {
  const turns = Array.from({ length: 30 }, (_, i) => /** @type {any} */ ({ n: i + 1, status: "done", past: false, blocks: [{ type: "text", text: `turn ${i + 1}` }], steers: [], segments: [], startedAt: Date.now() }));
  const chat = /** @type {any} */ ({ turns, live: null });
  tl.render(chat);
  const scroller = host.querySelector(".transcript");
  assert.equal(scroller.scrollTop, 7000, "a chat opens on its latest turn");
  scroller.scrollTop = 900;
  chat.following = false;
  tl.render(chat);
  assert.equal(scroller.scrollTop, 900, "the reader who scrolled up is left where they read");
  assert.equal(chat.following, false);
  chat.following = true;
  tl.render(chat);
  assert.equal(scroller.scrollTop, 7000, "the one who follows stays at the latest turn");
  const other = /** @type {any} */ ({ turns: turns.slice(0, 3).map((t) => ({ ...t, segments: [] })), live: null, following: false });
  tl.render(other);
  assert.deepEqual([scroller.scrollTop, other.following], [7000, true], "another chat opens on its latest turn, following it");
});
