// @ts-check
// A live turn's run events, drawn once a frame however many land (the bug report's X1). The page aligned the whole log
// and built every card again for each event as it landed: a page that follows a run from its start — a reload mid-run,
// a second tab — is handed the log in a few chunks, and a long run's (19 sub-agents, about 3,000 events) held the page
// for minutes in one task, until the browser called it hung. The events are taken as they land and the turn is drawn
// at the next frame; a tab put away gets no frames, so a timer draws there, and its questions and its end are still
// said. DOM-free.

/** How long a draw waits for a frame that does not come: a tab put away, whose browser runs timers about once a
 *  second. */
export const DRAW_LATE_MS = 250;

/**
 * @param {(landed: any[]) => void} draw  draws the turn from its whole log; `landed` holds the events since the last draw
 * @param {{ frame?: (fn: () => void) => any, cancelFrame?: (handle: any) => void }} [io]  a test's own frames
 */
export function createRunDraw(draw, io = {}) {
  const frame = io.frame || ((fn) => requestAnimationFrame(fn));
  const cancelFrame = io.cancelFrame || ((handle) => cancelAnimationFrame(handle));
  /** @type {any[]} */
  let landed = [];
  /** @type {any} */
  let next = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let late = null;
  /** A replay passing (lib/replay-hold.js): what lands waits, no frame asked for, until `release` or `now`. */
  let held = false;
  const now = () => {
    if (next != null) cancelFrame(next);
    if (late != null) clearTimeout(late);
    next = late = null;
    if (!landed.length) return;
    const these = landed;
    landed = [];
    draw(these);
  };
  const ask = () => {
    if (next != null || held || !landed.length) return;
    next = frame(now);
    late = setTimeout(now, DRAW_LATE_MS);
  };
  return {
    /** An event landed: it is drawn with the others at the next frame. @param {any} e */
    add(e) {
      landed.push(e);
      ask();
    },
    /** What landed, drawn now: before the turn's end reads what is drawn. */
    now,
    /** What lands waits, drawn by `release` (at its next frame) or `now`. */
    hold() {
      held = true;
      if (next != null) cancelFrame(next);
      if (late != null) clearTimeout(late);
      next = late = null;
    },
    /** What waited, drawn at the next frame; what lands after, each at its own frame. */
    release() {
      held = false;
      ask();
    },
  };
}
