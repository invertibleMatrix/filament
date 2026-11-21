// @ts-check
// The typing row as its room runs out (the owner's of 11-14, the composer on a narrow, upright screen, its pills run
// together over Send: "if there is no space then simply collapse the button into small button. for example this
// Permission one can be collapsed first. then the one to the right which is showing as weekly limit, then Context, then
// Model"): the row's pills never shrink under one another; while the row is wider than its room one more folds to its
// glyph, in that order, and they unfold the last folded first as room comes back; nothing folds while it all fits, and
// a folded chip keeps its name for a screen reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGAIN_MS, FOLDS, foldsNeeded, foldToFit, holds } from "../src/ui/harness/composer/bar-fit.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { createComposer } from "../src/ui/harness/composer/composer.js";

const g = /** @type {any} */ (globalThis);
const css = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), "utf8");

/** What each fold gives back, in pixels, and the row's whole width with nothing folded. */
const SAVES = { mode: 110, usage: 60, team: 50, context: 70, model: 120, effort: 40 };
const WHOLE = 700;

/** A ResizeObserver the test drives: what it watches, and a call of its callback. */
function watcher() {
  /** @type {any[]} */
  const made = [];
  class Observer {
    /** @param {() => void} cb */
    constructor(cb) {
      this.cb = cb;
      /** @type {any[]} */
      this.seen = [];
      this.off = false;
      made.push(this);
    }
    /** @param {any} el */
    observe(el) { this.seen.push(el); }
    disconnect() { this.off = true; }
  }
  return { Observer, made };
}

/**
 * Lays a row out as a browser would: its last part ends where its pills, less what its folds give back, end — past the
 * row's own edge where they are wider than its room; and what is drawn around a part (Stop's ring) counts in the row's
 * scrollWidth, 4 px past the row's edge, as a browser counts it.
 * @param {any} bar
 */
function laidOut(bar, room = WHOLE) {
  let width = room;
  const ends = () => WHOLE - FOLDS.reduce((s, f) => s + (bar.classList.contains(`fold-${f}`) ? SAVES[/** @type {keyof typeof SAVES} */ (f)] : 0), 0);
  bar.getBoundingClientRect = () => ({ left: 0, right: width, width });
  const parts = Array.from(bar.children);
  parts.forEach((p, i) => (p.getBoundingClientRect = () => (i === parts.length - 1 ? { left: ends() - 30, right: ends(), width: 30 } : { left: 0, right: 0, width: 0 })));
  Object.defineProperty(bar, "clientWidth", { get: () => width, configurable: true });
  Object.defineProperty(bar, "scrollWidth", { get: () => Math.max(width, ends()) + 4, configurable: true });
  return { resize: (/** @type {number} */ w) => void (width = w) };
}

/** A row's class list and its parts alone (a part to end it where it has none). @param {any[]} [children] */
function row(children = [{ part: "send" }]) {
  const cls = new Set();
  return { children, classList: { contains: (/** @type {string} */ c) => cls.has(c), add: (/** @type {string} */ c) => void cls.add(c), remove: (/** @type {string} */ c) => void cls.delete(c), toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => void (on ? cls.add(c) : cls.delete(c)) }, cls };
}
const folded = (/** @type {any} */ bar) => FOLDS.filter((f) => bar.classList.contains(`fold-${f}`));

test("the folds go in the owner's order: the permission, the plan's usage, the team, the Context, the model, the effort", () => {
  assert.deepEqual([...FOLDS], ["mode", "usage", "team", "context", "model", "effort"]);
  assert.equal(foldsNeeded(() => true), 0, "all of it fits: nothing folds");
  assert.equal(foldsNeeded((n) => n >= 2), 2, "the fewest that make it fit");
  assert.equal(foldsNeeded(() => false), FOLDS.length, "none fits: every fold");
});

test("the row folds one pill more each time it is short of room, and unfolds the last folded first as room comes back", () => {
  const { Observer, made } = watcher();
  const parts = [{ part: "mode" }, { part: "spring" }, { part: "send" }];
  const bar = row(parts);
  const room = laidOut(bar, 900);
  const fit = foldToFit(bar, { Observer });
  const resized = () => made[0].cb([{ target: bar }, ...parts.map((p) => ({ target: p }))]);
  assert.deepEqual(made[0].seen, [bar, ...parts], "it watches the row and each of its parts: a pill can grow where the spring has no room left to give");
  assert.deepEqual(folded(bar), [], "room enough: every pill whole");

  room.resize(650);
  resized();
  assert.deepEqual(folded(bar), ["mode"], "50 short: the permission folds first, alone");

  room.resize(500);
  resized();
  assert.deepEqual(folded(bar), ["mode", "usage", "team"], "200 short: the usage, then the team");

  room.resize(560);
  resized();
  assert.deepEqual(folded(bar), ["mode", "usage"], "room back: the team unfolds first");
  assert.equal(bar.classList.contains("is-squeezed"), false);

  room.resize(200);
  assert.equal(fit.fit(), FOLDS.length);
  assert.deepEqual(folded(bar), [...FOLDS]);
  assert.equal(bar.classList.contains("is-squeezed"), true, "past the last fold the widgets give way");

  room.resize(1000);
  resized();
  assert.deepEqual(folded(bar), []);
  assert.equal(bar.classList.contains("is-squeezed"), false, "and all of it comes back");

  fit.stop();
  assert.equal(made[0].off, true);
});

test("a turn running folds nothing where the pills fit: Stop's ring, drawn 4 px past the row's edge, is no part's box (the review of 11-14)", () => {
  const stop = { part: "stop" };
  const bar = row([{ part: "mode" }, { part: "spring" }, stop]);
  laidOut(bar, 900);
  assert.ok(bar.scrollWidth > bar.clientWidth + 1, "the row's scrollWidth counts the ring");
  assert.equal(holds(bar), true);
  assert.equal(foldToFit(bar, { Observer: undefined }).fit(), 0);
  assert.deepEqual(folded(bar), []);
  assert.equal(bar.classList.contains("is-squeezed"), false);
});

test("a part that moved alone is fitted at the next frame, the row's own resize at once: a fold moves its neighbours, which the observer would hand on as a loop", () => {
  const { Observer, made } = watcher();
  const parts = [{ part: "mode" }, { part: "slot" }, { part: "send" }];
  const bar = row(parts);
  const room = laidOut(bar, 900);
  /** @type {(() => void)[]} */
  const frames = [];
  foldToFit(bar, { Observer, frame: (fn) => frames.push(fn) });
  room.resize(650);
  made[0].cb([{ target: parts[1] }]);
  made[0].cb([{ target: parts[1] }]);
  assert.deepEqual(folded(bar), [], "not yet: it waits for the frame");
  assert.equal(frames.length, 1, "one frame asked for, however many moves came before it");
  frames[0]();
  assert.deepEqual(folded(bar), ["mode"]);
  room.resize(500);
  made[0].cb([{ target: bar }, { target: parts[1] }]);
  assert.deepEqual(folded(bar), ["mode", "usage", "team"], "the row resized: at once, before the page is painted");
  assert.equal(frames.length, 1);
});

test("a folded row whose words change fits again, once in AGAIN_MS however often they change: a hidden figure going down moves no size", () => {
  /** @type {any[]} */
  const watching = [];
  class Mutations {
    /** @param {() => void} cb */
    constructor(cb) { this.cb = cb; this.off = false; watching.push(this); }
    /** @param {any} el @param {any} what */
    observe(el, what) { this.el = el; this.what = what; }
    disconnect() { this.off = true; }
  }
  /** @type {[() => void, number][]} */
  const timers = [];
  const bar = row();
  const room = laidOut(bar, 900);
  const fit = foldToFit(bar, { Observer: undefined, Mutations, wait: (fn, ms) => timers.push([fn, ms]) });
  const [said] = watching;
  assert.equal(said.el, bar);
  assert.deepEqual(said.what, { subtree: true, childList: true, characterData: true }, "its words and parts, not its classes: a fit's folds are no change");
  said.cb();
  assert.equal(timers.length, 0, "nothing folded: a change that grows a pill moves its size, which the ResizeObserver hears");
  room.resize(500);
  fit.fit();
  assert.deepEqual(folded(bar), ["mode", "usage", "team"]);
  room.resize(900); // the words a fold hides went down: room again, and no size moved
  said.cb();
  said.cb();
  said.cb();
  assert.equal(timers.length, 1, "one fit asked for");
  assert.equal(timers[0][1], AGAIN_MS);
  assert.deepEqual(folded(bar), ["mode", "usage", "team"], "not at once");
  timers[0][0]();
  assert.deepEqual(folded(bar), [], "and they unfold");
  said.cb();
  assert.equal(timers.length, 1, "unfolded: nothing more to ask");
  fit.stop();
  assert.equal(said.off, true);
});

test("a row with no layout to read folds nothing, and one with no ResizeObserver still folds once", () => {
  const bar = row();
  assert.equal(foldToFit(bar, { Observer: undefined }).fit(), 0);
  assert.deepEqual(folded(bar), []);
  const narrow = row();
  laidOut(narrow, 600);
  foldToFit(narrow, { Observer: undefined });
  assert.deepEqual(folded(narrow), ["mode"]);
});

test("the composer folds its typing row by the room it finds: the row and its parts watched, a narrowing folds the permission", () => {
  const doc = stubDocument();
  const before = g.ResizeObserver;
  const { Observer, made } = watcher();
  g.ResizeObserver = Observer;
  try {
    const host = /** @type {any} */ (doc.document.createElement("div"));
    createComposer(host, { onSend: () => true, onStop: () => {}, getChat: () => ({ chainId: "c1", turns: [] }) });
    const bar = host.querySelector(".composer-bar");
    const watch = made.find((o) => o.seen.includes(bar));
    assert.ok(watch, "the row is watched");
    for (const part of ["grow", "widget-slot", "mode-chip", "model-chip", "effort"])
      assert.ok(watch.seen.some((/** @type {any} */ n) => n.classList.contains(part)), `and its ${part}`);
    assert.deepEqual(folded(bar), [], "not laid out yet: nothing folded");
    const room = laidOut(bar, 900);
    watch.cb([{ target: bar }]);
    assert.deepEqual(folded(bar), []);
    room.resize(640);
    watch.cb([{ target: bar }]);
    assert.deepEqual(folded(bar), ["mode"]);
  } finally {
    g.ResizeObserver = before;
    doc.restore();
  }
});

test("each fold hides what aqua.css says, a chip's name kept for a screen reader; the row's pills never shrink under one another", () => {
  const aqua = css("harness/aqua.css");
  assert.match(aqua, /\n\.composer-bar > :not\(\.grow\) \{ flex-shrink: 0; \}/, "each pill at its own width");
  // The two chips with no aria-label are named by their words: folded, the words leave the eye, not the reader.
  assert.match(aqua, /\.composer-bar\.fold-mode \.mode-chip \.mode-label, \.composer-bar\.fold-model \.model-chip \.model-name \{\n {2}position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\);/);
  const hidden = aqua.match(/\.composer-bar\.fold-mode \.mode-chip \.mode-caret,[^{]*\{ display: none; \}/)?.[0] || "";
  for (const part of [".composer-bar.fold-model .model-chip .mode-caret", ".composer-bar.fold-usage .widget-account :is(.inst-face-tag, .inst-face-text)", ".composer-bar.fold-team .widget-team .widget-value", ".composer-bar.fold-context .widget-context :is(.widget-label, .widget-more, .inst-face-text)", ".composer-bar.fold-effort .tune-chip :is(.tune-label, .tune-badge.is-window)"])
    assert.ok(hidden.includes(part), part);
  // Past the last fold the widgets give way, cut across alone: a focused pill's ring above and below stays whole.
  assert.match(aqua, /\n\.composer-bar\.is-squeezed \.widget-slot \{ flex-shrink: 1; overflow-x: clip; \}/);
  // The column's width no longer decides the row: the old breakpoints that ran its pills together are gone.
  assert.doesNotMatch(aqua, /@container composer \(max-width: 460px\)/);
  assert.doesNotMatch(aqua, /\.model-chip \{ max-width: 11rem; \}/);
  const base = css("harness.css");
  assert.doesNotMatch(base, /\.mode-chip \.mode-label, \.effort-btn \.effort-label \{ display: none; \}/);
  assert.doesNotMatch(base, /\.model-chip \{ max-width: 10rem; min-width: 88px; \}/);
});
