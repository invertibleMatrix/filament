// @ts-check
// The first-run tips on the page (coach/coach.js, the owner's FTUE of 11-09, Product's review the same day): a bubble
// beside one control at a time, when its moment comes — on, unseen, after its own, its condition holding, its control in
// sight twice running; a group's tips in a row, counted among those still to see; the page dimmed behind it (the owner's
// of 11-09); Got it, Next or a click on its control says it seen, and so do a click elsewhere, typing and Esc, which put
// the rest of its row aside; Skip tips says every tip seen; covered, gone or scrolled away, or a menu open, it waits.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {typeof import("../src/ui/harness/coach/coach.js")} */
let C;
/** @type {ReturnType<typeof stubDocument>} */
let stub;
before(async () => {
  stub = stubDocument();
  C = await import("../src/ui/harness/coach/coach.js");
});
after(() => stub.restore());
beforeEach(() => stub.document.body.replaceChildren());

const text = (/** @type {any} */ el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
const bubble = () => /** @type {any} */ (stub.document.body.querySelector(".coach"));

/**
 * A page of controls, each at a box, and a coach over it: what it asked the route, the toasts, its looks, whether it
 * looks, what covers the page, and the window's listeners.
 * @param {any} answer  GET /coach's
 */
function page(answer) {
  /** @type {any[]} */
  const calls = [];
  /** @type {string[]} */
  const toasts = [];
  /** @type {Set<any>} */
  const covered = new Set();
  /** @type {(() => void)[]} */
  const queued = [];
  /** @type {Record<string, Function[]>} */
  const winOn = {};
  /** @type {Record<string, Function[]>} */
  const docOn = {};
  let looking = false;
  let clock = 0;
  const overlay = stub.document.createElement("div");
  /** @type {any[]} */
  const controls = [];
  /** A control on the page at a box. @param {string} cls @param {{ top: number, left: number, width: number, height: number }} box */
  const control = (cls, box) => {
    const el = /** @type {any} */ (stub.document.createElement("button"));
    el.className = cls;
    el.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height });
    el.scrolled = 0;
    el.scrollIntoView = () => void el.scrolled++;
    stub.document.body.append(el);
    controls.push(el);
    return el;
  };
  const doc = {
    get body() {
      return stub.document.body;
    },
    documentElement: stub.document.documentElement,
    querySelector: (/** @type {string} */ s) => stub.document.querySelector(s),
    querySelectorAll: (/** @type {string} */ s) => stub.document.querySelectorAll(s),
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => void (docOn[t] ||= []).push(fn),
    removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => void (docOn[t] = (docOn[t] || []).filter((f) => f !== fn)),
  };
  const win = {
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => void (winOn[t] ||= []).push(fn),
    removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => void (winOn[t] = (winOn[t] || []).filter((f) => f !== fn)),
  };
  const coach = C.createCoach(
    {
      api: async (path, o) => {
        calls.push({ path, ...(o?.body ? { body: o.body } : {}) });
        if (path === "/coach") return typeof answer === "function" ? answer() : answer;
        return {};
      },
      onToast: (m) => void toasts.push(m),
      skipWords: () => "Tips are off.",
    },
    {
      doc,
      win,
      every: () => ((looking = true), 1),
      stopEvery: () => void (looking = false),
      later: (fn) => void queued.push(fn),
      frame: (fn) => fn(),
      now: () => clock,
      view: () => ({ width: 1440, height: 900 }),
      // The topmost element at a point: a control whose box holds it, unless something covers it.
      hitAt: (x, y) => {
        const el = controls.find((c) => {
          const r = c.getBoundingClientRect();
          return c.isConnected && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
        });
        return el && covered.has(el) ? overlay : el || null;
      },
    },
  );
  return {
    coach, calls, toasts, covered, control, winOn, docOn,
    looking: () => looking,
    /** The seen ids posted, in order. */
    posted: () => calls.filter((c) => c.path === "/coach/seen").flatMap((c) => c.body.ids),
    flush: () => { for (const fn of queued.splice(0)) fn(); },
    /** Time goes on, ms. @param {number} ms */
    tick: (ms) => void (clock += ms),
  };
}

const tip = (/** @type {Partial<import("../src/ui/harness/coach/coach.js").Tip> & { id: string }} */ t) => ({ enabled: true, group: "", target: `.${t.id}`, when: "", after: "", place: "bottom", title: `Title ${t.id}`, text: `Words ${t.id}`, ...t });

// (fails before: yes — there was no coach)
test("a bubble stands on the side asked, the other where that has no room, inside the window, its arrow at the control", () => {
  const view = { width: 1000, height: 800 };
  const b = { width: 280, height: 120 };
  assert.deepEqual(C.placeBubble({ top: 100, left: 400, width: 100, height: 30 }, b, "bottom", view), { side: "bottom", top: 142, left: 310, arrow: 140 });
  // No room below: above it.
  assert.deepEqual(C.placeBubble({ top: 700, left: 400, width: 100, height: 30 }, b, "bottom", view), { side: "top", top: 568, left: 310, arrow: 140 });
  // At the window's left edge: kept in, the arrow still at the control's middle.
  assert.deepEqual(C.placeBubble({ top: 100, left: 0, width: 40, height: 30 }, b, "bottom", view), { side: "bottom", top: 142, left: 8, arrow: 16 });
  // Left asked with no room to the left: on its right.
  const r = C.placeBubble({ top: 300, left: 20, width: 40, height: 40 }, b, "left", view);
  assert.deepEqual(r, { side: "right", top: 260, left: 72, arrow: 60 });
  assert.equal(C.placeBubble({ top: 300, left: 600, width: 40, height: 40 }, b, "left", view).side, "left");
  // (fails before: yes — the live look of 11-09: beside a tall card low in the window, the bubble stood at the card's
  // middle, over the message box) Beside a tall control, at its head.
  assert.deepEqual(C.placeBubble({ top: 500, left: 600, width: 380, height: 500 }, b, "left", view), { side: "left", top: 468, left: 308, arrow: 60 });
});

// (fails before: yes — the review of 11-09: a tip switched off held back the one after it for good; a tip on screen
// stayed once its moment passed; Esc was taken from a sheet and from an input method's word)
test("a tip switched off holds none back; one whose moment passed hides, unseen; Esc is a sheet's and an input method's", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "tab", enabled: false }), tip({ id: "gear", after: "tab" }), tip({ id: "agents", when: "subagent" })] });
  let agents = 0;
  p.coach.when("subagent", () => agents > 0);
  p.control("gear", { top: 100, left: 100, width: 40, height: 40 });
  p.control("agents", { top: 300, left: 100, width: 80, height: 30 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "gear", "its tab's tip is off: the gear's shows");
  // Esc while a sheet is open, or while an input method composes, is theirs.
  const sheet = stub.document.createElement("div");
  sheet.setAttribute("aria-modal", "true");
  stub.document.body.append(sheet);
  let taken = 0;
  const esc = (/** @type {any} */ more = {}) => { for (const fn of p.winOn.keydown || []) fn({ key: "Escape", preventDefault: () => void taken++, stopImmediatePropagation() {}, ...more }); };
  esc();
  assert.deepEqual([taken, p.coach.shown()], [0, "gear"], "the sheet's Esc");
  sheet.remove();
  esc({ isComposing: true });
  assert.deepEqual([taken, p.coach.shown()], [0, "gear"], "the input method's Esc");
  esc();
  assert.deepEqual([taken, p.coach.shown(), p.posted()], [1, "", ["gear"]]);
  // A moment that passes while its tip shows: hidden, unseen; back, it shows again.
  agents = 1;
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "agents");
  agents = 0;
  p.coach.look();
  assert.deepEqual([p.coach.shown(), p.posted()], ["", ["gear"]]);
  agents = 1;
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "agents");
});

// (fails before: yes — the live look of 11-09: Next left a card whose head showed under the message box where it was)
test("Next scrolls the next control to the window's middle when only its head shows low in the window", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "one", group: "g" }), tip({ id: "low", group: "g", place: "left" })] });
  p.control("one", { top: 100, left: 600, width: 120, height: 30 });
  const low = p.control("low", { top: 640, left: 600, width: 400, height: 500 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  bubble().querySelector(".coach-next").dispatch("click");
  assert.equal(low.scrolled, 1, "in sight at its head, but low: scrolled");
});

// (fails before: yes)
test("a tip shows once its control is in sight two looks running; never while its condition fails, before its own, or switched off", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "a" }), tip({ id: "b", when: "subagent" }), tip({ id: "c", after: "b" }), tip({ id: "d", enabled: false }), tip({ id: "e", when: "nothing-names-it" })] });
  let agents = 0;
  p.coach.when("subagent", () => agents > 0);
  for (const [i, id] of ["b", "c", "d", "e"].entries()) p.control(id, { top: 300 + i * 100, left: 100, width: 80, height: 30 });
  await p.coach.start();
  assert.ok(p.looking(), "it looks while a tip is still to see");
  p.coach.look();
  assert.equal(bubble(), null, "a's control is not on the page");
  const a = p.control("a", { top: 100, left: 100, width: 80, height: 30 });
  p.coach.look();
  assert.equal(bubble(), null, "found once: a screen that flashes by shows none");
  p.coach.look();
  assert.equal(p.coach.shown(), "a");
  assert.equal(text(bubble().querySelector(".coach-title")), "Title a");
  assert.equal(text(bubble().querySelector(".coach-text")), "Words a");
  assert.equal(bubble().querySelector(".coach-count"), null, "a tip alone has no count");
  assert.equal(text(bubble().querySelector(".coach-next")), "Got it");
  assert.equal(bubble().getAttribute("data-side"), "bottom");
  assert.equal(bubble().style.top, "142px");
  const ring = /** @type {any} */ (stub.document.body.querySelector(".coach-ring"));
  assert.deepEqual([ring.style.top, ring.style.left, ring.style.width, ring.style.height], ["96px", "96px", "88px", "38px"]);
  bubble().querySelector(".coach-next").dispatch("click");
  assert.equal(bubble(), null);
  assert.deepEqual(p.posted(), ["a"]);
  assert.ok(a.isConnected);
  // b waits for its condition, c for b, d is off, e's condition is no page's.
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "");
  agents = 1;
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "b");
  // Esc closes it before the message box hears it.
  let stopped = 0;
  let prevented = 0;
  for (const fn of p.winOn.keydown || []) fn({ key: "Escape", preventDefault: () => void prevented++, stopImmediatePropagation: () => void stopped++ });
  assert.deepEqual([prevented, stopped, p.coach.shown()], [1, 1, ""]);
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "c", "c comes after b");
  // A click on its control says it seen.
  for (const fn of p.docOn.pointerdown || []) fn({ target: stub.document.querySelector(".c") });
  assert.equal(p.coach.shown(), "");
  assert.deepEqual(p.posted(), ["a", "b", "c"]);
  p.coach.look();
  assert.equal(p.looking(), true, "e is still to see: a condition may hold later, so it goes on looking");
  for (const fn of p.winOn.keydown || []) fn({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
  assert.deepEqual(p.posted(), ["a", "b", "c"], "an Esc with no tip on screen is the page's");
  // Switched off in the file: nothing looks.
  const off = page({ enabled: false, seen: [], steps: [tip({ id: "a" })] });
  await off.coach.start();
  assert.equal(off.looking(), false);
});

// (fails before: yes)
test("a group's tips show in a row, counted among those still to see; Next scrolls the next control into sight and shows it at once", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "folder", group: "start" }), tip({ id: "comp", group: "start", place: "left" }), tip({ id: "absent", group: "start" }), tip({ id: "subs", group: "start" })] });
  p.control("folder", { top: 100, left: 600, width: 120, height: 30 });
  // Below the fold until it is scrolled to.
  const comp = p.control("comp", { top: 1200, left: 600, width: 400, height: 300 });
  const subs = p.control("subs", { top: 1600, left: 600, width: 400, height: 300 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "folder");
  assert.equal(text(bubble().querySelector(".coach-count")), "1 of 3", "absent has no control on the page: not counted");
  assert.equal(text(bubble().querySelector(".coach-next")), "Next");
  bubble().querySelector(".coach-next").dispatch("click");
  assert.equal(comp.scrolled, 1, "the next control is scrolled into sight");
  assert.equal(stub.document.body.querySelector(".coach-dim"), null, "not in sight yet: no shade stands over nothing");
  comp.getBoundingClientRect = () => ({ top: 300, left: 600, width: 400, height: 300, right: 1000, bottom: 600 });
  p.flush();
  assert.equal(p.coach.shown(), "comp", "shown at the first look that finds it");
  assert.equal(text(bubble().querySelector(".coach-count")), "2 of 3");
  assert.equal(bubble().getAttribute("data-side"), "left");
  // Covered by a sheet: hidden, not seen; back, the same count.
  p.covered.add(comp);
  p.coach.look();
  assert.equal(p.coach.shown(), "");
  p.covered.delete(comp);
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "comp");
  assert.equal(text(bubble().querySelector(".coach-count")), "2 of 3");
  assert.deepEqual(p.posted(), ["folder"], "a covered tip was not seen");
  // (fails before: yes — the review of 11-09: another chat opened marked the tip on screen seen) Its control gone: it
  // hides, unseen, and the row ends.
  comp.remove();
  p.coach.look();
  assert.equal(p.coach.shown(), "");
  assert.deepEqual(p.posted(), ["folder"], "nobody said it seen");
  subs.getBoundingClientRect = () => ({ top: 300, left: 600, width: 400, height: 300, right: 1000, bottom: 600 });
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "subs");
  assert.equal(bubble().querySelector(".coach-count"), null, "counted afresh: the one left stands alone");
  assert.equal(text(bubble().querySelector(".coach-next")), "Got it");
});

const shade = () => /** @type {any} */ (stub.document.body.querySelector(".coach-dim"));
const holeOf = (/** @type {any} */ el) => [el.style.top, el.style.left, el.style.width, el.style.height];

// (fails before: yes — the owner's of 11-09: "dim the background only keep the bubble tip and the target in focus")
test("the page is dimmed behind a tip, its hole the ring's; Next hands the shade on, its hole at the next control; a tip's own dim", async () => {
  const p = page({ enabled: true, dim: 0.6, seen: [], steps: [tip({ id: "one", group: "g" }), tip({ id: "two", group: "g" }), tip({ id: "bare", dim: 0 }), tip({ id: "own", dim: 0.3 })] });
  p.control("one", { top: 100, left: 100, width: 80, height: 30 });
  p.control("two", { top: 300, left: 100, width: 120, height: 40 });
  await p.coach.start();
  p.coach.look();
  assert.equal(shade(), null, "nothing dims before a tip shows");
  p.coach.look();
  const d = shade();
  assert.ok(d, "dimmed behind the tip");
  assert.deepEqual(holeOf(d), holeOf(stub.document.body.querySelector(".coach-ring")));
  assert.deepEqual(holeOf(d), ["96px", "96px", "88px", "38px"]);
  assert.equal(d.style["--coach-dim"], "0.6", "as dark as the file says");
  assert.ok(!d.classList.contains("is-moving"), "a shade new to the page does not glide in");
  bubble().querySelector(".coach-next").dispatch("click");
  assert.equal(p.coach.shown(), "two", "in sight: shown at once");
  assert.equal(shade(), d, "the same shade, never dark, light and dark again");
  assert.deepEqual(holeOf(d), ["296px", "96px", "128px", "48px"], "its hole at the next control");
  // (fails before: yes — the review of 11-09: the hole glided at every place, and trailed its control in a scroll)
  assert.ok(d.classList.contains("is-moving"), "handed on, its hole glides");
  p.flush();
  assert.ok(!d.classList.contains("is-moving"), "then keeps to the ring");
  bubble().querySelector(".coach-next").dispatch("click");
  assert.equal(shade(), null, "gone with the last tip");
  p.control("bare", { top: 500, left: 100, width: 80, height: 30 });
  p.coach.look();
  p.coach.look();
  assert.deepEqual([p.coach.shown(), shade()], ["bare", null], "a tip whose dim is 0 dims nothing");
  bubble().querySelector(".coach-next").dispatch("click");
  p.control("own", { top: 600, left: 100, width: 80, height: 30 });
  p.coach.look();
  p.coach.look();
  assert.equal(shade()?.style["--coach-dim"], "0.3", "a tip's own dim");
  p.coach.stop();
  assert.equal(shade(), null, "stopped: no shade");
});

// (fails before: yes — the page dimmed behind a tip must never stand in the way; the review of 11-09: typing on as a
// tip came up said it read)
test("a click elsewhere or typing turns from a tip: seen once it was up to be read, else unseen; the rest of its row waits until its controls leave the page and come back", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "one", group: "g" }), tip({ id: "two", group: "g" }), tip({ id: "three", group: "g" })] });
  const one = p.control("one", { top: 100, left: 100, width: 80, height: 30 });
  const two = p.control("two", { top: 200, left: 100, width: 80, height: 30 });
  const three = p.control("three", { top: 300, left: 100, width: 80, height: 30 });
  const elsewhere = p.control("elsewhere", { top: 500, left: 700, width: 80, height: 30 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  assert.equal(text(bubble().querySelector(".coach-count")), "1 of 3");
  const down = (/** @type {any} */ target, /** @type {any} */ at = {}) => { for (const fn of p.docOn.pointerdown || []) fn({ target, ...at }); };
  down(bubble().querySelector(".coach-text"));
  assert.equal(p.coach.shown(), "one", "a click on the bubble is its own");
  p.tick(C.COACH_READ_MS);
  // The band the shade leaves lit around the control is the tip's too.
  const ring = /** @type {any} */ (stub.document.body.querySelector(".coach-ring"));
  ring.getBoundingClientRect = () => ({ left: 96, top: 96, width: 88, height: 38, right: 184, bottom: 134 });
  down(elsewhere, { clientX: 97, clientY: 97 });
  assert.equal(p.coach.shown(), "one", "a click in the lit band");
  down(elsewhere, { clientX: 720, clientY: 510 });
  assert.deepEqual([p.coach.shown(), shade(), p.posted()], ["", null, ["one"]], "up long enough to read: seen");
  for (let i = 0; i < 3; i++) p.coach.look();
  assert.equal(p.coach.shown(), "", "the rest of its row waits: none comes up under the person's work");
  // The board goes with the first send, and comes back with the next new chat: the rest shows, counted afresh.
  for (const el of [one, two, three]) el.remove();
  p.coach.look();
  stub.document.body.append(two, three);
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "two");
  assert.equal(text(bubble().querySelector(".coach-count")), "1 of 2");
  // A shortcut, or an input method's key, is not typing; a key written in a box is, and goes on to it — but not in the
  // tip's first moments, and before it could be read it only puts the row aside, unseen.
  const box = stub.document.createElement("textarea");
  stub.document.body.append(box);
  let held = 0;
  const key = (/** @type {any} */ e) => { for (const fn of p.winOn.keydown || []) fn({ target: box, preventDefault: () => void held++, stopImmediatePropagation: () => void held++, ...e }); };
  p.tick(C.COACH_SETTLE_MS - 1);
  key({ key: "f" });
  assert.equal(p.coach.shown(), "two", "a key in its first moments: a word on its way");
  p.tick(100);
  key({ key: "k", ctrlKey: true });
  key({ key: "Process" });
  assert.equal(p.coach.shown(), "two");
  key({ key: "f" });
  assert.deepEqual([p.coach.shown(), held, p.posted()], ["", 0, ["one"]], "typed on before it could be read: unseen");
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "", "two and three wait");
  for (const el of [two, three]) el.remove();
  p.coach.look();
  stub.document.body.append(two, three);
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "two", "back with the board");
  p.tick(C.COACH_READ_MS);
  key({ key: "f" });
  assert.deepEqual([p.coach.shown(), p.posted()], ["", ["one", "two"]]);
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "", "three waits");
});

// (fails before: yes — the review of 11-09: Next shows the next tip in its click, and a double click's second press
// landed on the dimmed page)
test("a double click on Next, or a click already on its way, does not turn from the tip it brings", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "one", group: "g" }), tip({ id: "two", group: "g" })] });
  p.control("one", { top: 100, left: 100, width: 80, height: 30 });
  p.control("two", { top: 200, left: 100, width: 80, height: 30 });
  const elsewhere = p.control("elsewhere", { top: 500, left: 700, width: 80, height: 30 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  p.tick(1000);
  bubble().querySelector(".coach-next").dispatch("click");
  assert.equal(p.coach.shown(), "two");
  p.tick(150);
  for (const fn of p.docOn.pointerdown || []) fn({ target: elsewhere });
  assert.deepEqual([p.coach.shown(), p.posted()], ["two", ["one"]]);
});

// (fails before: yes — the review of 11-09: a reconnect brought the rows put aside back on the same board, and a row
// whose controls stayed held every other back)
test("each row put aside comes back on its own, and stays aside through a reload; Show tips again brings them all", async () => {
  const steps = [tip({ id: "g1", group: "g" }), tip({ id: "g2", group: "g" }), tip({ id: "h1", group: "h" }), tip({ id: "h2", group: "h" })];
  // The data folder's word: the tips said seen since the last Show tips again.
  /** @type {any} */
  let p = null;
  const since = () => p.calls.slice(p.calls.map((/** @type {any} */ c) => c.path).lastIndexOf("/coach/reset") + 1);
  p = page(() => ({ enabled: true, steps, seen: since().filter((/** @type {any} */ c) => c.path === "/coach/seen").flatMap((/** @type {any} */ c) => c.body.ids) }));
  const g1 = p.control("g1", { top: 100, left: 100, width: 80, height: 30 });
  const g2 = p.control("g2", { top: 200, left: 100, width: 80, height: 30 });
  p.control("h1", { top: 300, left: 100, width: 80, height: 30 });
  p.control("h2", { top: 400, left: 100, width: 80, height: 30 });
  const elsewhere = p.control("elsewhere", { top: 600, left: 700, width: 80, height: 30 });
  const away = () => { p.tick(C.COACH_READ_MS); for (const fn of p.docOn.pointerdown || []) fn({ target: elsewhere }); };
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "g1");
  away();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "h1", "another row's tip");
  away();
  await p.coach.reload();
  for (let i = 0; i < 3; i++) p.coach.look();
  assert.equal(p.coach.shown(), "", "a reload keeps them aside");
  // g's controls leave and come back; h's stay: g's row alone comes back.
  g1.remove();
  g2.remove();
  p.coach.look();
  stub.document.body.append(g2);
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "g2");
  bubble().querySelector(".coach-next").dispatch("click");
  for (let i = 0; i < 3; i++) p.coach.look();
  assert.equal(p.coach.shown(), "", "h2 still aside");
  await p.coach.reset();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "g2", "every tip again, none aside");
});

// (fails before: yes — a dimmed tip would stand over what the person opened)
test("no tip over a menu, a popover or a sheet: the one on screen waits, unseen; a key keeps the next from coming up under the typing", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "a" }), tip({ id: "b" })] });
  p.control("a", { top: 100, left: 100, width: 80, height: 30 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "a");
  const pop = /** @type {any} */ (stub.document.createElement("div"));
  pop.className = "zc-popover";
  stub.document.body.append(pop);
  p.coach.look();
  assert.deepEqual([p.coach.shown(), shade(), p.posted()], ["", null, []], "hidden, not seen");
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "", "none comes up over it");
  // One the page keeps out of sight (hidden, or by its visibility) is none.
  pop.checkVisibility = () => false;
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "a");
  pop.remove();
  // A menu, and a sheet, the same.
  for (const [k, v] of [["role", "menu"], ["aria-modal", "true"]]) {
    const over = stub.document.createElement("div");
    over.setAttribute(k, v);
    stub.document.body.append(over);
    p.coach.look();
    assert.equal(p.coach.shown(), "", `${k}=${v}`);
    over.remove();
    p.coach.look();
    p.coach.look();
    assert.equal(p.coach.shown(), "a");
  }
  bubble().querySelector(".coach-next").dispatch("click");
  p.control("b", { top: 300, left: 100, width: 80, height: 30 });
  p.coach.look();
  for (const fn of p.winOn.keydown || []) fn({ key: "x", target: stub.document.body });
  p.coach.look();
  assert.equal(p.coach.shown(), "", "a key between two looks: not yet");
  p.coach.look();
  assert.equal(p.coach.shown(), "b");
});

// (fails before: yes)
test("Esc is a menu's while one is open; Skip tips says every tip seen, stops looking and says where they come back", async () => {
  const p = page({ enabled: true, seen: ["x"], steps: [tip({ id: "a" }), tip({ id: "b" }), tip({ id: "x" }), tip({ id: "off", enabled: false })] });
  p.control("a", { top: 100, left: 100, width: 80, height: 30 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "a");
  // (fails before: yes — the live look of 11-09: the message box keeps a list hidden in the page, and Esc never closed a tip)
  const kept = stub.document.createElement("div");
  kept.setAttribute("role", "listbox");
  kept.className = "hidden";
  stub.document.body.append(kept);
  let shut = 0;
  for (const fn of p.winOn.keydown || []) fn({ key: "Escape", preventDefault: () => void shut++, stopImmediatePropagation() {} });
  assert.deepEqual([shut, p.coach.shown()], [1, ""], "a list kept hidden holds no Esc");
  p.coach.look();
  // Seen by Esc: b is next.
  p.control("b", { top: 300, left: 100, width: 80, height: 30 });
  p.coach.look();
  p.coach.look();
  assert.equal(p.coach.shown(), "b");
  const menu = stub.document.createElement("div");
  menu.setAttribute("role", "menu");
  stub.document.body.append(menu);
  let prevented = 0;
  for (const fn of p.winOn.keydown || []) fn({ key: "Escape", preventDefault: () => void prevented++, stopImmediatePropagation() {} });
  assert.deepEqual([prevented, p.coach.shown()], [0, "b"], "the menu's Esc");
  menu.remove();
  bubble().querySelector(".coach-skip").dispatch("click");
  assert.equal(p.coach.shown(), "");
  assert.equal(stub.document.body.querySelector(".coach-dim"), null, "no shade once tips are off");
  assert.deepEqual(p.posted(), ["a", "b"], "every tip on, not those seen already");
  assert.equal(p.looking(), false);
  assert.deepEqual(p.toasts, ["Tips are off."]);
  assert.deepEqual(p.winOn.keydown, [], "its keys let go");
});

// (fails before: yes)
test("a file gone wrong is said once in a toast, and nothing looks; Show tips again forgets the seen and reads the file anew", async () => {
  let answer = /** @type {any} */ ({ enabled: false, steps: [], seen: [], error: "coach.json is not JSON: Unexpected token" });
  const p = page(() => answer);
  await p.coach.start();
  await p.coach.reload();
  assert.deepEqual(p.toasts, ["Tips: coach.json is not JSON: Unexpected token"]);
  assert.equal(p.looking(), false);
  answer = { enabled: true, steps: [tip({ id: "a" })], seen: ["a"], problems: ["b names no target: it is left out"] };
  await p.coach.reload();
  assert.equal(p.toasts[1], "Tips: b names no target: it is left out");
  assert.equal(p.looking(), false, "a seen: nothing left");
  answer = { enabled: true, steps: [tip({ id: "a" })], seen: [] };
  await p.coach.reset();
  assert.deepEqual(p.calls.map((c) => c.path).slice(-2), ["/coach/reset", "/coach"]);
  assert.ok(p.looking());
});

// (fails before: yes — the page had no tips)
test("the page starts the tips once the tour was asked, on a full page that writes; each condition the file names is the page's", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.match(app, /import \{ createCoach \} from "\.\/coach\/coach\.js";/);
  assert.match(app, /if \(!POPPED && !viewOnlyPage\(\)\) void tourAsked\.catch\(\(\) => \{\}\)\.then\(\(\) => coach\.start\(\)\)\.then\(coachRead\);/);
  assert.match(app, /tourAsked = Promise\.all\(\[/, "the tour's own opening is what the tips wait for");
  // A restart heard as the events feed comes back: the file read again, and its replay with it.
  assert.match(app, /function afterFeedGap\(\) \{[\s\S]*?\n  if \(!POPPED && !viewOnlyPage\(\)\) void coach\.reload\(\)\.then\(coachRead\);\n\}/);
  // The replay opens the tour from its first step, once.
  assert.match(app, /function coachRead\(a\) \{\n\s*if \(!a\?\.replayed \|\| !a\.replayWelcomeTour\) return;[\s\S]*?prefs\.set\("welcomeStep", 0\);\n\s*openTour\(\);/);
  assert.match(app, /\{ id: "tips", label: "Show tips again", [^\n]*run: \(\) => void coach\.reset\(\)/, "the command center's way back");
  const file = JSON.parse(readFileSync(new URL("../src/ui/harness/coach/coach.json", import.meta.url), "utf8"));
  const named = [...app.matchAll(/coach\.when\("([\w-]+)"/g)].map((m) => m[1]);
  for (const s of file.steps) if (s.when) assert.ok(named.includes(s.when), `${s.id}'s condition ${s.when} is one the page names (${named.join(", ")})`);
  for (const s of file.steps) if (s.after) assert.ok(file.steps.some((/** @type {any} */ x) => x.id === s.after && x.enabled !== false), `${s.id} follows a tip that is on`);
});

// (fails before: yes — no file, no styles)
test("the tips' styles are on the harness page, and the ring lets every click through", () => {
  const html = readFileSync(new URL("../src/ui/harness.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/ui\/harness\/coach\/coach\.css" \/>/);
  const css = readFileSync(new URL("../src/ui/harness/coach/coach.css", import.meta.url), "utf8");
  assert.match(css, /\.coach-ring \{[^}]*pointer-events: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // (fails before: yes — no shade) The shade lets every click through, over the page's sheets (55), under what the
  // person opens: menus, popovers, dialogs (60).
  assert.match(css, /\.coach-dim \{[^}]*z-index: 57;[^}]*pointer-events: none;/);
  // Its hole glides only as Next hands it on: in a scroll it keeps to the ring.
  assert.doesNotMatch(css, /\.coach-dim \{[^}]*transition/);
  assert.match(css, /\.coach-dim\.is-moving \{ transition: /);
});

// (fails before: yes — the owner's of 11-09) Esc in a row of tips puts the rest aside too.
test("Esc turns from a tip in a row: the rest waits for the board to come back", async () => {
  const p = page({ enabled: true, seen: [], steps: [tip({ id: "one", group: "g" }), tip({ id: "two", group: "g" })] });
  p.control("one", { top: 100, left: 100, width: 80, height: 30 });
  p.control("two", { top: 200, left: 100, width: 80, height: 30 });
  await p.coach.start();
  p.coach.look();
  p.coach.look();
  for (const fn of p.winOn.keydown || []) fn({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
  p.coach.look();
  p.coach.look();
  assert.deepEqual([p.coach.shown(), p.posted()], ["", ["one"]]);
});
