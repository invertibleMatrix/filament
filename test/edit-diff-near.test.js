// @ts-check
// An edit card reads its change once it comes near the screen (the slowness of 11-02): a long turn's every card not in
// a closed fold read as the chat opened, two at a time, a second or more of git each, far below the screen too, and the
// page's other reads waited behind them. A card near the screen reads; one off it waits until scrolled near; one in a
// closed fold waits for the fold and then for the screen; a card drawn again and again reads once, its newest drawing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** The page's watcher of what nears the screen, stood in: the test says what comes near. */
class NearStandIn {
  /** @type {NearStandIn[]} */
  static made = [];
  /** @param {(entries: { target: any, isIntersecting: boolean }[]) => void} cb @param {any} [opts] */
  constructor(cb, opts = {}) {
    this.cb = cb;
    this.opts = opts;
    /** @type {Set<any>} */
    this.watched = new Set();
    NearStandIn.made.push(this);
  }
  /** @param {any} el */
  observe(el) {
    this.watched.add(el);
  }
  /** @param {any} el */
  unobserve(el) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  /** `el` comes near the screen. @param {any} el */
  static near(el) {
    for (const o of NearStandIn.made) if (o.watched.has(el)) o.cb([{ target: el, isIntersecting: true }]);
  }
  /** @param {any} el */
  static watching(el) {
    return NearStandIn.made.some((o) => o.watched.has(el));
  }
}
/** @type {any} */ (globalThis).IntersectionObserver = NearStandIn;

const tick = () => new Promise((r) => setImmediate(r));
/** A <details> as the rule reads one. @param {boolean} open */
const details = (open) => {
  /** @type {Array<(e: { currentTarget: any }) => void>} */
  const fns = [];
  return { open, fns, addEventListener: (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => { if (type === "toggle") fns.push(fn); }, toggle(/** @type {boolean} */ o) { this.open = o; for (const fn of [...fns]) fn({ currentTarget: this }); } };
};
/** A card's row inside these, nearest first. @param {any[]} chain */
const rowIn = (chain) => ({ isConnected: true, parentElement: { closest: () => chain.find((d) => !d.open) || null } });

// (fails before: yes — a card on the page read at once, near the screen or not)
test("a card reads once it nears the screen; in a closed fold, once that opens and it nears; drawn again, its newest drawing reads once", async () => {
  const { readWhenShown } = await import("../src/ui/harness/lib/diff-render.js");
  /** @type {string[]} */
  const read = [];
  const far = rowIn([]);
  readWhenShown(/** @type {any} */ (far), () => read.push("far"));
  await tick();
  assert.equal(read.length, 0, "off the screen: nothing read");
  assert.ok(NearStandIn.watching(far), "watched for the screen");
  NearStandIn.near(far);
  assert.deepEqual(read, ["far"], "scrolled near: read");
  assert.ok(!NearStandIn.watching(far), "and no longer watched");
  const fold = details(false);
  const inFold = rowIn([fold]);
  readWhenShown(/** @type {any} */ (inFold), () => read.push("fold"));
  await tick();
  NearStandIn.near(inFold);
  assert.deepEqual(read, ["far"], "a closed fold's card waits for its fold");
  fold.toggle(true);
  await tick();
  assert.deepEqual(read, ["far"], "opened, it waits for the screen");
  NearStandIn.near(inFold);
  assert.deepEqual(read, ["far", "fold"]);
  // A live turn draws its cards again at each event: the row on the page reads once, with its newest drawing's read.
  const live = rowIn([]);
  for (let i = 0; i < 20; i++) readWhenShown(/** @type {any} */ (live), () => read.push(`live ${i}`));
  await tick();
  NearStandIn.near(live);
  NearStandIn.near(live);
  assert.deepEqual(read, ["far", "fold", "live 19"]);
  // (fails before: yes — Fable 5.2's review of 11-17: each fold's listener was made beside the first card it heard, and
  // held that card's drawing for the fold's life) Every fold hears with the one listener, which holds no card.
  const other = details(false);
  readWhenShown(/** @type {any} */ (rowIn([other])), () => {});
  await tick();
  assert.equal(other.fns.length, 1);
  assert.equal(other.fns[0], fold.fns[0], "the same listener for every fold");
  assert.equal(other.fns[0].name, "readsOnOpen");
});

test("an edit card's read is made apart from its drawing and finds its parts in the row that stands", () => {
  const render = readFileSync(new URL("../src/ui/harness/conversation/tools/render.js", import.meta.url), "utf8");
  assert.match(render, /^const readsChange = \(runId, target, round, call\) => \(\/\*\* @type \{Element\} \*\/ row\) => \{\s+const counts = row\.querySelector\("\.edit-counts"\);\s+const slot = row\.querySelector\("\.inline-diff-slot"\);/m, "made at the module's top: it holds the change's names alone");
  assert.match(render, /read = readsChange\(runId, target, round, call\);/);
  assert.match(render, /if \(read && known\) read\(row\);\s+else if \(read\) readWhenShown\(row, read\);/);
  const diff = readFileSync(new URL("../src/ui/harness/lib/diff-render.js", import.meta.url), "utf8");
  assert.match(diff, /if \(!closed\) return whenShown\(row, startsOn\(start, row\)\);/, "near the screen, it is given the row that stands");
});

// (fails before: yes — the review of 11-02: watched against the window, whose margin the transcript's own clip cuts off,
// a card read only once it was in sight)
test("a card is watched against the scroller it stands in, half a screen beyond what that shows", async () => {
  const { whenShown } = await import("../src/ui/harness/lib/when-shown.js");
  const g = /** @type {any} */ (globalThis);
  const had = g.getComputedStyle;
  g.getComputedStyle = (/** @type {any} */ n) => ({ overflowY: n.scrolls ? "auto" : "visible" });
  try {
    const scroller = { scrolls: true, parentElement: { parentElement: null } };
    const card = { parentElement: { parentElement: scroller } };
    let went = 0;
    whenShown(/** @type {any} */ (card), () => went++);
    const w = NearStandIn.made.find((o) => o.watched.has(card));
    assert.ok(w, "watched");
    assert.deepEqual([w.opts.root === scroller, w.opts.rootMargin], [true, "50% 0px"]);
    const other = { parentElement: scroller };
    whenShown(/** @type {any} */ (other), () => went++);
    assert.ok(w.watched.has(other), "one watcher a scroller");
    NearStandIn.near(card);
    assert.equal(went, 1);
  } finally {
    if (had === undefined) delete g.getComputedStyle;
    else g.getComputedStyle = had;
  }
});
