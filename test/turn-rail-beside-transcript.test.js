// @ts-check
// The query-map rail stands beside the transcript alone (the owner's of 10-31: "we have this scroller on the left to
// shift the transcript around, it's length should not go below the composer"): it ran the chat frame's height, down
// beside the dock under the transcript. It stands from the transcript's top to where it ends, read as the "↓ latest"
// pill reads it, shows only while the pointer is near the left edge beside it, and a rail shorter than its ticks keeps
// the current turn's tick in sight.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
const g = /** @type {any} */ (globalThis);
const ADDED = ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "getComputedStyle", "localStorage", "sessionStorage"].filter((k) => !(k in g));
const hadResize = g.ResizeObserver;
/** Each ResizeObserver the page made, its callback and what it watches. @type {{ cb: Function, watched: any[] }[]} */
const observers = [];

before(() => {
  dom = stubDocument();
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver = class {
    /** @param {Function} cb */
    constructor(cb) {
      /** @type {any[]} */
      this.watched = [];
      observers.push({ cb, watched: this.watched });
    }
    /** @param {any} el */
    observe(el) { this.watched.push(el); }
    unobserve() {}
    disconnect() {}
  };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (dom.document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
});
after(() => {
  for (const k of ADDED) delete g[k];
  if (hadResize === undefined) delete g.ResizeObserver;
  else g.ResizeObserver = hadResize;
  dom.restore();
});

/** A chat's frame with its transcript laid out: 800px tall, a 40px band over the transcript and a 200px dock under it. */
async function laidOut() {
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  const host = /** @type {any} */ (document.createElement("div"));
  createTimeline(host, /** @type {any} */ ({}));
  const scroller = host.querySelector(".transcript");
  const rail = host.querySelector(".turn-nav");
  assert.ok(rail, "the rail");
  const watching = observers.find((o) => o.watched.includes(scroller));
  assert.ok(watching, "the transcript's box is watched");
  host.clientHeight = 800;
  scroller.offsetTop = 40;
  scroller.offsetHeight = 560;
  watching.cb([]);
  return { host, scroller, rail, watching };
}

// (fails before: yes — the rail stood from the frame's top to its foot, `top: 0; bottom: 0`, down beside the composer)
test("the rail stands from the transcript's top to where it ends, however tall the dock under it grows", async () => {
  const { scroller, rail, watching } = await laidOut();
  assert.equal(rail.style["--head-gap"], "40px");
  assert.equal(rail.style["--tail-gap"], "200px");
  // A long draft and the steer line: the dock grows to 290px, and the rail's foot rises with the transcript's end.
  scroller.offsetHeight = 470;
  watching.cb([]);
  assert.equal(rail.style["--tail-gap"], "290px");
  // The stylesheet stands the rail on them; without them, the frame's height as before.
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  const rule = /\n\.turn-nav \{([^}]*)\}/.exec(css)?.[1] || "";
  assert.match(rule, /top: var\(--head-gap, 0px\);/);
  assert.match(rule, /bottom: var\(--tail-gap, 0px\);/);
  assert.doesNotMatch(rule, /\b(top|bottom): 0;/);
});

// (fails before: yes — the pointer by the dock's left edge showed the rail as it did beside the transcript)
test("the rail shows only while the pointer is near the left edge beside the transcript, not by the dock or the band over it", async () => {
  const { host, rail } = await laidOut();
  host.getBoundingClientRect = () => ({ top: 100, left: 300, right: 1200, bottom: 900, width: 900, height: 800 });
  /** @param {number} x @param {number} y frame's own */
  const at = (x, y) => {
    host.dispatch("pointermove", { clientX: 300 + x, clientY: 100 + y });
    return rail.classList.contains("armed");
  };
  assert.equal(at(20, 300), true, "beside the transcript");
  assert.equal(at(20, 41), true, "at its top");
  assert.equal(at(20, 599), true, "just above where it ends");
  assert.equal(at(20, 700), false, "beside the dock");
  assert.equal(at(20, 20), false, "over the band above it");
  assert.equal(at(120, 300), false, "away from the edge");
  host.dispatch("pointerleave");
  assert.equal(rail.classList.contains("armed"), false);
});

// (fails before: yes — the ticks kept their scroll, and on a rail shorter than them the current turn's tick stood off its end)
test("a rail shorter than its ticks keeps the current turn's tick in sight", async () => {
  const { createNavigator } = await import("../src/ui/harness/conversation/navigator.js");
  const nav = createNavigator({ onJump: () => {}, previewOf: () => ({ query: "", answer: "" }) });
  nav.setCount(80);
  const ticks = /** @type {any} */ (nav.el.querySelector(".nav-ticks"));
  const marks = /** @type {any[]} */ (Array.from(nav.el.querySelectorAll(".nav-tick")));
  assert.equal(marks.length, 80);
  // The ticks shrink to fit the rail before its column scrolls, down to their 2px floor: eighty of them, 160px, on a
  // rail 100px tall — a laptop's transcript under a long draft.
  marks.forEach((m, i) => Object.assign(m, { offsetTop: i * 2, offsetHeight: 2 }));
  Object.assign(ticks, { clientHeight: 100, scrollTop: 0 });
  nav.setActive(79);
  assert.equal(ticks.scrollTop, 60, "the latest turn's tick at the rail's foot");
  nav.setActive(60);
  assert.equal(ticks.scrollTop, 60, "a tick in sight moves nothing");
  nav.setActive(3);
  assert.equal(ticks.scrollTop, 6, "an early turn's tick at the rail's top");
  // The dock grows and the rail shortens under the current tick: it rises into sight.
  nav.setActive(49);
  assert.equal(ticks.scrollTop, 6);
  ticks.clientHeight = 50;
  nav.place(40, 290);
  assert.equal(ticks.scrollTop, 50, "the current tick at the shorter rail's foot");
  assert.equal(nav.el.style["--tail-gap"], "290px");
});
