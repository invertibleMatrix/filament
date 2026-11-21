// @ts-check
// Work for the next animation frame that keeps nothing on the page alive while it waits (the owner's of 11-17: a chat
// window left following a 22-hour turn reached 13 GB). Chromium runs no frame callback while its window gets no
// frames — hidden, covered, the screen locked — and a callback that closes over an element keeps that element, and with
// it the whole drawing it hangs in (its tree, its listeners, the view they close over), until frames come back. A
// command's output queued one for each drawing of it (render.js `termOut`), a reply's markdown one for each block, and
// a running turn's cards are drawn again at every run event: every drawing the window made while nobody looked stayed —
// 9,359 waiting callbacks over three switches back to a long chat, in the lab. Here what waits is held weakly, and the
// work it waits for is a function of it alone, defined where it closes over nothing drawn; one frame callback runs them.

/** @typedef {{ ref: WeakRef<object>, run: (target: any) => void }} Waiting */

/** Past this many waiting, those let go of are swept out as more come: each holds its weak handle alone. */
export const SWEEP_PAST = 4096;

/**
 * A queue of frame work, its frame given (tests give one that never comes, as a window that gets no frames).
 * @param {{ frame?: ((fn: () => void) => unknown) | null }} [io]
 */
export function weakFrames(io = {}) {
  // The page's frame as it is when work comes: a page stub may give one after this module was read.
  const frameNow = () => (io.frame !== undefined ? io.frame : typeof requestAnimationFrame === "function" ? (/** @type {() => void} */ f) => requestAnimationFrame(f) : null);
  /** @type {Set<Waiting>} */
  let waiting = new Set();
  let asked = false;
  let sweepAt = SWEEP_PAST;
  const flush = () => {
    asked = false;
    const now = waiting;
    waiting = new Set();
    sweepAt = SWEEP_PAST;
    for (const w of now) {
      const target = w.ref.deref();
      if (!target) continue;
      // One that throws stops none of the others; its error is still the page's.
      try {
        w.run(target);
      } catch (e) {
        setTimeout(() => {
          throw e;
        });
      }
    }
  };
  /**
   * `run(target)` at the next frame, while `target` is still held elsewhere; nothing where there is no frame. `run`
   * must close over nothing drawn: a function of the module, never one made beside the element.
   * @template {object} T @param {T} target @param {(target: T) => void} run
   */
  const later = (target, run) => {
    const frame = frameNow();
    if (!frame) return;
    waiting.add({ ref: new WeakRef(/** @type {object} */ (target)), run });
    if (waiting.size > sweepAt) {
      for (const w of waiting) if (!w.ref.deref()) waiting.delete(w);
      sweepAt = Math.max(SWEEP_PAST, waiting.size * 2);
    }
    if (asked) return;
    asked = true;
    frame(flush);
  };
  return { later, waiting: () => waiting.size };
}

/** The page's own queue. */
const page = weakFrames();
/** `run(target)` at the page's next frame, `target` held weakly (`weakFrames`). @template {object} T @param {T} target @param {(target: T) => void} run */
export const nextFrame = (target, run) => page.later(target, run);
