// @ts-check
// Work asked for many times in a task, done once, at the next frame (HarnessV4_Worktrees_Plan S2). Following the
// transcript's tail reads its height, which lays the page out: a chat's render draws up to sixty turns and a running
// turn is laid out again on each of its events, and following on each forced a layout per turn and per event — half a
// switch's time on the owner's page. Asked any number of times before a frame, it runs once in that frame, where the
// page is laid out once anyway. Where there are no frames (node), it runs at once. DOM-free.

/**
 * @param {() => void} fn
 * @param {{ frame?: ((fn: () => void) => any) | null, cancelFrame?: (handle: any) => void, late?: number }} [io]
 *   `frame`: a test's own frames; null: none, run at once. `late`: work whose effects reach past the page's drawing
 *   (what the agents' list says is acted on as well as drawn) runs after that many milliseconds where no frame came —
 *   a tab put away gets none, and its browser runs timers about once a second.
 * @returns {() => void}  ask for it
 */
export function onceAFrame(fn, io = {}) {
  const frame = io.frame !== undefined ? io.frame : typeof requestAnimationFrame === "function" ? (/** @type {() => void} */ f) => requestAnimationFrame(f) : null;
  const cancelFrame = io.cancelFrame || (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame.bind(globalThis) : () => {});
  const late = io.late || 0;
  let asked = false;
  /** @type {any} */
  let next = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const run = () => {
    if (!asked) return;
    asked = false;
    if (timer != null) clearTimeout(timer);
    if (late && next != null) cancelFrame(next);
    next = timer = null;
    fn();
  };
  return () => {
    if (!frame) return void fn();
    if (asked) return;
    asked = true;
    next = frame(run);
    if (late) timer = setTimeout(run, late);
  };
}
