// @ts-check
// The Plan tab's canvas moved by hand (the owner's of 11-07: "i should be able to pan around the task graph view,
// currently the hand gesture shows but pressing a moving doesn't do anything. also i should be able to zoom in and out
// with scroller"): a press and a move pan it both ways, past a slop that keeps a task's click its own; the canvas drawn
// anew mid-drag is the one moved; the page's draws held while it drags; the wheel zooms about the pointer. Since the
// owner's of 11-10 the canvas is a workspace that scrolls itself both ways: the page is left where it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAN_SLOP, armCanvas, wheelZoomOf, zoomAround } from "../src/ui/harness/views/canvas-pan.js";
import { ZOOM } from "../src/ui/harness/views/task-graph.js";
import { fakeH } from "./helpers/fake-dom.js";

// (fails before: yes — no wheel zoomed the canvas)
test("a turn of the wheel: toward you in, away out, within the zoom's bounds; a line's travel as its pixels", () => {
  assert.ok(wheelZoomOf(0.8, { deltaY: -100 }) > 0.95 && wheelZoomOf(0.8, { deltaY: -100 }) < 1, "a notch in: about a fifth");
  assert.ok(wheelZoomOf(0.8, { deltaY: 100 }) < 0.67 && wheelZoomOf(0.8, { deltaY: 100 }) > 0.6, "a notch out");
  assert.equal(wheelZoomOf(ZOOM.max, { deltaY: -500 }), ZOOM.max);
  assert.equal(wheelZoomOf(ZOOM.min, { deltaY: 500 }), ZOOM.min);
  assert.equal(wheelZoomOf(0.8, { deltaY: -3, deltaMode: 1 }), wheelZoomOf(0.8, { deltaY: -99 }), "three lines: 99 px");
  assert.equal(wheelZoomOf(0.8, { deltaY: 0 }), 0.8);
});

// (fails before: yes — no wheel zoomed the canvas; the owner's of 11-10: the canvas a workspace that scrolls itself
// both ways, its top no longer the page's to move)
test("zoomed about the pointer: the point under it stays under it, both ways in the canvas's own scroller", () => {
  // A drawing at 80% in a scroller panned 300 px across and 200 down.
  const view = { left: 100, top: 60 };
  const size = { left: view.left - 300, top: view.top - 200 };
  const [x, y] = [500, 300];
  const at = zoomAround({ z: 0.8, z2: 1, x, y, view, size });
  // Laid out anew at 100% with the scroller there: the drawing's point under the pointer is the same.
  const size2 = { left: view.left - at.left, top: view.top - at.top };
  assert.equal((x - size2.left) / 1, (x - size.left) / 0.8);
  assert.equal((y - size2.top) / 1, (y - size.top) / 0.8);
  // Out: the same point, at 50%.
  const out = zoomAround({ z: 0.8, z2: 0.5, x, y, view, size });
  assert.ok(Math.abs((x - (view.left - out.left)) / 0.5 - (x - size.left) / 0.8) < 1e-9);
  assert.ok(Math.abs((y - (view.top - out.top)) / 0.5 - (y - size.top) / 0.8) < 1e-9);
  // Never before the start.
  assert.deepEqual(zoomAround({ z: 0.8, z2: 0.25, x: 110, y: 70, view, size: { left: 100, top: 60 } }), { left: 0, top: 0 });
});

/** The canvas's stand-ins: the page's scroller, the canvas drawn now, where moves are heard, and what the page was asked. */
const stage = () => {
  /** @type {Record<string, Set<Function>>} */
  const heard = {};
  /** @type {Function[]} */
  const frames = [];
  const win = {
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => void (heard[t] ||= new Set()).add(f),
    removeEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => void heard[t]?.delete(f),
    requestAnimationFrame: (/** @type {Function} */ f) => void frames.push(f),
    fire: (/** @type {string} */ t, /** @type {any} */ e) => [...(heard[t] || [])].forEach((f) => f(e)),
    count: () => Object.values(heard).reduce((n, s) => n + s.size, 0),
    /** The next frame: what waited for it runs. */
    frame: () => frames.splice(0).forEach((f) => f()),
    frames,
  };
  const host = fakeH("div", { class: "pv-scroll" });
  host.scrollTop = 100;
  host.getBoundingClientRect = () => ({ left: 0, top: 50, width: 900, height: 700 });
  const drawView = () => {
    const v = fakeH("div", { class: "tg-canvas-view" });
    v.scrollLeft = 300;
    v.scrollTop = 200;
    v.clientWidth = 800;
    v.clientHeight = 600;
    v.getBoundingClientRect = () => ({ left: 100, top: 60, width: 800, height: 600 });
    v.querySelector = (/** @type {string} */ sel) => (sel === ".tg-canvas-size" ? { getBoundingClientRect: () => ({ left: 100 - v.scrollLeft, top: 60 - v.scrollTop, width: 1600, height: 900 }) } : null);
    return v;
  };
  const s = {
    win,
    host,
    view: drawView(),
    drawView,
    z: 0.8,
    /** @type {boolean[]} */
    holds: [],
    /** @type {{ z: number, at: { left: number, top: number } }[]} */
    zooms: [],
    moved: 0,
    /** @type {(() => void)[]} */
    soon: [],
  };
  armCanvas(host, {
    view: () => s.view,
    inCanvas: (t) => t?.inCanvas === true,
    zoom: () => s.z,
    setZoom: (z, at) => void s.zooms.push({ z, at }),
    hold: (on) => void s.holds.push(on),
    moved: () => void s.moved++,
    win,
    soon: (fn) => void s.soon.push(fn),
  });
  return s;
};
const ON = { inCanvas: true };
/** A click as the page hears it: whether it went on to the task under it. @param {any} host */
const click = (host) => {
  let stopped = false;
  host.dispatch("click", { stopPropagation: () => void (stopped = true) });
  return !stopped;
};

// (fails before: yes — the owner's of 11-07: a press and a move did nothing where the drawing fit sideways, nothing up
// and down ever, and the canvas drawn anew mid-drag — at each step of a task at work — left the drag on one gone)
test("a press and a move pan it both ways: past the slop alone, the canvas drawn now moved, the page's draws held until it ends", () => {
  const s = stage();
  let prevented = 0;
  s.host.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 400, clientY: 300, target: ON, preventDefault: () => void prevented++ });
  assert.equal(prevented, 1, "no words selected as it drags");
  s.win.fire("pointermove", { pointerId: 1, clientX: 400 + PAN_SLOP - 1, clientY: 300 });
  assert.deepEqual([s.view.scrollLeft, s.view.scrollTop, s.host.scrollTop, s.holds], [300, 200, 100, []], "under the slop: a press still");
  s.win.fire("pointermove", { pointerId: 1, clientX: 350, clientY: 260 });
  assert.deepEqual([s.view.scrollLeft, s.view.scrollTop, s.host.scrollTop, s.holds], [350, 240, 100, [true]], "both ways in its own scroller, the page left where it is; the draws held");
  assert.ok(s.host.classList.contains("is-panning"));
  s.win.fire("pointermove", { pointerId: 2, clientX: 0, clientY: 0 });
  assert.equal(s.view.scrollLeft, 350, "another pointer's move is not this drag's");
  // The canvas drawn anew mid-drag, where it was: the drag moves the new one.
  s.view = s.drawView();
  Object.assign(s.view, { scrollLeft: 350, scrollTop: 240 });
  s.win.fire("pointermove", { pointerId: 1, clientX: 300, clientY: 250 });
  assert.deepEqual([s.view.scrollLeft, s.view.scrollTop, s.host.scrollTop], [400, 250, 100]);
  s.win.fire("pointermove", { pointerId: 1, clientX: 900, clientY: 900 });
  assert.deepEqual([s.view.scrollLeft, s.view.scrollTop, s.host.scrollTop], [0, 0, 100], "no further than the start");
  s.win.fire("pointerup", { pointerId: 1 });
  assert.deepEqual(s.holds, [true, false], "the draws let go");
  assert.ok(!s.host.classList.contains("is-panning"));
  assert.equal(s.win.count(), 0, "nothing heard after it");
  assert.equal(click(s.host), false, "the click a drag ends in is the drag's");
  s.soon.forEach((f) => f());
  assert.equal(click(s.host), true, "the next is the task's");
  assert.ok(s.moved >= 3);
  // A drag that ends with no click (cancelled, let go off the window): the next click, a moment on, is the task's.
  s.soon.length = 0;
  s.host.dispatch("pointerdown", { button: 0, pointerId: 5, clientX: 400, clientY: 300, target: ON });
  s.win.fire("pointermove", { pointerId: 5, clientX: 380, clientY: 300 });
  s.win.fire("pointercancel", { pointerId: 5 });
  s.soon.forEach((f) => f());
  assert.equal(click(s.host), true, "a moment on, a click is the task's");
});

// (fails before: yes — the same)
test("a press that does not move is a press: its click is the task's; one off the canvas, or not the main button, pans nothing", () => {
  const s = stage();
  s.host.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 400, clientY: 300, target: ON });
  s.win.fire("pointermove", { pointerId: 1, clientX: 401, clientY: 301 });
  s.win.fire("pointerup", { pointerId: 1 });
  assert.deepEqual([s.holds, click(s.host)], [[], true]);
  for (const down of [{ button: 0, target: { inCanvas: false } }, { button: 2, target: ON }]) {
    s.host.dispatch("pointerdown", { pointerId: 3, clientX: 400, clientY: 300, ...down });
    s.win.fire("pointermove", { pointerId: 3, clientX: 200, clientY: 100 });
    assert.deepEqual([s.view.scrollLeft, s.host.scrollTop, s.holds], [300, 100, []]);
  }
  // The canvas's own scrollbar, under its inner box: its own — and a move of the person's (fails before: yes — the
  // review of d5aa58d31: its press went unheard, and the view's follow moved the canvas from where they scrolled it).
  const before = s.moved;
  s.host.dispatch("pointerdown", { button: 0, pointerId: 4, clientX: 400, clientY: 655, offsetX: 300, offsetY: 605, target: Object.assign(s.view, { inCanvas: true }) });
  s.win.fire("pointermove", { pointerId: 4, clientX: 200, clientY: 655 });
  assert.equal(s.view.scrollLeft, 300);
  assert.equal(s.moved, before + 1, "the person's own");
});

// (fails before: yes — the review of 67038d835, its 8: the canvas's scrollbar pressed held no draw, so the canvas drawn
// anew while it was dragged — at each step of a task at work — took the scrollbar from under the pointer)
test("the canvas's own scrollbar pressed holds the page's draws until it is let go, or the window is left; its click goes on", () => {
  const s = stage();
  const bar = () => ({ button: 0, clientX: 400, clientY: 655, offsetX: 300, offsetY: 605, target: Object.assign(s.view, { inCanvas: true }) });
  s.host.dispatch("pointerdown", { ...bar(), pointerId: 4 });
  assert.deepEqual([s.moved, s.holds], [1, [true]], "the person's own move; the draws held");
  s.win.fire("pointerup", { pointerId: 5 });
  assert.deepEqual(s.holds, [true], "another pointer's is not its own");
  s.win.fire("pointerup", { pointerId: 4 });
  assert.deepEqual([s.holds, s.win.count(), click(s.host)], [[true, false], 0, true]);
  s.host.dispatch("pointerdown", { ...bar(), pointerId: 6 });
  s.win.fire("blur", {});
  assert.deepEqual([s.holds, s.win.count()], [[true, false, true, false], 0]);
});

// (fails before: yes — the owner's of 11-07: the wheel over the canvas scrolled the page and zoomed nothing)
test("the wheel over the canvas zooms about the pointer, and scrolls nothing; off it, the page's own", () => {
  const s = stage();
  let prevented = 0;
  s.host.dispatch("wheel", { deltaY: -100, deltaMode: 0, clientX: 500, clientY: 400, target: ON, preventDefault: () => void prevented++ });
  assert.equal(prevented, 1);
  s.win.frame();
  assert.equal(s.zooms.length, 1);
  const { z, at } = s.zooms[0];
  assert.equal(z, wheelZoomOf(0.8, { deltaY: -100 }));
  assert.deepEqual(at, zoomAround({ z: 0.8, z2: z, x: 500, y: 400, view: { left: 100, top: 60 }, size: { left: -200, top: -140 } }));
  s.host.dispatch("wheel", { deltaY: -100, clientX: 500, clientY: 400, target: { inCanvas: false }, preventDefault: () => void prevented++ });
  s.win.frame();
  assert.deepEqual([prevented, s.zooms.length], [1, 1], "off the canvas: the page scrolls");
  s.z = ZOOM.max;
  s.host.dispatch("wheel", { deltaY: -100, clientX: 500, clientY: 400, target: ON, preventDefault: () => void prevented++ });
  s.win.frame();
  assert.deepEqual([prevented, s.zooms.length], [2, 1], "at its most: no zoom, and no scroll either");
});

// (fails before: yes — the review of 25e25a0e8: every wheel over the canvas was cancelled, and a sideways one zoomed
// nothing — a trackpad's swipe and Shift and the wheel moved it no more)
test("sideways, the wheel is the canvas's own scroll: a swipe, Shift and the wheel; mostly down, a zoom", () => {
  const s = stage();
  let prevented = 0;
  const wheel = (/** @type {any} */ e) => s.host.dispatch("wheel", { clientX: 500, clientY: 400, target: ON, preventDefault: () => void prevented++, ...e });
  wheel({ deltaX: 120, deltaY: 0 });
  wheel({ deltaX: -40, deltaY: 30 });
  wheel({ deltaX: 0, deltaY: -100, shiftKey: true });
  s.win.frame();
  assert.deepEqual([prevented, s.zooms.length], [0, 0], "the browser scrolls it sideways");
  wheel({ deltaX: 10, deltaY: -100 });
  s.win.frame();
  assert.deepEqual([prevented, s.zooms.length], [1, 1]);
});

// (fails before: yes — the review of 25e25a0e8: each turn drew the graph whole, a trackpad's sixty a second)
test("the wheel's turns in a frame are one zoom, about where the pointer was last; none while a press is under way", () => {
  const s = stage();
  let prevented = 0;
  const wheel = (/** @type {number} */ deltaY, /** @type {number} */ x) => s.host.dispatch("wheel", { deltaY, clientX: x, clientY: 400, target: ON, preventDefault: () => void prevented++ });
  wheel(-60, 480);
  wheel(-40, 500);
  wheel(-3, 500);
  assert.deepEqual([s.zooms.length, s.win.frames.length], [0, 1], "one frame waited for");
  s.win.frame();
  assert.equal(s.zooms.length, 1);
  assert.equal(s.zooms[0].z, wheelZoomOf(0.8, { deltaY: -103 }));
  assert.deepEqual(s.zooms[0].at, zoomAround({ z: 0.8, z2: s.zooms[0].z, x: 500, y: 400, view: { left: 100, top: 60 }, size: { left: -200, top: -140 } }));
  // A press under way: the wheel scrolls nothing and zooms nothing — the drag holds the draws, and moves from where it began.
  s.host.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 400, clientY: 300, target: ON });
  wheel(-100, 500);
  s.win.fire("pointerup", { pointerId: 1 });
  s.win.frame();
  assert.deepEqual([prevented, s.zooms.length], [4, 1], "turned mid-press, let go before its frame: still none");
  // Turns that wait for their frame as a press begins: none comes.
  wheel(-100, 500);
  s.host.dispatch("pointerdown", { button: 0, pointerId: 2, clientX: 400, clientY: 300, target: ON });
  s.win.frame();
  assert.equal(s.zooms.length, 1);
});

// (fails before: yes — the review of 25e25a0e8: a button let go in another window, Alt+Tab mid-drag, left the drag on —
// the page's draws held, the canvas following a mouse with no button down)
test("a drag whose pointerup never comes ends: a mouse moving with no button down, the window left", () => {
  const s = stage();
  const drag = (/** @type {number} */ id) => {
    s.host.dispatch("pointerdown", { button: 0, pointerId: id, pointerType: "mouse", clientX: 400, clientY: 300, target: ON });
    s.win.fire("pointermove", { pointerId: id, pointerType: "mouse", buttons: 1, clientX: 380, clientY: 300 });
  };
  drag(1);
  assert.deepEqual([s.view.scrollLeft, s.holds], [320, [true]]);
  s.win.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: 300, clientY: 300 });
  assert.deepEqual([s.view.scrollLeft, s.holds, s.win.count()], [320, [true, false], 0], "over: not moved, the draws let go");
  assert.ok(!s.host.classList.contains("is-panning"));
  drag(2);
  s.win.fire("blur", {});
  assert.deepEqual([s.holds, s.win.count()], [[true, false, true, false], 0]);
  // A press not yet a drag: the window left, nothing heard after it.
  s.host.dispatch("pointerdown", { button: 0, pointerId: 3, pointerType: "mouse", clientX: 400, clientY: 300, target: ON });
  s.win.fire("blur", {});
  assert.equal(s.win.count(), 0);
  // A pen's drag, its button held, pans.
  s.host.dispatch("pointerdown", { button: 0, pointerId: 4, pointerType: "pen", clientX: 400, clientY: 300, target: ON });
  s.win.fire("pointermove", { pointerId: 4, pointerType: "pen", buttons: 1, clientX: 360, clientY: 300 });
  assert.equal(s.view.scrollLeft, 340 + 40);
  s.win.fire("pointerup", { pointerId: 4 });
});

// (fails before: yes — the review of 25e25a0e8: a press's cancelled default gave no focus — a task pressed was not the
// one Tab and the menu key started from — and a finger's drag was pulled about by the script before the browser's own pan)
test("a press focuses what a press would, and lets go of a field's focus on the ground; a finger's drag is the browser's", () => {
  const s = stage();
  /** @type {any[]} */
  const focused = [];
  const task = { focus: (/** @type {any} */ o) => void focused.push(o) };
  s.host.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 400, clientY: 300, target: { inCanvas: true, closest: (/** @type {string} */ sel) => (sel.split(", ").includes("button") ? task : null) } });
  s.win.fire("pointerup", { pointerId: 1 });
  assert.deepEqual(focused, [{ preventScroll: true }], "the task, as pressed, without moving the page");
  let blurred = 0;
  s.host.ownerDocument = { activeElement: { blur: () => void blurred++ } };
  s.host.dispatch("pointerdown", { button: 0, pointerId: 2, clientX: 400, clientY: 300, target: { inCanvas: true, closest: () => null } });
  s.win.fire("pointerup", { pointerId: 2 });
  assert.deepEqual([focused.length, blurred], [1, 1], "the ground: the field let go");
  s.host.dispatch("pointerdown", { button: 0, pointerId: 3, pointerType: "touch", clientX: 400, clientY: 300, target: ON });
  s.win.fire("pointermove", { pointerId: 3, pointerType: "touch", clientX: 300, clientY: 200 });
  assert.deepEqual([s.view.scrollLeft, s.host.scrollTop, s.holds, s.win.count()], [300, 100, [], 0]);
});
