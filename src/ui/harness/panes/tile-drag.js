// @ts-check
// Moving a pane by hand (proposal_ux §3.5): a tab — or a pane alone in its tile, by its title — dragged onto another
// tile's tabs to join them, or to one of a tile's edges to tile beside it there. Pointer events, not the page's drag
// API: where it would land is drawn under the pointer as it moves (half a tile for an edge, the whole tile to join it),
// a place the host refuses is never offered, Esc or a release off every tile cancels, and nothing moves until the
// pointer is let go. A press that never moved stays a click. The drag listens on the window, so it ends even where its
// handle was drawn anew under it (a count landed in the tile's head).
import { h } from "../../lib/dom.js";
import { glyphOf } from "../lib/icons.js";

/** How far the pointer moves before a press is a drag. */
const SLOP = 5;
/** A tile's edge zone, as a share of its width or height: closer to an edge than this, the drop tiles beside it there. */
const EDGE = 0.25;

/**
 * @typedef {"left" | "right" | "top" | "bottom"} Edge
 * @typedef {{ tile: string, edge?: Edge, index?: number }} Drop  `index`: where among the tile's tabs it joins
 */

/**
 * Where a drop at a point lands, against a tile's box and its head's tab boxes: on the head, among the tabs (before the
 * first whose middle is right of the point); in the body, an edge where the point is within EDGE of it — the nearest
 * one — else the middle, joining its tabs at their end. Pure, for the tests.
 * @param {{ x: number, y: number }} p
 * @param {{ left: number, top: number, width: number, height: number }} box  the tile
 * @param {number} headBottom  the head's lower edge
 * @param {{ left: number, width: number }[]} tabs  the head's tabs, left to right; none for a tile showing one pane
 * @returns {{ edge: Edge | null, index: number }}
 */
export function dropAt(p, box, headBottom, tabs) {
  if (p.y <= headBottom) {
    const i = tabs.findIndex((t) => p.x < t.left + t.width / 2);
    return { edge: null, index: i < 0 ? Math.max(1, tabs.length) : i };
  }
  const dx = (p.x - box.left) / box.width;
  const dy = (p.y - box.top) / box.height;
  /** @type {[Edge, number][]} */
  const near = [["left", dx], ["right", 1 - dx], ["top", dy], ["bottom", 1 - dy]];
  const [edge, d] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
  return d < EDGE ? { edge, index: 0 } : { edge: null, index: Math.max(1, tabs.length) };
}

/**
 * Make a handle drag a tab.
 * @param {HTMLElement} handle
 * @param {{ id: () => string, label: () => string, icon: () => string, frame: HTMLElement,
 *   allowed: (tile: string, edge: Edge | null, id: string) => boolean, onDrop: (id: string, to: Drop) => void,
 *   onDragging?: (on: boolean) => void }} o
 *   `frame`: the panes' frame, where the landing place is drawn; `allowed`: whether the host takes a drop there
 */
export function dragTab(handle, o) {
  /** A drag just ended on this handle: the click its release makes is not a click. */
  let dragged = false;
  handle.addEventListener("click", (e) => {
    if (!dragged) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || /** @type {HTMLElement} */ (e.target).closest("[data-no-drag]")) return;
    const id = o.id();
    if (!id) return;
    const start = { x: e.clientX, y: e.clientY };
    const pointer = e.pointerId;
    /** @type {HTMLElement | null} */
    let ghost = null;
    /** @type {HTMLElement | null} */
    let mark = null;

    const end = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      try { handle.releasePointerCapture(pointer); } catch {}
      ghost?.remove();
      mark?.remove();
      if (ghost) {
        o.onDragging?.(false);
        // The release's click lands in this task; the flag is down by the next one.
        dragged = true;
        setTimeout(() => { dragged = false; }, 0);
      }
    };
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      if (ev.pointerId !== pointer) return;
      if (!ghost || !mark) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < SLOP) return;
        const g = /** @type {HTMLElement} */ (h("div", { class: "tile-ghost", "aria-hidden": "true" }, h("span", { class: "tile-ghost-ic", html: glyphOf(o.icon()) }), o.label()));
        const m = /** @type {HTMLElement} */ (h("div", { class: "tile-drop hidden", "aria-hidden": "true" }));
        document.body.append(g);
        o.frame.append(m);
        ghost = g;
        mark = m;
        o.onDragging?.(true);
      }
      ghost.style.transform = `translate(${Math.round(ev.clientX + 12)}px, ${Math.round(ev.clientY + 10)}px)`;
      paintMark(mark, landing(ev.clientX, ev.clientY, id));
    };
    /** @param {PointerEvent} ev */
    const up = (ev) => {
      if (ev.pointerId !== pointer) return;
      const drop = ghost ? landing(ev.clientX, ev.clientY, id) : null;
      end();
      if (drop) o.onDrop(id, drop);
    };
    /** @param {PointerEvent} ev */
    const cancel = (ev) => {
      if (ev.pointerId === pointer) end();
    };
    /** @param {KeyboardEvent} ev */
    const key = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end();
    };
    try { handle.setPointerCapture(pointer); } catch {}
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
  });

  /**
   * Where the point lands: the tile under it and its place there, as the host allows it — an edge it refuses falls back
   * to joining the tile, where that is allowed.
   * @param {number} x @param {number} y @param {string} id @returns {Drop | null}
   */
  function landing(x, y, id) {
    const under = /** @type {HTMLElement | null} */ (document.elementFromPoint(x, y)?.closest(".tile") || null);
    const tile = under?.dataset.tile;
    if (!under || !tile || !o.frame.contains(under)) return null;
    const head = /** @type {HTMLElement} */ (under.querySelector(":scope > .tile-head"));
    const tabs = Array.from(under.querySelectorAll(":scope > .tile-head .tile-tab"), (t) => t.getBoundingClientRect());
    const at = dropAt({ x, y }, under.getBoundingClientRect(), head.getBoundingClientRect().bottom, tabs);
    if (at.edge && o.allowed(tile, at.edge, id)) return { tile, edge: at.edge };
    return o.allowed(tile, null, id) ? { tile, index: at.edge ? Math.max(1, tabs.length) : at.index } : null;
  }

  /** The landing place drawn: half the tile on an edge, the whole of it to join. @param {HTMLElement} mark @param {Drop | null} to */
  function paintMark(mark, to) {
    const tile = to ? /** @type {HTMLElement | null} */ (o.frame.querySelector(`.tile[data-tile="${to.tile}"]`)) : null;
    mark.classList.toggle("hidden", !tile);
    if (!tile || !to) return;
    const f = o.frame.getBoundingClientRect();
    const r = tile.getBoundingClientRect();
    let { left, top, width, height } = { left: r.left - f.left, top: r.top - f.top, width: r.width, height: r.height };
    if (to.edge === "left" || to.edge === "right") {
      width /= 2;
      if (to.edge === "right") left += width;
    } else if (to.edge === "top" || to.edge === "bottom") {
      height /= 2;
      if (to.edge === "bottom") top += height;
    }
    mark.classList.toggle("join", !to.edge);
    mark.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    mark.style.width = `${Math.round(width)}px`;
    mark.style.height = `${Math.round(height)}px`;
  }
}
