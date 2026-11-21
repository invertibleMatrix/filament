// @ts-check
// HarnessV3-Responsiveness R4 (2026-10-01): opening a session asked, at once, for every history turn's cards (its
// run's events) and its changes — up to 120 requests for a 60-turn page — and the browser's six connections to
// Filament queued the page's own clicks (a compaction widget's tabs, a sub-agent window) behind them. Now a turn loads
// when its row comes within a screen of view, two fetches at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFetchQueue } from "../src/ui/harness/lib/fetch-queue.js";

const tick = () => new Promise((r) => setImmediate(r));

// (fails before: there was no queue)
test("the queue never runs more than its limit at once, and starts them in order", async () => {
  const q = createFetchQueue(2);
  let running = 0, most = 0;
  /** @type {number[]} */
  const started = [];
  /** @type {(() => void)[]} */
  const finish = [];
  const jobs = Array.from({ length: 6 }, (_, i) =>
    q.run(() => {
      started.push(i);
      running++;
      most = Math.max(most, running);
      return new Promise((r) => finish.push(() => { running--; r(i); }));
    }),
  );
  await tick();
  assert.deepEqual(started, [0, 1], "two start, four wait");
  assert.equal(q.active, 2);
  assert.equal(q.waiting, 4);
  while (finish.length) {
    /** @type {() => void} */ (finish.shift())();
    await tick();
    await tick();
  }
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5], "each gets its own answer");
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5], "in the order asked");
  assert.equal(most, 2, "never more than two at once");
  assert.equal(q.active, 0);
});

test("a job that fails, or throws, frees its slot and says so to its caller alone", async () => {
  const q = createFetchQueue(1);
  const a = q.run(() => Promise.reject(new Error("gone")));
  const b = q.run(() => {
    throw new Error("threw");
  });
  const c = q.run(() => "ok");
  await assert.rejects(a, /gone/);
  await assert.rejects(b, /threw/);
  assert.equal(await c, "ok", "the next job still ran");
  assert.equal(q.active, 0);
  assert.equal(q.waiting, 0);
});

test("a limit below one is one", async () => {
  const q = createFetchQueue(0);
  /** @type {(() => void)[]} */
  const finish = [];
  q.run(() => new Promise((r) => finish.push(() => r(undefined))));
  q.run(() => new Promise((r) => finish.push(() => r(undefined))));
  await tick();
  assert.equal(q.active, 1);
  finish.forEach((f) => f());
});

// (fails before: render called historyCards and attachTree for every turn it drew)
test("the timeline loads a history turn's cards and changes only when its row nears the screen, through the queue", () => {
  const src = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  // A full render draws each shown turn through `drawTurn`, which a past turn whose work has come is drawn by again.
  const full = src.slice(src.indexOf("    render(c) {"), src.indexOf("    /** The folder chip changed outside the chooser"));
  assert.match(full, /for \(const turn of turns\.slice\(hidden\)\) drawTurn\(c, turn\);/);
  const render = full + src.slice(src.indexOf("  function drawTurn(c, turn) {"), src.indexOf("  function heldWork(c, turn) {"));
  assert.ok(render.length > 3000, "found render and drawTurn");
  assert.match(render, /whenNear\(v\.root, \(\) => historyCards\(turn\)\)/);
  assert.match(render, /whenNear\(v\.root, \(\) => attachTree\(/);
  assert.doesNotMatch(render.replace(/whenNear\(v\.root, \(\) => (historyCards|attachTree)\(/g, ""), /\b(historyCards|attachTree)\(/, "no direct call left in render");
  assert.match(src, /const cardQueue = createFetchQueue\(2\);/);
  assert.match(src, /new IntersectionObserver\([\s\S]{0,700}rootMargin: "100% 0px"/);
  assert.match(src, /nearScreen\?\.disconnect\(\)/, "a re-render drops the old rows' waiting loads");
});
