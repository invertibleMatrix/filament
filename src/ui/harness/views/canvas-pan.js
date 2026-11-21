// @ts-check
// The Plan tab's canvas, moved by hand (the owner's of 11-07: "i should be able to pan around the task graph view …
// also i should be able to zoom in and out with scroller"): a press anywhere on it and a move pans it both ways in its
// own scroller — a workspace the window's height since the owner's of 11-10, the page left where it is — and the wheel
// over it zooms about the pointer, the point under it staying under it. The page draws the canvas anew as the work
// moves (views/plan.js), so all of it listens on the page's own scroller, which stays, and moves whichever canvas is
// drawn now; a drag holds the page's draws until it ends. A press that moves less than `PAN_SLOP` is a press: a task's
// click is its own; a drag's click is the drag's. Sideways, the wheel is the canvas's own scroll, and a finger's drag
// the browser's own pan.
import { ZOOM } from "./task-graph.js";

/** How far a press moves, px, before it is a drag. */
export const PAN_SLOP = 4;
/** How much a wheel's pixel of travel zooms: a notch (100 px) in or out by about a fifth. */
export const WHEEL_RATE = 0.002;
/** What a press focuses as a browser's own would, which its cancelled default no longer does: a control, a link. */
const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]";

/** A wheel's travel down, px: a line's or a page's counted as the pixels it stands for. @param {{ deltaY?: number, deltaMode?: number }} e */
const wheelPx = (e) => (Number(e.deltaY) || 0) * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);

/**
 * The zoom a turn of the wheel leads to from `z`: toward you in, away out, within the zoom's bounds.
 * @param {number} z @param {{ deltaY?: number, deltaMode?: number }} e
 */
export function wheelZoomOf(z, e) {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, z * Math.exp(-wheelPx(e) * WHEEL_RATE)));
}

/**
 * Where the canvas's scroller stands once the zoom goes from `z` to `z2`, so the point under the pointer stays under
 * it: both ways from the drawing's start in its scroller (a drawing smaller than it is centred, and scrolls not at all).
 * @param {{ z: number, z2: number, x: number, y: number, view: { left: number, top: number }, size: { left: number, top: number } }} o
 *   `x`, `y`: the pointer; `view`: the canvas's scroller's box; `size`: the drawing's box — each as the page lays them
 *   out now
 * @returns {{ left: number, top: number }}
 */
export function zoomAround({ z, z2, x, y, view, size }) {
  const px = (x - size.left) / z;
  const py = (y - size.top) / z;
  return { left: Math.max(0, px * z2 - (x - view.left)), top: Math.max(0, py * z2 - (y - view.top)) };
}

/**
 * The canvas moved by hand, listening on the page's scroller (`host`), which stays as the page draws anew.
 * @param {any} host  the page's scroller, where the canvas's presses and wheels are heard: the canvas pans itself
 * @param {{ view: () => any, inCanvas: (target: any) => boolean, zoom: () => number,
 *   setZoom: (z: number, at: { left: number, top: number }) => void, hold: (on: boolean) => void, moved?: () => void,
 *   win?: { addEventListener: Function, removeEventListener: Function, requestAnimationFrame?: Function },
 *   soon?: (fn: () => void) => void }} o
 *   `view`: the canvas's scroller drawn now, null where none is; `inCanvas`: whether a press or a wheel is on it;
 *   `zoom`: the zoom it draws at; `setZoom`: the page draws at that zoom, its
 *   scrollers where `at` says; `hold`: the page's draws held while a drag, or a press of the canvas's scrollbar, goes on,
 *   and let go; `moved`: the person moved
 *   it; `win`: where a drag's moves are heard, past the canvas's edge too, and the frame a wheel's zoom waits for
 */
export function armCanvas(host, { view, inCanvas, zoom, setZoom, hold, moved = () => {}, win = globalThis, soon = (fn) => void setTimeout(fn, 0) }) {
  /** The press under way: where it began, where the scrollers stood, whether it is a drag yet. @type {{ x: number, y: number, left: number, top: number, id: number, on: boolean } | null} */
  let press = null;
  /** A drag just ended: the click it ends in is its own. */
  let swallow = false;
  /** The wheel's travel since the last frame, and where the pointer was at its last turn. @type {{ px: number, x: number, y: number } | null} */
  let turned = null;
  /** @param {() => void} fn */
  const frame = (fn) => (typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame(fn) : setTimeout(fn, 16));

  const move = (/** @type {any} */ e) => {
    if (!press || e.pointerId !== press.id) return;
    // A mouse let go where no pointerup was heard — another window took it mid-drag —: the drag is over.
    if (e.pointerType === "mouse" && !(Number(e.buttons) & 1)) return up(e);
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.on) {
      if (Math.hypot(dx, dy) < PAN_SLOP) return;
      press.on = true;
      hold(true);
      host.classList.add("is-panning");
    }
    const v = view();
    if (v) {
      v.scrollLeft = Math.max(0, press.left - dx);
      v.scrollTop = Math.max(0, press.top - dy);
    }
    moved();
  };
  const up = (/** @type {any} */ e) => {
    if (!press || e.pointerId !== press.id) return;
    const was = press.on;
    press = null;
    win.removeEventListener("pointermove", move);
    win.removeEventListener("pointerup", up);
    win.removeEventListener("pointercancel", up);
    win.removeEventListener("blur", lost);
    if (!was) return;
    host.classList.remove("is-panning");
    swallow = true;
    soon(() => void (swallow = false));
    hold(false);
  };
  /** The window left mid-press: no pointerup may come for it. */
  const lost = () => void (press && up({ pointerId: press.id }));
  /** The scrollbar's press under way, by its pointer: the page's draws held until it is let go. @type {number | null} */
  let barId = null;
  const barUp = (/** @type {any} */ e) => {
    if (barId === null || (e?.pointerId !== undefined && e.pointerId !== barId)) return;
    barId = null;
    win.removeEventListener("pointerup", barUp);
    win.removeEventListener("pointercancel", barUp);
    win.removeEventListener("blur", barUp);
    hold(false);
  };
  host.addEventListener("pointerdown", (/** @type {any} */ e) => {
    // A finger's drag is the browser's own pan, both ways.
    if (e.button !== 0 || e.pointerType === "touch" || press || barId !== null || !inCanvas(e.target)) return;
    const v = view();
    // The canvas's own scrollbar is its own — a move of the person's, as a drag is (the review of d5aa58d31: the page's
    // scrollbar was the one down before, and the page heard its press; the canvas's went unheard) — and the draws wait
    // for it to be let go, as a drag's do: a canvas drawn anew took it from under the pointer (the review of 67038d835).
    if (v && e.target === v && (e.offsetY > Number(v.clientHeight) || e.offsetX > Number(v.clientWidth))) {
      moved();
      barId = e.pointerId;
      hold(true);
      win.addEventListener("pointerup", barUp);
      win.addEventListener("pointercancel", barUp);
      win.addEventListener("blur", barUp);
      return;
    }
    press = { x: e.clientX, y: e.clientY, left: Number(v?.scrollLeft) || 0, top: Number(v?.scrollTop) || 0, id: e.pointerId, on: false };
    // No words selected as it drags; a task's click still comes — and the focus a press gives, given here.
    e.preventDefault();
    const control = e.target?.closest?.(FOCUSABLE);
    if (typeof control?.focus === "function") control.focus({ preventScroll: true });
    else host.ownerDocument?.activeElement?.blur?.();
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", up);
    win.addEventListener("pointercancel", up);
    win.addEventListener("blur", lost);
  });
  host.addEventListener(
    "click",
    (/** @type {any} */ e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true },
  );
  /** The wheel's travel since the last frame, as one zoom: a trackpad's turns come many a frame, and each draws the graph whole. */
  const zoomNow = () => {
    const t = turned;
    turned = null;
    const v = view();
    if (!t || press || !v) return;
    const z = zoom();
    const z2 = wheelZoomOf(z, { deltaY: t.px });
    if (z2 === z) return;
    const size = v.querySelector(".tg-canvas-size")?.getBoundingClientRect();
    if (!size) return;
    setZoom(z2, zoomAround({ z, z2, x: t.x, y: t.y, view: v.getBoundingClientRect(), size }));
  };
  host.addEventListener(
    "wheel",
    (/** @type {any} */ e) => {
      if (!view() || !inCanvas(e.target)) return;
      // Sideways — a trackpad's swipe, Shift and the wheel — is the canvas's own scroll.
      if (e.shiftKey || Math.abs(Number(e.deltaX) || 0) >= Math.abs(Number(e.deltaY) || 0)) return;
      e.preventDefault();
      // While a press is under way the wheel zooms nothing: the drag holds the draws, and moves from where it began.
      if (press) return;
      const first = !turned;
      turned = { px: (turned?.px || 0) + wheelPx(e), x: e.clientX, y: e.clientY };
      if (first) frame(zoomNow);
    },
    { passive: false },
  );
}
