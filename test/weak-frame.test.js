// @ts-check
// Frame work that keeps nothing drawn alive while it waits (lib/weak-frame.js, the owner's of 11-17: a window that got
// no frames kept every drawing a running turn made). One frame is asked for however much work comes before it; each
// target's work runs once, in the order it came; one that throws stops none of the others; where the page has no
// frames nothing is queued. That a waiting target is held weakly — fifty drawings let go while no frame comes — is
// drawn-blocks-let-go.test.js's, in a node where garbage can be collected.
// (fails before: yes — there was no queue: each output and each block asked for a frame of its own, over itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { weakFrames } from "../src/ui/harness/lib/weak-frame.js";

/** A queue over a frame the test runs. */
function queue() {
  /** @type {(() => void)[]} */
  const frames = [];
  const q = weakFrames({ frame: (fn) => frames.push(fn) });
  return { q, frames, run: () => frames.splice(0).forEach((f) => f()) };
}

test("one frame for a batch; each target's work once, in order; the next batch asks again", () => {
  const { q, frames, run } = queue();
  /** @type {string[]} */
  const ran = [];
  const a = { name: "a" };
  const b = { name: "b" };
  const say = (/** @type {{ name: string }} */ t) => void ran.push(t.name);
  q.later(a, say);
  q.later(b, say);
  q.later(a, say);
  assert.equal(frames.length, 1, "one frame asked for the batch");
  assert.equal(q.waiting(), 3);
  run();
  assert.deepEqual(ran, ["a", "b", "a"]);
  assert.equal(q.waiting(), 0);
  q.later(b, say);
  assert.equal(frames.length, 1, "a new batch asks again");
  run();
  assert.deepEqual(ran, ["a", "b", "a", "b"]);
});

test("work that throws stops none of the others, and its error is still the page's", () => {
  const { q, run } = queue();
  /** @type {string[]} */
  const ran = [];
  // The error is thrown again from a timer of its own, as the page's: the timer is caught here, and run by hand.
  /** @type {(() => void)[]} */
  const timers = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = /** @type {any} */ ((/** @type {() => void} */ fn) => void timers.push(fn));
  try {
    q.later({}, () => {
      throw new Error("a paint failed");
    });
    q.later({}, () => void ran.push("after"));
    run();
  } finally {
    globalThis.setTimeout = real;
  }
  assert.deepEqual(ran, ["after"]);
  assert.equal(timers.length, 1);
  assert.throws(timers[0], /a paint failed/);
});

test("a page with no frames queues nothing", () => {
  const q = weakFrames({ frame: null });
  q.later({}, () => assert.fail("never runs"));
  assert.equal(q.waiting(), 0);
});
