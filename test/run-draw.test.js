// @ts-check
// The bug report's X1: the page drew a live turn whole for each run event as it landed, and a page that followed a long
// run from its start (a reload mid-run: 19 sub-agents, about 3,000 events) hung for minutes in one task. The events are
// drawn once a frame now (ui/harness/lib/run-draw.js), and the page's live paths hand them over to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRunDraw, DRAW_LATE_MS } from "../src/ui/harness/lib/run-draw.js";

/** Frames the test runs by hand, as the browser does at its next paint. */
const frames = () => {
  /** @type {Map<number, () => void>} */
  const waiting = new Map();
  let id = 0;
  return {
    frame: (/** @type {() => void} */ fn) => (waiting.set(++id, fn), id),
    cancelFrame: (/** @type {number} */ handle) => void waiting.delete(handle),
    paint: () => {
      const fns = [...waiting.values()];
      waiting.clear();
      for (const fn of fns) fn();
    },
    waiting: () => waiting.size,
  };
};

test("a burst of events is drawn once, at the next frame, with every event that landed", () => {
  const f = frames();
  /** @type {any[][]} */
  const draws = [];
  const d = createRunDraw((landed) => draws.push(landed), f);
  for (let n = 1; n <= 3000; n++) d.add({ n });
  assert.equal(draws.length, 0, "nothing is drawn before the frame");
  assert.equal(f.waiting(), 1, "one frame asked for");
  f.paint();
  assert.equal(draws.length, 1);
  assert.deepEqual(draws[0].map((e) => e.n), Array.from({ length: 3000 }, (_, i) => i + 1));
  d.add({ n: 3001 });
  f.paint();
  assert.deepEqual(draws.map((l) => l.length), [3000, 1], "the next event, at the next frame");
});

test("now draws what landed at once, and neither the frame nor the timer asked for draws again", async () => {
  const f = frames();
  /** @type {number[]} */
  const draws = [];
  const d = createRunDraw((landed) => draws.push(landed.length), f);
  d.now();
  assert.deepEqual(draws, [], "nothing landed, nothing drawn");
  d.add({});
  d.add({});
  d.now();
  assert.deepEqual(draws, [2]);
  assert.equal(f.waiting(), 0, "the frame was given back");
  await new Promise((r) => setTimeout(r, DRAW_LATE_MS + 50));
  assert.deepEqual(draws, [2]);
});

test("a tab put away, where no frame comes, is drawn by the timer", async () => {
  /** @type {number[]} */
  const draws = [];
  const d = createRunDraw((landed) => draws.push(landed.length), { frame: () => 1, cancelFrame: () => {} });
  d.add({});
  d.add({});
  d.add({});
  await new Promise((r) => setTimeout(r, DRAW_LATE_MS + 100));
  assert.deepEqual(draws, [3]);
});

// (fails before: yes — each event that landed aligned the whole log twice and built every card again)
test("the page's live paths hand each event to the run draw, and draw what landed before the turn's end reads it", () => {
  const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /alignEvents\(/, "the page aligns a run's log only where it draws it (the transcript's applyEvents)");
  const handlers = [...app.matchAll(/live\.events\.push\(e\);\n([\s\S]*?)\n {2,4}\};/g)].map((m) => m[1]);
  assert.equal(handlers.length, 2, "the send's own turn, and a turn followed from elsewhere");
  for (const h of handlers) {
    assert.match(h, /runDraw\.add\(e\)/);
    assert.doesNotMatch(h, /applyEvents|applyRunEvents/);
  }
  assert.match(app, /runDraw\.now\(\);[^\n]*\n {2}turn\.reply = turn\.reply \|\| live\.reply;/, "the send's end");
  assert.match(app, /if \(chat\.live !== live\) return;\n {4}runDraw\.now\(\);/, "a followed turn's settle");
});
