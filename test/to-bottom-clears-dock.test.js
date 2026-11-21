// @ts-check
// The "↓ latest" pill clears the composer (the owner's of 10-31: "when i scroll the transcript and new text arrives the
// latest is overlapping the composer"): it stood a fixed 148px up the chat's frame, and the dock under the transcript —
// the composer, a long draft, the steer line, a card that asks — is often taller. It stands just above where the
// transcript ends, read again whenever the transcript's box changes.
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

// (fails before: yes — the pill stood 148px up the frame whatever the dock's height: over a 200px dock, on the composer)
test("the pill stands just above where the transcript ends, however tall the dock under it grows", async () => {
  const { createTimeline } = await import("../src/ui/harness/conversation/timeline.js");
  const host = /** @type {any} */ (document.createElement("div"));
  createTimeline(host, /** @type {any} */ ({}));
  const scroller = host.querySelector(".transcript");
  const pill = host.querySelector(".to-bottom");
  assert.ok(pill, "the pill");
  const watching = observers.find((o) => o.watched.includes(scroller));
  assert.ok(watching, "the transcript's box is watched");
  // The frame 800px tall, the transcript from its top to 600px: the dock and its margin take the 200px under it.
  host.clientHeight = 800;
  scroller.offsetTop = 0;
  scroller.offsetHeight = 600;
  watching.cb([]);
  assert.equal(pill.style["--tail-gap"], "200px");
  // A long draft and the steer line: the dock grows to 290px, the transcript's box shrinks under a status panel.
  scroller.offsetTop = 40;
  scroller.offsetHeight = 470;
  watching.cb([]);
  assert.equal(pill.style["--tail-gap"], "290px");
  // On the pill alone: set on the frame, each line of a draft restyled the whole transcript under it (the review of 10-31).
  assert.equal(host.style["--tail-gap"], undefined);
  // The stylesheet stands the pill on it, 12px up; without it, where it stood before.
  const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
  const rule = /\n\.to-bottom \{([^}]*)\}/.exec(css)?.[1] || "";
  assert.match(rule, /bottom: calc\(var\(--tail-gap, 136px\) \+ 12px\)/);
});
