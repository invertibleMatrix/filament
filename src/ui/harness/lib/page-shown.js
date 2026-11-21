// @ts-check
// What the page puts off while it is out of sight (the owner's Mac of 11-14: the desktop app kept another machine's
// page loaded and hidden in its side rail, and that page took 50–80% of a core and churned 2.5 GB of memory, reading
// 0.5–3 MB at a time — the chat it showed, again every two seconds while another window's turn held it, the left bar's
// lists, the runs, the agents'). A page hidden — a tab in the background, a window minimized, a page the desktop app
// keeps out of view — still hears the events feed and keeps what it says; what its words, or a timer, would read
// from the server waits here under a name, a later ask of the same name taking its place, and runs once, at once, as
// the page shows again. In sight it runs at once. A page that cannot tell (no document: a test, a
// worker) is in sight. Not lib/when-shown.js: that one waits for an element to near the screen.

/** The document as this reads it. @typedef {{ visibilityState?: string, addEventListener?: (type: string, fn: () => void) => void }} ShownDoc */

/**
 * A gate on one document, read at each ask: a test hands its own.
 * @param {() => ShownDoc | null | undefined} [docOf]
 */
export function pageShownGate(docOf = () => /** @type {ShownDoc | undefined} */ (globalThis.document)) {
  /** What waits, by its name, in the order first asked. @type {Map<unknown, () => unknown>} */
  const waiting = new Map();
  /** The document whose coming back into sight runs what waits: heard from the first wait on. @type {ShownDoc | null} */
  let heard = null;
  /** Whether the page is in sight now. */
  const shown = () => docOf()?.visibilityState !== "hidden";
  const runWaiting = () => {
    if (!shown() || !waiting.size) return;
    const due = [...waiting.values()];
    waiting.clear();
    for (const fn of due) {
      // Each is a read of its own: one that throws leaves the others to run, and is said as an uncaught error is.
      try {
        fn();
      } catch (e) {
        if (typeof reportError === "function") reportError(e);
        else console.error(e);
      }
    }
  };
  /**
   * `fn` now where the page is in sight, and what it gives back; else once as the page shows again, in place of what
   * waits under the same `key` (a name, or any value: the same one twice is one wait).
   * @template T
   * @param {unknown} key @param {() => T} fn
   * @returns {T | undefined}
   */
  const whenShown = (key, fn) => {
    const doc = docOf();
    if (doc?.visibilityState !== "hidden") {
      // In sight: what waited under its name is this, run now.
      waiting.delete(key);
      return fn();
    }
    if (heard !== doc) {
      heard = doc;
      doc.addEventListener?.("visibilitychange", runWaiting);
    }
    waiting.set(key, fn);
    return undefined;
  };
  return { shown, whenShown, waiting: () => waiting.size };
}

/**
 * The page's motion held while it is out of sight: `data-out-of-sight` on its root, under which harness.css starts no
 * animation. A hidden page draws no frames, and the document's timeline keeps each animation it started until its next
 * frame, a cancelled one with its element: a window kept hidden while a long turn ran held every block and row drawn
 * with a fade or a shimmer, replaced since or not (the lab of 11-17, Fable 5.2's review). In sight again, they play.
 * @param {ShownDoc & { documentElement?: { toggleAttribute?: (name: string, on: boolean) => unknown } }} [doc]
 */
export function stillWhileHidden(doc = /** @type {any} */ (globalThis.document)) {
  const root = doc?.documentElement;
  if (!root?.toggleAttribute) return;
  const mark = () => root.toggleAttribute?.("data-out-of-sight", doc.visibilityState === "hidden");
  mark();
  doc.addEventListener?.("visibilitychange", mark);
}

const page = pageShownGate();
/** Whether the page is in sight now: a page that cannot tell is. */
export const pageShown = page.shown;
/** Run `fn` now where the page is in sight, else once as it shows again, in place of what waits under the same key. */
export const whenPageShown = page.whenShown;
