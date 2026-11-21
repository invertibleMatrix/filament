// @ts-check
// The owner's of 11-14: a window with a chat writing held its renderer at about 40% of a core and its GPU at 35–50% on a
// 120 Hz screen, the block being written drawn again at every frame. A growing reply is drawn at a pace now
// (ui/harness/lib/stream-pace.js): at once after a rest, else once at the pace's end from the newest words, and what
// waits is drawn at once where the page lets go of the reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStreamPace, STREAM_DRAW_MS } from "../src/ui/harness/lib/stream-pace.js";

/** A clock and timers the test moves by hand. */
const clock = () => {
  let at = 1000;
  /** @type {Map<number, { fn: () => void, due: number }>} */
  const timers = new Map();
  let id = 0;
  return {
    now: () => at,
    later: (/** @type {() => void} */ fn, /** @type {number} */ ms) => (timers.set(++id, { fn, due: at + ms }), id),
    cancel: (/** @type {number} */ handle) => void timers.delete(handle),
    /** Time goes by: each timer due by then runs, at the time it was due. @param {number} ms */
    pass(ms) {
      const end = at + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= end).sort((x, y) => x[1].due - y[1].due)[0];
        if (!next) break;
        timers.delete(next[0]);
        at = next[1].due;
        next[1].fn();
      }
      at = end;
    },
    waiting: () => timers.size,
  };
};

test("the first piece is drawn at once; the pieces within the pace, once at its end, from the newest words", () => {
  const c = clock();
  let text = "";
  /** @type {string[]} */
  const drawn = [];
  const pace = createStreamPace(() => drawn.push(text), c);
  text = "One";
  pace.ask();
  assert.deepEqual(drawn, ["One"], "no wait before the first words");
  for (const more of [" two", " three", " four"]) {
    c.pass(10);
    text += more;
    pace.ask();
  }
  assert.deepEqual(drawn, ["One"], "nothing more inside the pace");
  assert.equal(c.waiting(), 1, "one draw waits, however many pieces came");
  c.pass(STREAM_DRAW_MS - 31);
  assert.deepEqual(drawn, ["One"]);
  c.pass(1);
  assert.deepEqual(drawn, ["One", "One two three four"], "at the pace's end, the newest words");
  // Words that keep coming are drawn once a pace.
  for (let i = 0; i < 20; i++) {
    c.pass(10);
    text += ".";
    pace.ask();
  }
  assert.equal(drawn.length, 4, "200 ms of pieces, two draws");
  // After a rest, a piece is drawn at once again.
  c.pass(500);
  const before = drawn.length;
  text += " Again";
  pace.ask();
  assert.equal(drawn.length, before + 1);
  assert.match(drawn[drawn.length - 1], / Again$/);
});

test("a draw its caller made itself takes the waiting one's place and starts the pace over", () => {
  const c = clock();
  let n = 0;
  const pace = createStreamPace(() => n++, c);
  pace.ask();
  c.pass(20);
  pace.ask();
  assert.equal(c.waiting(), 1);
  pace.drew(); // a block begun, drawn whole
  assert.equal(c.waiting(), 0, "nothing left to wait");
  c.pass(50);
  pace.ask();
  assert.equal(n, 1, "the pace counts from the caller's draw");
  c.pass(STREAM_DRAW_MS - 50);
  assert.equal(n, 2);
});

test("flush draws what waits at once, and only that: nothing draws again after it", () => {
  const c = clock();
  let text = "";
  /** @type {string[]} */
  const drawn = [];
  const pace = createStreamPace(() => drawn.push(text), c);
  pace.flush();
  assert.deepEqual(drawn, [], "nothing waits, nothing drawn");
  text = "A";
  pace.ask();
  c.pass(30);
  text = "A last word";
  pace.ask();
  pace.flush();
  assert.deepEqual(drawn, ["A", "A last word"], "the reply's end draws its last words now");
  assert.equal(c.waiting(), 0);
  c.pass(STREAM_DRAW_MS * 3);
  assert.deepEqual(drawn, ["A", "A last word"], "and nothing draws after the end");
});
