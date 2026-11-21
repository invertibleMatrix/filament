// @ts-check
// A streaming reply drawn at a pace, not at every frame (the owner's of 11-14: a window with a chat writing held its
// renderer at about 40% of a core and its GPU at 35–50%, on a 120 Hz screen). Each piece of the reply drew the block
// being written again at the next frame — its markdown parsed, its nodes set, the turn laid out, the transcript scrolled
// to its end — up to 120 times a second, for words that come a few dozen pieces a second. Now the first piece after a
// rest is drawn at once, and the pieces that land within `STREAM_DRAW_MS` of a draw are drawn together at its end, from
// the newest words: the text comes in slightly bigger steps, and no word waits longer than that. What begins or ends a
// block its caller draws at once (`drew`), and what waits is drawn as the page lets go of the reply (`flush`). DOM-free.

/** The least time between two draws of a growing reply (ms): ten a second. */
export const STREAM_DRAW_MS = 100;

/**
 * @param {() => void} draw  draws the reply as it stands now
 * @param {{ now?: () => number, later?: (fn: () => void, ms: number) => any, cancel?: (handle: any) => void }} [io]
 *   a test's own clock and timers
 */
export function createStreamPace(draw, io = {}) {
  const clock = io.now || (() => performance.now());
  const later = io.later || ((fn, ms) => setTimeout(fn, ms));
  const cancel = io.cancel || ((handle) => clearTimeout(handle));
  /** When the reply was last drawn: never, so the first piece is drawn at once. */
  let last = -Infinity;
  /** The draw waiting for the end of the pace. @type {any} */
  let waiting = null;
  const stop = () => {
    if (waiting != null) cancel(waiting);
    waiting = null;
  };
  const run = () => {
    stop();
    last = clock();
    draw();
  };
  return {
    /** The reply grew: drawn at once where the last draw is a pace old, else once at the pace's end — the draw reads
     *  the reply then, so the newest words are the ones drawn. */
    ask() {
      if (waiting != null) return;
      const wait = last + STREAM_DRAW_MS - clock();
      if (wait <= 0) run();
      else waiting = later(run, wait);
    },
    /** The caller drew the reply itself, whole (a block begun or ended): nothing is left to wait, and the pace counts
     *  from now. */
    drew() {
      stop();
      last = clock();
    },
    /** A draw that waits is made now: the reply ended, or the page lets go of it. */
    flush() {
      if (waiting != null) run();
    },
  };
}
