// @ts-check
// The page's `h` with a layout, for the Plan view's follow (views/plan.js `reveal`, which reads boxes off the page):
// the view's scroller as tall as the test says, and in it, under a head, the canvas's own scroller (the owner's of
// 11-10: a workspace that scrolls itself) as tall as the test says — taller than any drawing where it says none — and in
// that each task's box where the drawing places it (task-graph.js `placeOf`); each line of the rail beside the chat, a
// task's or the folded steps' row, one under another in the order drawn. Only these have a box, a placed one at its
// drawing's zoom; each scroller's `scrollTop` moves what is in it, as a browser's does. Where the test gives the page a
// width, the canvas is as wide as the room the card beside it leaves (task-graph.js `roomFor`), a placed box has its
// sides, and the canvas's `scrollLeft` — never under 0 — moves them.
import { fakeH } from "./fake-dom.js";

/** The room above the drawing — the plan's head and the graph's — px. */
const HEAD = 120;
/** A rail line's pitch, px. */
const ROW = 36;
/** A canvas the test gives no height: taller than any drawing. */
const ENDLESS = 1e9;
/** A box placed by the drawing: its top and height; and its left and width. */
const PLACED = /top:(-?[\d.]+)px;.*height:([\d.]+)px/;
const ACROSS = /left:(-?[\d.]+)px;.*width:([\d.]+)px/;
/** The page's padding across, and the card's column and its gap beside the canvas, px (views.css; plan.js `room`). */
const PAD = 40;
const CARD_BESIDE = 402;
/** The classes that have a box: a task's line, the folded steps' row. */
const LINES = ["tg-node", "tg-fold"];

/** @param {any} n */
const classesOf = (n) => String(n?.attrs?.class || "").split(/\s+/);
/** Whether `n` is under `root`. @param {any} root @param {any} n @returns {boolean} */
const holds = (root, n) => (root.kids || []).some((/** @type {any} */ k) => k && typeof k === "object" && (k === n || holds(k, n)));
/** Every line under `root` the drawing did not place — the rail's — in order. @param {any} root @param {any[]} [out] @returns {any[]} */
const railOf = (root, out = []) => {
  for (const k of root.kids || []) {
    if (!k || typeof k !== "object") continue;
    if (LINES.some((c) => classesOf(k).includes(c)) && !PLACED.test(String(k.attrs?.style || ""))) out.push(k);
    railOf(k, out);
  }
  return out;
};

/**
 * @param {{ height: number, canvas?: number, width?: number }} size  the scroller's height as a draw finds it: 0 while
 *   the view is hidden; the canvas's, none for one taller than its drawing; the scroller's width, none for a page whose
 *   width says nothing (its boxes' sides unknown)
 * @returns {{ h: any, inSight: (el: any) => boolean, scroller: () => any, canvas: () => any, drawn: () => number }}
 *   `inSight`: the whole box within the scroller's view, and the canvas's where it is on one — both ways where the page
 *   has a width; `scroller`, `canvas`: the newest view's; `drawn`: how many drawings were made
 */
export function laidOut(size) {
  /** @type {any[]} */
  const scrollers = [];
  /** @type {any[]} */
  const canvases = [];
  /** The drawings, each scaled to its zoom (task-graph.js `transform:scale(z)`). @type {any[]} */
  const drawings = [];
  /** The Plan pages' inner boxes, the workspace's where the class says (plan.js `paintNow`). @type {any[]} */
  const inners = [];
  /** The graphs' bodies: the card beside the canvas where the class says (task-graph.js `drawGraph`). @type {any[]} */
  const bodies = [];
  /** The zoom a placed box is drawn at: its drawing's scale, 1 where none is said. @param {any} n */
  const zoomOf = (n) => Number(/scale\(([\d.]+)\)/.exec(String(drawings.find((d) => holds(d, n))?.attrs?.style || ""))?.[1] || 1);
  /** The page's scroller that holds `n`. @param {any} n */
  const pageOf = (n) => scrollers.find((s) => holds(s, n));
  /** The canvas's width: the room less the card beside it, and its frame. @param {any} v */
  const canvasWide = (v) => Number(size.width) - PAD - (bodies.some((b) => classesOf(b).includes("is-beside") && holds(b, v)) ? CARD_BESIDE : 0) - 2;
  /** The canvas's box on the page: under the head, as tall as the test says; at the page's left, as wide as its room. @param {any} v */
  const canvasBox = (v) => {
    const top = HEAD - (pageOf(v)?.scrollTop || 0);
    return { top, bottom: top + (size.canvas ?? ENDLESS), ...(size.width === undefined ? {} : { left: 0, right: canvasWide(v) }) };
  };
  /** @param {any} n @returns {{ top: number, bottom: number, left?: number, right?: number } | null} */
  const boxOf = (n) => {
    const sc = pageOf(n);
    if (!sc) return null;
    const m = PLACED.exec(String(n.attrs?.style || ""));
    const view = m ? canvases.find((v) => holds(v, n)) : null;
    const panned = view?.scrollTop || 0;
    const z = m ? zoomOf(n) : 1;
    const [y, tall] = m ? [HEAD + Number(m[1]) * z, Number(m[2]) * z] : [HEAD + railOf(sc).indexOf(n) * ROW, ROW - 4];
    const a = m && size.width !== undefined ? ACROSS.exec(String(n.attrs?.style || "")) : null;
    const x = a ? Number(a[1]) * z - (view?.scrollLeft || 0) : 0;
    return { top: y - sc.scrollTop - panned, bottom: y + tall - sc.scrollTop - panned, ...(a ? { left: x, right: x + Number(a[2]) * z } : {}) };
  };
  const h = (/** @type {string} */ tag, /** @type {any} */ attrs, /** @type {any[]} */ ...kids) => {
    const n = fakeH(tag, attrs, ...kids);
    const cls = classesOf(n);
    if (cls.includes("pv-scroll")) {
      // As tall as the test said when it was made, and as it says since (`clientHeight`): a hidden view shown.
      Object.assign(n, { clientHeight: size.height, scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: Number(n.clientHeight) }) });
      if (size.width !== undefined) Object.defineProperty(n, "clientWidth", { get: () => size.width });
      scrollers.push(n);
    } else if (cls.includes("tg-body")) {
      bodies.push(n);
    } else if (cls.includes("pv-inner")) {
      inners.push(n);
    } else if (cls.includes("tg-canvas-view")) {
      // As tall as the test says in the workspace (views.css `.pv-inner.is-workspace`); out of it, as its drawing.
      const inWorkspace = () => inners.some((i) => classesOf(i).includes("is-workspace") && holds(i, n));
      Object.assign(n, { scrollTop: 0, scrollLeft: 0, getBoundingClientRect: () => canvasBox(n) });
      Object.defineProperty(n, "clientHeight", { get: () => (inWorkspace() ? size.canvas ?? ENDLESS : ENDLESS) });
      // Across, never before its start, as a browser's.
      let left = 0;
      if (size.width !== undefined) Object.defineProperty(n, "scrollLeft", { get: () => left, set: (x) => { left = Math.max(0, Number(x) || 0); } });
      canvases.push(n);
    } else if (cls.includes("tg-canvas")) {
      drawings.push(n);
    } else if (LINES.some((c) => cls.includes(c))) {
      n.getBoundingClientRect = () => boxOf(n);
    }
    return n;
  };
  return {
    h,
    inSight: (el) => {
      const b = el && boxOf(el);
      const v = canvases.find((c) => holds(c, el));
      const port = v ? canvasBox(v) : null;
      const across = !port || b?.left === undefined || port.left === undefined || (b.left >= port.left && /** @type {number} */ (b.right) <= /** @type {number} */ (port.right));
      return !!b && b.top >= 0 && b.bottom <= Number(pageOf(el)?.clientHeight) && (!port || (b.top >= port.top && b.bottom <= port.bottom)) && across;
    },
    scroller: () => scrollers.at(-1),
    canvas: () => canvases.at(-1),
    drawn: () => drawings.length,
  };
}
