// @ts-check
// A thread's body follows its newest words while you follow them (subagent-viewer.js), by the main transcript's rule
// (labels.js shouldFollow): within its band of the end you follow, and a scroll upward above it is you reading. Only a
// scroll upward lets go: the view's own scroll to the end is told by the browser a moment later, when new words may
// already have pushed the end away — read as you reading, it left a thread drawn again on its tab's return half way down
// (the owner's word of 10-24: a running agent's thread came back at its top, or its middle, after a tab switch). While followed, the end stays in sight as the words grow,
// whatever drew them. A box that is hidden (another tab in front: display:none) loses its scroll position, and the
// browser may say so with a scroll event as it shows again: the place you left is put back once it shows — the end where
// you followed it, else where you were.

import { shouldFollow } from "./labels.js";

/**
 * Follow `scrolls` for `tail`: its `following` is kept as you scroll, the end kept in sight as what it holds grows, and
 * the place you left put back as the box shows again. Answers how to let go of it — a box another thread mounts next is
 * never judged for this one.
 * @param {HTMLElement} scrolls @param {{ following: boolean }} tail @returns {() => void}
 */
export function followScroll(scrolls, tail) {
  let hidden = scrolls.clientHeight === 0;
  /** Where the box stood at the last scroll judged: from it, which way a scroll went. */
  let top = scrolls.scrollTop;
  const toEnd = () => {
    scrolls.scrollTop = scrolls.scrollHeight;
    top = scrolls.scrollTop;
  };
  const onScroll = () => {
    if (hidden || scrolls.clientHeight === 0) return;
    const now = scrolls.scrollTop;
    tail.following = shouldFollow(scrolls.scrollHeight - now - scrolls.clientHeight, tail.following, now < top);
    top = now;
  };
  scrolls.addEventListener("scroll", onScroll);
  const Sizes = /** @type {any} */ (globalThis).ResizeObserver;
  /** @type {{ observe: (el: Element) => void, disconnect: () => void } | null} */
  const sizes =
    typeof Sizes === "function"
      ? new Sizes(() => {
          const now = scrolls.clientHeight === 0;
          if (now !== hidden) {
            hidden = now;
            if (hidden) return;
            if (tail.following) return toEnd();
            scrolls.scrollTop = top;
            return;
          }
          // The words grew, or the box did, while followed.
          if (!hidden && tail.following) toEnd();
        })
      : null;
  if (sizes) {
    sizes.observe(scrolls);
    // What it holds: the thread's body, which grows as its words come.
    for (const child of Array.from(scrolls.children ?? [])) sizes.observe(child);
  }
  return () => {
    scrolls.removeEventListener?.("scroll", onScroll);
    sizes?.disconnect();
  };
}
