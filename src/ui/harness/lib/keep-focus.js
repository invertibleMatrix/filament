// @ts-check
// A view that draws itself again whole keeps the keyboard's place (HarnessV4_Tasks U4). The Plan view rebuilds its
// nodes on every pulse of a run (views/host.js, every 1.2 s while the run moves), and a rebuilt node is a new one: the
// control that had the focus was gone, and the focus fell back to the page. So a redraw remembers where the focused
// control sat under the view's root — the child indexes down to it — and what it was (its tag, its label), and puts
// the focus on the control that sits there after the redraw when it is the same one. A control that is gone, or
// another one now, is let go: the focus never lands somewhere the person did not put it.

/**
 * What a control is, for telling the same one after a redraw: its tag, its kind and its label — never its state.
 * @param {any} el
 */
export function controlSign(el) {
  const attr = (/** @type {string} */ k) => String(el?.getAttribute?.(k) || "");
  const label = attr("aria-label") || attr("title") || String(el?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${String(el?.tagName || "").toLowerCase()}|${attr("type")}|${attr("role")}|${label}`;
}

/**
 * Where a node sits under a root: the child indexes from the root down to it. Null when it is not under the root, or
 * is the root itself.
 * @param {any} root @param {any} node @returns {number[] | null}
 */
export function pathUnder(root, node) {
  /** @type {number[]} */
  const path = [];
  for (let at = node; at && at !== root; at = at.parentElement) {
    const up = at.parentElement;
    if (!up) return null;
    path.unshift(Array.prototype.indexOf.call(up.children, at));
  }
  return path.length ? path : null;
}

/** The node at a path under a root, or null where the tree no longer goes that far. @param {any} root @param {number[]} path */
export function nodeAt(root, path) {
  let at = root;
  for (const i of path) {
    at = at?.children?.[i];
    if (!at) return null;
  }
  return at;
}

/** What runs after each redraw: ui.js closes there the menus whose trigger the redraw took away. @type {Set<() => void>} */
const afterRedraw = new Set();
/**
 * Something run after each redraw (found by the Hunter on S5a: a menu open on a row redrawn away floated, anchored to
 * nothing, until the next click). @param {() => void} fn
 */
export const onRedrawn = (fn) => void afterRedraw.add(fn);

/**
 * Run a redraw of `root`, and put the focus back on the control that had it. With no document (a test's stand-in
 * tree), or the focus elsewhere on the page, it is the redraw alone.
 * @param {any} root @param {() => void} redraw @param {{ activeElement: any } | null} [doc]
 */
export function keepingFocus(root, redraw, doc = typeof document === "undefined" ? null : document) {
  const had = doc?.activeElement || null;
  const path = had && had !== root && root?.contains?.(had) ? pathUnder(root, had) : null;
  const sign = path ? controlSign(had) : "";
  redraw();
  for (const fn of afterRedraw) fn();
  if (!path || !doc) return;
  const now = nodeAt(root, path);
  if (!now || now === doc.activeElement || controlSign(now) !== sign) return;
  now.focus?.({ preventScroll: true });
}
