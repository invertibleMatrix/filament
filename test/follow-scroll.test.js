// @ts-check
// The owner's word of 10-24: a running agent's thread in the Agents tab came back at its top after a tab switch. A box
// hidden behind another tab loses its scroll position, and the scroll event as it shows again is no reading upward:
// followScroll puts back the place you left — the end where you followed it, else where you were.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { followScroll } from "../src/ui/harness/lib/follow-scroll.js";

/** The ResizeObservers made, to fire by hand. @type {any[]} */
let observers = [];
const real = /** @type {any} */ (globalThis).ResizeObserver;
/** @type {any} */ (globalThis).ResizeObserver = class {
  /** @param {() => void} fn */
  constructor(fn) {
    this.fn = fn;
    this.on = false;
    observers.push(this);
  }
  observe() {
    this.on = true;
  }
  disconnect() {
    this.on = false;
  }
};
afterEach(() => {
  observers = [];
});
test.after(() => {
  /** @type {any} */ (globalThis).ResizeObserver = real;
});

/** A box that scrolls: its listeners, and the browser's moves of it. */
const box = () => {
  /** @type {Set<() => void>} */
  const ears = new Set();
  const el = {
    clientHeight: 400,
    scrollHeight: 2000,
    scrollTop: 1600,
    /** @param {string} _type @param {() => void} fn */
    addEventListener: (_type, fn) => void ears.add(fn),
    /** @param {string} _type @param {() => void} fn */
    removeEventListener: (_type, fn) => void ears.delete(fn),
    scroll: () => ears.forEach((fn) => fn()),
    ears,
  };
  return el;
};
/** The tab goes behind another: display:none, its place lost. @param {ReturnType<typeof box>} el */
const hide = (el) => {
  Object.assign(el, { clientHeight: 0, scrollHeight: 0, scrollTop: 0 });
  el.scroll();
  observers.forEach((o) => o.on && o.fn());
};
/** It shows again at its top: the browser's scroll event first, then its size. @param {ReturnType<typeof box>} el @param {number} [grown] */
const show = (el, grown = 0) => {
  Object.assign(el, { clientHeight: 400, scrollHeight: 2000 + grown, scrollTop: 0 });
  el.scroll();
  observers.forEach((o) => o.on && o.fn());
};

// (fails before: yes — the scroll as it showed again read as scrolling up, and the thread stayed at its top)
test("following the end: a tab switch comes back at the end, past what arrived meanwhile", () => {
  const el = box();
  const tail = { following: true };
  followScroll(/** @type {any} */ (el), tail);
  el.scroll();
  hide(el);
  assert.equal(tail.following, true, "hidden, nothing was read upward");
  show(el, 300);
  assert.deepEqual([tail.following, el.scrollTop], [true, 2300]);
});

test("reading higher up: it comes back where you were, and still not following", () => {
  const el = box();
  const tail = { following: true };
  followScroll(/** @type {any} */ (el), tail);
  el.scrollTop = 700;
  el.scroll();
  assert.equal(tail.following, false);
  hide(el);
  show(el);
  assert.deepEqual([tail.following, el.scrollTop], [false, 700]);
  // Back within the band of the end (the main transcript's 40 px): following again.
  el.scrollTop = 2000 - 400 - 40;
  el.scroll();
  assert.equal(tail.following, true);
});

// (fails before: yes — seen live 10-24: the thread drawn again on its tab's return stopped half way, 12,008 px of 23,970)
test("the view's own scroll to the end, told after more words came, is no reading upward; the end stays in sight", () => {
  const el = box();
  const tail = { following: true };
  followScroll(/** @type {any} */ (el), tail);
  // The view stuck to the end of 3,000 px; more words came before the browser told of that scroll.
  Object.assign(el, { scrollHeight: 3000, scrollTop: 2600 });
  Object.assign(el, { scrollHeight: 3500 });
  el.scroll();
  assert.equal(tail.following, true, "a scroll downward lets nothing go");
  // The words grew with no scroll of the view's: the box's size watcher keeps the end in sight.
  observers.forEach((o) => o.on && o.fn());
  assert.equal(el.scrollTop, 3500);
  // A scroll upward is still you reading.
  el.scrollTop = 1200;
  el.scroll();
  assert.equal(tail.following, false);
  Object.assign(el, { scrollHeight: 4000 });
  observers.forEach((o) => o.on && o.fn());
  assert.equal(el.scrollTop, 1200, "read higher up, the growing words move nothing");
});

test("a resize that is no showing again moves nothing; let go, the box is judged no more", () => {
  const el = box();
  const tail = { following: true };
  const letGo = followScroll(/** @type {any} */ (el), tail);
  el.scrollTop = 700;
  el.scroll();
  observers.forEach((o) => o.fn());
  assert.equal(el.scrollTop, 700);
  letGo();
  assert.deepEqual([el.ears.size, observers.every((o) => !o.on)], [0, true]);
  el.scrollTop = 1600;
  el.scroll();
  assert.equal(tail.following, false, "another thread's box now");
});
