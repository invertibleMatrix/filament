// @ts-check
// The listeners on an app's one events stream (HarnessV3-Memory M7-D37): the console's `onEvents` and the harness's
// `onBus` hand each message to every one of them the same way. Pure: no DOM, no stream.

/**
 * A set of listeners, each handed every message. A message goes to the listeners there when it came: one that
 * subscribes while it is handed (a page drawn by a listener) hears from the next message on, and one let go meanwhile
 * hears it no more. One listener's failure is reported, never allowed to keep the message from the others.
 * @template M
 * @param {(err: unknown) => void} [report]  where a listener's failure goes (the page's `reportError`)
 */
export function listenerSet(report = (err) => reportError(err)) {
  /** @type {Set<(msg: M) => void>} */
  const fns = new Set();
  return {
    /** Hear every message; returns the undo. @param {(msg: M) => void} fn */
    on(fn) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    /** @param {M} msg */
    hand(msg) {
      for (const fn of [...fns]) {
        if (!fns.has(fn)) continue;
        try {
          fn(msg);
        } catch (err) {
          report(err);
        }
      }
    },
    get size() {
      return fns.size;
    },
  };
}
