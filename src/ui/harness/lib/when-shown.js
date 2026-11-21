// @ts-check
// What a card waits to do until it comes near the screen: a long session's visuals and artifacts are read as they
// come into view, not all at once as it opens. "Near" is half a screen above and below what its scroller shows: an
// observer's margin widens only its root, and a card's scroller — the transcript, a thread's pane — clips it before
// the window does, so each card is watched against the scroller it stands in (the review of 11-02: watched against the
// window, a card read only once it was in sight).

/** What each element waits to do. @type {WeakMap<Element, () => void>} */
const onScreen = new WeakMap();
/** The watcher of each scroller: one taken off the page goes with it. @type {WeakMap<Element, IntersectionObserver>} */
const watchers = new WeakMap();
/** The watcher of what scrolls with the window. @type {IntersectionObserver | null} */
let windowWatcher = null;

/** The nearest element above `el` that scrolls it; null where none does but the window. @param {Element} el */
function scrollerOf(el) {
  if (typeof getComputedStyle !== "function") return null;
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if (o === "auto" || o === "scroll" || o === "overlay") return n;
  }
  return null;
}

/** A watcher of what nears `root`'s view. @param {Element | null} root */
function watcher(root) {
  const made = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      made.unobserve(e.target);
      const go = onScreen.get(e.target);
      onScreen.delete(e.target);
      go?.();
    }
  }, { root, rootMargin: "50% 0px" });
  return made;
}

/**
 * Run `go` once `el` is near the screen: at once where the page cannot tell.
 * @param {Element} el @param {() => void} go
 */
export function whenShown(el, go) {
  if (typeof IntersectionObserver !== "function") return go();
  onScreen.set(el, go);
  const root = scrollerOf(el);
  let w = root ? watchers.get(root) : windowWatcher;
  if (!w) {
    w = watcher(root);
    if (root) watchers.set(root, w);
    else windowWatcher = w;
  }
  w.observe(el);
}
