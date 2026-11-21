// @ts-check
// The task graph's lines as the Plan page draws them (HarnessV4_TaskGraphPlus_Design D4, D5; the Product agent's
// redesign of 11-05, the owner's yes), pure: the tests draw them with numbers, the page with the places
// lib/graph-boxes.js lays out. A line means "needs" and nothing else: a soft curve from the foot of the task needed to
// the top of the one that needs it, straight down the gap of each row it passes — drawn left to right (the owner's of
// 11-14), from the right side of the task needed to the left of the one that needs it, straight across each column it
// passes. Its look: out of finished work it recedes, the chosen task's blue — no dash, no dot, no key. And the finished
// steps folded from the top (D16), and whether the graph is one straight line (D18).

/**
 * @typedef {{ id: string, needs: readonly string[], layer: number, state: string }} GTask
 * @typedef {{ x: number, y: number }} Pt
 * @typedef {{ x: number, top: number, bottom: number }} Pass  a row a line passes on its way down: the x of its slot there
 *   and the row's top and foot
 * @typedef {{ y: number, left: number, right: number }} PassAcross  a column a line passes on its way right: the y of its
 *   slot there and the column's left and right side
 * @typedef {"down" | "right"} Dir  the way the graph is drawn: a row a step, top to bottom — always the way it opens —
 *   or a column a step, left to right
 */

/** The fold row's id among the lines' ends: no task's id can be it, as a task named "fold" can (core's ids are a letter first). */
export const FOLD = "(fold)";

/** How far over a row's top and under its foot a line passing it runs straight, px. */
const STRAIGHT = 6;

/**
 * A line as an SVG path: from the foot of the task needed (`a`) to the top of the one that needs it (`b`), a curve that
 * leaves straight down and arrives straight down — through each row it passes (`via`), straight down that row's slot.
 * Drawn left to right (`dir` "right"), the same turned: from the right side of the task needed to the left of the one
 * that needs it, straight across each column it passes.
 * @param {Pt} a @param {Pt} b @param {readonly (Pass | PassAcross)[]} [via] @param {Dir} [dir] @returns {string}
 */
export function curvePath(a, b, via = [], dir = "down") {
  const f = (/** @type {number} */ n) => String(Math.round(n * 10) / 10);
  const across = dir === "right";
  // In the flow's own terms: `u` along it, `v` across it — a point written back in the drawing's.
  /** @param {number} u @param {number} v */
  const pt = (u, v) => (across ? `${f(u)},${f(v)}` : `${f(v)},${f(u)}`);
  /** One curve between two places, its bend half the way along. @param {number} pu @param {number} pv @param {number} qu @param {number} qv */
  const seg = (pu, pv, qu, qv) => {
    const bend = Math.max(12, (qu - pu) / 2);
    return ` C${pt(pu + bend, pv)} ${pt(qu - bend, qv)} ${pt(qu, qv)}`;
  };
  let [u, v] = across ? [a.x, a.y] : [a.y, a.x];
  let d = `M${pt(u, v)}`;
  for (const p of via) {
    const [at, from, to] = across ? [/** @type {PassAcross} */ (p).y, /** @type {PassAcross} */ (p).left, /** @type {PassAcross} */ (p).right] : [/** @type {Pass} */ (p).x, /** @type {Pass} */ (p).top, /** @type {Pass} */ (p).bottom];
    d += `${seg(u, v, from - STRAIGHT, at)} L${pt(to + STRAIGHT, at)}`;
    [u, v] = [to + STRAIGHT, at];
  }
  return d + (across ? seg(u, v, b.x, b.y) : seg(u, v, b.y, b.x));
}

/**
 * A line's look (D5) and the order it is drawn in: out of finished work it recedes (`done`) — every task it stands for
 * done or dropped, the folded steps' row's always — and the chosen task's lines are blue (`on`), drawn last.
 * @param {{ from: string, to: string, froms: readonly string[], tos: readonly string[] }} e  the tasks it stands for at
 *   either end: a hunt box's line stands for its task and its fixes
 * @param {Map<string, { state: string }>} byId @param {string | null} chosen
 * @returns {{ cls: string, p: number }}
 */
export function lineLook(e, byId, chosen) {
  const cls = ["e"];
  let p = 1;
  const over = (/** @type {string} */ id) => {
    const s = byId.get(id)?.state;
    return !s || s === "done" || s === "dropped";
  };
  if (e.from === FOLD || e.froms.every(over)) {
    cls.push("done");
    p = 0;
  }
  if (chosen && (e.froms.includes(chosen) || e.tos.includes(chosen))) {
    cls.push("on");
    p = 2;
  }
  return { cls: cls.join(" "), p };
}

/**
 * The finished steps folded from the top (D16): once three or more steps are finished with no open task above them,
 * all but the newest of them fold into one row. How many fold — 0 for none.
 * @param {readonly { state: string }[]} steps  top to bottom; a finished one's state is "done"
 */
export function foldCount(steps) {
  let n = 0;
  while (n < steps.length && steps[n].state === "done") n++;
  return n >= 3 ? n - 1 : 0;
}

/**
 * Whether the graph is one straight line (D18): three or more tasks not dropped, each needing the one before it and
 * nothing else, so none can run in parallel.
 * @param {readonly GTask[]} tasks
 */
export function straightLine(tasks) {
  const live = tasks.filter((t) => t.state !== "dropped");
  if (live.length < 3) return false;
  const ids = new Set(live.map((t) => t.id));
  const byDepth = [...live].sort((a, b) => a.layer - b.layer);
  return byDepth.every((t, i) => {
    const needs = t.needs.filter((n) => ids.has(n));
    return i === 0 ? needs.length === 0 && (i + 1 >= byDepth.length || byDepth[i + 1].layer > t.layer) : needs.length === 1 && needs[0] === byDepth[i - 1].id && byDepth[i - 1].layer < t.layer;
  });
}
