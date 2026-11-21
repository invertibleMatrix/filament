// @ts-check
// The typing row as its room runs out (the owner's of 11-14, the composer on a narrow, upright screen: "if there is no
// space then simply collapse the button into small button" — the permission chip first, then the plan's usage, the
// Context, the model, the effort): the row holds on one line, each pill at its own width, never squeezed under the
// next; while what it shows is wider than it, one pill more folds to its glyph, in that order, and as room comes back
// they unfold, the last folded first. Nothing folds while it all fits. A folded pill keeps its name for a screen reader
// and its tooltip whole (aqua.css says what each fold hides). Past the last fold, the widgets' part of the row gives
// way (`is-squeezed`), so nothing covers Send.

/** The folds, in the order they go: each a class on the row, `fold-<name>`. */
export const FOLDS = Object.freeze(["mode", "usage", "team", "context", "model", "effort"]);

/** The least time between two fits a folded row's changed words ask for. */
export const AGAIN_MS = 400;

/**
 * The fewest folds with which the row holds what it shows — `fits(n)` lays it out with the first `n` folded and says
 * whether it fits — every fold where none does.
 * @param {(n: number) => boolean} fits @param {number} [most]
 */
export function foldsNeeded(fits, most = FOLDS.length) {
  for (let n = 0; n < most; n++) if (fits(n)) return n;
  return most;
}

/**
 * Whether the row holds its parts: none of their boxes ends past its own, give or take a rounding. Their boxes, not the
 * row's scrollWidth, which counts what is drawn around a part — Stop's ring, 4 px past its edge while a turn runs —
 * and would fold every pill for the length of a turn. A row with no layout to read (hidden, none drawn yet) holds.
 * @param {any} bar
 */
export function holds(bar) {
  const room = bar.getBoundingClientRect?.();
  if (!room?.width) return true;
  for (const part of Array.from(bar.children || [])) {
    const box = /** @type {any} */ (part).getBoundingClientRect?.();
    if (box?.width && box.right > room.right + 1) return false;
  }
  return true;
}

/**
 * Keep a row folded as its room needs: now, and each time it or one of its parts changes size (a window narrowed, a
 * pill's words grown, a widget shown in its slot) — its parts too, for a pill can grow while the spring that takes the
 * room left over has none left to give, and the row itself stays as wide. A fit lays the row out once a fold, from
 * none; a row not laid out (hidden) fits as it is, and fits again once shown. A part that moved alone is fitted at the
 * next frame: a fold moves its neighbours, which the observer would otherwise hand on as a loop it gives up on. And
 * while a pill is folded, the words it hides move no size — Context's figure back down, a shorter model's name — so
 * the row's words changing fit it again, no more than once in `AGAIN_MS`: an unfold can wait, a reply's stream won't.
 * @param {any} bar  the row: its parts are the ones it holds now
 * @param {{ Observer?: any, Mutations?: any, frame?: (fn: () => void) => any, wait?: (fn: () => void, ms: number) => any }} [io]
 *   the ResizeObserver and MutationObserver to watch with, the frame and the timer to wait for: the page's by
 *   default; with no frame to wait for, a fit at once
 * @returns {{ fit: () => number, stop: () => void }}  `fit` folds it now and says how many folds it took
 */
export function foldToFit(bar, io = {}) {
  const set = (/** @type {number} */ n) => FOLDS.forEach((f, i) => bar.classList.toggle(`fold-${f}`, i < n));
  const fits = () => holds(bar);
  let folds = 0;
  const fit = () => {
    bar.classList.remove("is-squeezed");
    const n = foldsNeeded((k) => {
      set(k);
      return fits();
    });
    set(n);
    if (n === FOLDS.length && !fits()) bar.classList.add("is-squeezed");
    return (folds = n);
  };
  const frame = "frame" in io ? io.frame : globalThis.requestAnimationFrame?.bind(globalThis);
  let waiting = false;
  const later = () => {
    if (typeof frame !== "function") return void fit();
    if (waiting) return;
    waiting = true;
    frame(() => {
      waiting = false;
      fit();
    });
  };
  const Observer = "Observer" in io ? io.Observer : globalThis.ResizeObserver;
  const seen = typeof Observer === "function"
    ? new Observer((/** @type {{ target: any }[]} */ moved) => (moved.some((m) => m.target === bar) ? fit() : later()))
    : null;
  for (const part of [bar, ...Array.from(bar.children || [])]) seen?.observe(part);
  const wait = "wait" in io ? io.wait : globalThis.setTimeout?.bind(globalThis);
  let soon = /** @type {any} */ (null);
  const Mutations = "Mutations" in io ? io.Mutations : globalThis.MutationObserver;
  const said = typeof Mutations === "function" && typeof wait === "function"
    ? new Mutations(() => {
      if (!folds || soon) return;
      soon = wait(() => {
        soon = null;
        fit();
      }, AGAIN_MS);
    })
    : null;
  // Its words and its parts, not its classes: a fit's own folds are no change to answer.
  said?.observe(bar, { subtree: true, childList: true, characterData: true });
  fit();
  return {
    fit,
    stop: () => {
      seen?.disconnect();
      said?.disconnect();
      if (soon) globalThis.clearTimeout?.(soon);
    },
  };
}
