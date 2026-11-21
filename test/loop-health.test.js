// @ts-check
// The event loop's health in the server's log (services/loop-health.js): a window whose p99 delay passed 100 ms is
// said in one line, at most once a minute, with the slow windows in between counted into the next line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { watchLoopHealth, SLOW_P99_MS } from "../src/services/loop-health.js";

/** The loop's delay histogram, stood in: each window's p99, max and mean, in ms. */
function histogram() {
  const h = {
    enabled: false,
    resets: 0,
    window: { p99: 0, max: 0, mean: 0 },
    enable: () => void (h.enabled = true),
    disable: () => void (h.enabled = false),
    reset: () => void h.resets++,
    percentile: (/** @type {number} */ p) => (p === 99 ? h.window.p99 * 1e6 : 0),
    get max() {
      return h.window.max * 1e6;
    },
    get mean() {
      return h.window.mean * 1e6;
    },
  };
  return h;
}

// (fails before: yes — nothing watched the loop short of a 2 s stall)
test("a slow window is one line in the server's log; a quick one is none; lines come at most once a minute, with the windows between", () => {
  const h = histogram();
  /** @type {[string, string][]} */
  const lines = [];
  let t = 0;
  const watch = watchLoopHealth({ log: (level, msg) => lines.push([level, msg]), now: () => t, histogram: h });
  assert.equal(h.enabled, true);
  h.window = { p99: SLOW_P99_MS, max: 140, mean: 12 };
  watch.look();
  assert.deepEqual(lines, [], "at the line is not past it");
  h.window = { p99: 180, max: 412, mean: 23 };
  watch.look();
  assert.deepEqual(lines, [["info", "the event loop was slow: its delay over the last 10 s was 180 ms at the 99th percentile (max 412 ms, mean 23 ms)"]]);
  t += 10_000;
  watch.look();
  t += 10_000;
  watch.look();
  assert.equal(lines.length, 1, "within the minute: counted, not said");
  t += 40_000;
  h.window = { p99: 130, max: 150, mean: 9 };
  watch.look();
  assert.deepEqual(lines[1], ["info", "the event loop was slow: its delay over the last 10 s was 130 ms at the 99th percentile (max 150 ms, mean 9 ms); 2 more slow windows since the last line"]);
  assert.equal(h.resets, 5, "each window starts afresh");
  watch.stop();
  assert.equal(h.enabled, false);
});
