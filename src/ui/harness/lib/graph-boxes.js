// @ts-check
// The task graph laid out on the Plan page (the Product agent's redesign of 11-05, the owner's yes: a task one line, a
// row a step, a curved line a need), pure: numbers in, numbers out, no page — the tests lay it out with numbers, the
// page draws what it says. A task sits one row under the deepest of its needs, so every line runs down; a row is a step
// and never wraps — a wide graph zooms out or pans on the page instead. In a row, the order that crosses fewest lines:
// the view's order first, then sweeps that move each task toward the mean place of its needs, then of what needs it, the
// best kept — from the needs and the view's order alone, never a task's state, so nothing moves sideways while the work
// does. A line that skips rows takes a thin slot in each row it passes, ordered with the boxes, so it runs straight down
// between them; each box sits as near the middle of its needs and followers as its row allows. A task a bug hunt found
// that needs nothing of the graph but the task the hunt was fired from goes inside that task's box (`groupsOf`), as tall
// as the page draws it (`tall`); a line out of it leaves from the box's foot. A plan's step and its sub-tasks — each
// task given `under` it — are one box likewise (`stepsOf`, the owner's plan mode of 11-06): a need of any task in it is a
// line into the box, a need of one of them a line out of it. Three or more finished rows at the top fold into one, all
// but the newest — a row whose hunt box has a fix open is not finished.
// The person's Rearrange (the owner's of 11-14) looks harder for the order — from the drawing as it stands and three
// more starts, sweeps with each neighbour swapped where fewer lines cross, the fewest crossings kept, then the shortest
// lines — and the page keeps the order it found (`keep`), new tasks finding their places in it. Drawn left to right
// (`dir` "right"), a row is a column: the same order, top to bottom in it.
import { FOLD, foldCount } from "./graph-lanes.js";

/**
 * @typedef {{ id: string, needs: readonly string[], state: string, foundBy?: { task: string } | null, under?: string }} BTask
 * @typedef {{ x: number, y: number, w: number, h: number }} Box  from the drawing's corner, px
 * @typedef {import("./graph-lanes.js").Pt} Pt
 * @typedef {import("./graph-lanes.js").Pass} Pass
 * @typedef {import("./graph-lanes.js").PassAcross} PassAcross
 * @typedef {import("./graph-lanes.js").Dir} Dir
 * @typedef {{ from: string, to: string, froms: string[], tos: string[], a: Pt, b: Pt, via: (Pass | PassAcross)[] }} Line
 *   a need's line between two boxes — `from` FOLD out of the folded row — the tasks it stands for at either end (a hunt
 *   box stands for its fixes too), where it leaves and arrives, and the rows it passes on its way (columns, drawn left
 *   to right)
 * @typedef {{ boxes: Map<string, Box>, rows: string[][], groups: Map<string, string[]>, steps: Map<string, string[]>,
 *   lines: Line[], fold: Box | null, foldLayers: number, folds: string[], hidden: string[], w: number, h: number,
 *   box: { w: number, h: number }, dir: Dir, order: string[][], crossings: number }} Layout
 *   each box shown by its task's id, a hunt box by its hunted task's, a step's by the step's; the rows top to bottom,
 *   each left to right; the hunt boxes and their fixes; the steps and their sub-tasks; the lines; the folded row; the
 *   finished steps at the top that fold (`foldLayers` of them, their tasks `folds`, shown or not) and those folded now
 *   (`hidden`); the drawing's size; a one-line box's; the way it is drawn; each row's order as drawn, the slots of the
 *   lines passing it among its boxes — what a Rearrange keeps (`keep`); and how many times two lines cross
 */

/**
 * A task's box at the page's usual type — two lines since the owner's of 11-10, its name the whole first, its id and
 * fact under it (views.css `.tg-canvas .tg-node`) — and the gaps between boxes across a row and between rows, px.
 */
export const BOX = Object.freeze({ w: 248, h: 52, gx: 28, gy: 40 });
/** The room above and under the drawing, and at its sides, px. */
export const PAD = 24;
export const PADX = 16;
/** The folded steps' row: its height and its least width, px — the gap under it a row's. */
const FOLD_H = 36;
const FOLD_W = 320;
/** The least room between a line's slot and a box beside it, and between two slots, px. */
const SLOT_PAD = 14;
const SLOT_GAP = 10;
/** How much more a line's slot holds to its wish than a box does: a line passing rows runs straight. */
const SLOT_WEIGHT = 3;
/** The order's sweeps, down and up, before the best is kept; then the places' rounds. */
const SWEEPS = 6;
const ROUNDS = 4;
/** A Rearrange's sweeps from each start, each with its neighbours' swaps; how much it compares at the most. */
const THOROUGH = 24;
// About a quarter of a second: a 150-task graph comes nowhere near it; one of 400 stops there with what it found.
const WORK = 25e6;
/**
 * Drawn left to right: the gap between two boxes of a column, between columns, and the folded steps' column's least
 * height, px — the gap between columns room for a line's curve.
 */
const ACROSS = Object.freeze({ gy: 16, gx: 64, foldH: 120 });

/**
 * Each task's layer: 0 for one with no needs among `ids`, else one under the deepest of its needs.
 * @param {readonly string[]} ids @param {Map<string, { needs: readonly string[] }>} byId @returns {Map<string, number>}
 */
export function layersOf(ids, byId) {
  const here = new Set(ids);
  /** @type {Map<string, number>} */
  const layer = new Map();
  /** @type {Set<string>} */
  const on = new Set();
  /** @param {string} id @returns {number} */
  const of = (id) => {
    const had = layer.get(id);
    if (had !== undefined) return had;
    // A loop of needs the core never makes: what closes it counts as no need.
    if (on.has(id)) return -1;
    on.add(id);
    const needs = (byId.get(id)?.needs || []).filter((n) => here.has(n) && n !== id);
    const d = Math.max(-1, ...needs.map(of)) + 1;
    on.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const id of ids) of(id);
  return layer;
}

/**
 * Places in a row, left to right, each as near its wish as the least distances between neighbours allow: the
 * weighted least squares, by pooling adjacent violators.
 * @param {readonly number[]} want @param {readonly number[]} weight
 * @param {readonly number[]} space  `space[i]`: the least distance from the place before to `i` (`space[0]` unused)
 * @returns {number[]}
 */
export function packRow(want, weight, space) {
  /** @type {number[]} */
  const off = [];
  want.forEach((_, i) => off.push(i ? off[i - 1] + space[i] : 0));
  /** @type {{ v: number, w: number, n: number }[]} */
  const blocks = [];
  want.forEach((x, i) => {
    let b = { v: x - off[i], w: weight[i], n: 1 };
    while (blocks.length && /** @type {{ v: number }} */ (blocks.at(-1)).v > b.v) {
      const p = /** @type {{ v: number, w: number, n: number }} */ (blocks.pop());
      b = { v: (p.v * p.w + b.v * b.w) / (p.w + b.w), w: p.w + b.w, n: p.n + b.n };
    }
    blocks.push(b);
  });
  /** @type {number[]} */
  const out = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.v + off[out.length]);
  return out;
}

/**
 * The step boxes (the owner's plan mode of 11-06): each task another is given under, with its sub-tasks — a dropped one
 * too, so a step dropped with them stays one box — in the order they run: by their needs among themselves, then the
 * view's. One level, as the core keeps it: a task under a sub-task stands apart.
 * @param {readonly BTask[]} tasks  in the view's order @returns {Map<string, string[]>}
 */
export function stepsOf(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const t of tasks) {
    const s = t.under ? byId.get(t.under) : undefined;
    if (!s || s.id === t.id || s.under) continue;
    out.set(s.id, [...(out.get(s.id) || []), t.id]);
  }
  for (const [s, kids] of out) {
    const at = layersOf(kids, byId);
    out.set(s, [...kids].sort((a, b) => /** @type {number} */ (at.get(a)) - /** @type {number} */ (at.get(b))));
  }
  return out;
}

/**
 * The hunt boxes (the owner's yes of 11-05: a hunt's fixes "inside the same node card"): each task a hunt was fired
 * from, with the tasks that take up what it found and need nothing of the graph but it, in the view's order. A fix that
 * needs another task too keeps a box of its own, as does a fix hunted in its turn — a fix found on it, or a Reviewer
 * sent from it (`fired`) — whose box holds its own hunt: a box never sits inside a box. A step's box holds its
 * sub-tasks (`stepsOf`): neither a step nor a sub-task is a hunt box, nor a fix in one.
 * @param {readonly BTask[]} tasks  in the view's order @param {((id: string) => boolean) | null} [fired]
 * @returns {Map<string, string[]>}
 */
export function groupsOf(tasks, fired = null) {
  const ids = new Set(tasks.map((t) => t.id));
  const found = new Set(tasks.map((t) => t.foundBy?.task));
  const steps = stepsOf(tasks);
  const stepped = new Set([...steps.keys(), ...[...steps.values()].flat()]);
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const t of tasks) {
    const on = t.foundBy?.task;
    if (!on || on === t.id || !ids.has(on) || found.has(t.id) || fired?.(t.id) || stepped.has(t.id) || stepped.has(on)) continue;
    const needs = t.needs.filter((n) => ids.has(n));
    if (needs.length !== 1 || needs[0] !== on) continue;
    out.set(on, [...(out.get(on) || []), t.id]);
  }
  return out;
}

/**
 * One item of a row's order: a task's box, or the slot a line that skips the row takes in it (`id` null, its line's
 * key `line`, the boxes it runs between `ends`) — the sweeps order the lines that pass a row with its boxes, so few
 * cross. `key`: what a kept order names it by — a box by its task's id and its row, a slot by its line's and its row:
 * one whose needs moved it to another row is new there.
 * @typedef {{ id: string | null, line: string, key: string, ends: [string | null, string], layer: number, ups: number[], downs: number[], at: number, rank: number }} Item
 */

/**
 * Each row's boxes and slots in the order that crosses fewest lines: the view's order first, then sweeps toward the mean
 * place of the neighbours above, then below, the fewest crossings kept; a line that skips rows takes a slot in each row
 * it passes. Where the person's Rearrange kept an order (`keep`), that order as it is, with no sweep: what is new since
 * goes in among it under what it needs.
 * `thorough`, a Rearrange's: from that start and three more — the view's order, the view's backwards, each task's
 * followers after it — more sweeps, each row's neighbours swapped where fewer lines cross, the fewest crossings kept,
 * then the shortest lines; none better than the start, the start. From the needs, the view's order and what the person
 * kept alone, never a task's state.
 * @param {readonly string[]} ids  the boxes shown, in the view's order @param {Map<string, number>} layer
 * @param {readonly { from: string, to: string, key: string }[]} edges
 * @param {{ keep?: readonly (readonly string[])[] | null, thorough?: boolean, base?: number }} [how]  `base`: the rows
 *   folded above, so a slot's key names its row however many fold
 * @returns {{ items: Item[], rows: number[][], crossings: number }}  every item, each row's, top to bottom, left to
 *   right, and how many times two lines cross
 */
function orderOf(ids, layer, edges, how = {}) {
  /** @type {Item[]} */
  const items = [];
  /** @type {Map<string, number>} */
  const itemOf = new Map();
  ids.forEach((id, i) => {
    itemOf.set(id, items.length);
    items.push({ id, line: "", key: `${id}@${/** @type {number} */ (layer.get(id)) + (how.base || 0)}`, ends: [null, id], layer: /** @type {number} */ (layer.get(id)), ups: [], downs: [], at: 0, rank: i });
  });
  for (const e of edges) {
    const to = itemOf.get(e.to);
    const from = e.from === FOLD ? null : itemOf.get(e.from);
    if (to === undefined || from === undefined) continue;
    const a = from === null ? -1 : items[from].layer;
    const b = items[to].layer;
    if (b <= a) continue;
    /** @type {number[]} */
    const chain = from === null ? [] : [from];
    for (let k = a + 1; k < b; k++) {
      chain.push(items.length);
      items.push({ id: null, line: e.key, key: `${e.key}@${k + (how.base || 0)}`, ends: [from === null ? null : e.from, e.to], layer: k, ups: [], downs: [], at: 0, rank: items[to].rank + (from === null ? 0 : items[from].rank) / (ids.length + 1) });
    }
    chain.push(to);
    for (let k = 1; k < chain.length; k++) {
      items[chain[k - 1]].downs.push(chain[k]);
      items[chain[k]].ups.push(chain[k - 1]);
    }
  }
  const depth = Math.max(0, ...items.map((it) => it.layer)) + 1;
  /** @type {number[][]} */
  const rows = Array.from({ length: depth }, () => []);
  items.forEach((it, i) => rows[it.layer].push(i));
  /** Each item's place in its row as a share of the row, the row in the order `rank` says. @param {(i: number) => number} rank */
  const sharesBy = (rank) => {
    const s = items.map(() => 0);
    for (const r of rows) [...r].sort((a, b) => rank(a) - rank(b) || a - b).forEach((i, k, all) => (s[i] = (k + 0.5) / all.length));
    return s;
  };
  const view = sharesBy((i) => items[i].rank);
  /** The kept order's shares, by key. */
  const kept = new Map((how.keep || []).flatMap((r) => r.map((key, k) => /** @type {[string, number]} */ ([key, (k + 0.5) / r.length]))));
  // The start: the view's order, else the kept one with what is new where the view's order puts it.
  const start = kept.size ? items.map((it, i) => kept.get(it.key) ?? view[i]) : view;
  const number = () => rows.forEach((r) => r.forEach((i, k) => (items[i].at = k)));
  /** Each row in the order a start says. @param {readonly number[]} seed */
  const arrange = (seed) => {
    for (const r of rows) r.sort((a, b) => seed[a] - seed[b] || view[a] - view[b] || a - b);
    number();
  };
  arrange(start);
  /** A place in a row as a share of the row, so rows of other lengths compare. @param {number} i */
  const rel = (i) => (items[i].at + 0.5) / rows[items[i].layer].length;
  /** How much the order's search has compared so far: a Rearrange's stops past `WORK`, however big the graph. */
  let work = 0;
  const crossings = () => {
    let n = 0;
    for (let k = 0; k + 1 < depth; k++) {
      /** @type {[number, number][]} */
      const segs = rows[k].flatMap((i) => items[i].downs.map((j) => /** @type {[number, number]} */ ([items[i].at, items[j].at])));
      work += (segs.length * segs.length) / 2;
      segs.forEach(([a, b], i) => segs.slice(0, i).forEach(([c, d]) => { if ((a - c) * (b - d) < 0) n++; }));
    }
    return n;
  };
  /** @param {number} k @param {"ups" | "downs"} by */
  const sweep = (k, by) => {
    const key = new Map(rows[k].map((i) => {
      const nb = items[i][by];
      return [i, nb.length ? nb.reduce((s, j) => s + rel(j), 0) / nb.length : rel(i)];
    }));
    rows[k].sort((a, b) => /** @type {number} */ (key.get(a)) - /** @type {number} */ (key.get(b)) || items[a].at - items[b].at);
    rows[k].forEach((i, at) => (items[i].at = at));
  };
  const copy = () => rows.map((r) => [...r]);
  // The kept order holds: nothing moves on its own after a Rearrange. What is new since goes in among it, row by row
  // down, where its lines from the row above cross fewest, then nearest the mean place of what it needs — nothing kept
  // passing another.
  if (!how.thorough && kept.size) {
    for (let k = 1; k < depth; k++) {
      const fresh = rows[k].filter((i) => !kept.has(items[i].key));
      if (!fresh.length) continue;
      /** @param {number} i */
      const wish = (i) => items[i].ups.reduce((s, j) => s + rel(j), 0) / Math.max(1, items[i].ups.length);
      const r = rows[k].filter((i) => kept.has(items[i].key));
      for (const u of fresh.sort((a, b) => wish(a) - wish(b) || a - b)) {
        let best = { p: 0, n: Infinity, off: Infinity };
        for (let p = 0; p <= r.length; p++) {
          let n = 0;
          r.forEach((v, q) => {
            for (const a of items[v].ups) for (const b of items[u].ups) if (q < p ? items[a].at > items[b].at : items[a].at < items[b].at) n++;
          });
          const off = Math.abs((p + 0.5) / (r.length + 1) - wish(u));
          if (n < best.n || (n === best.n && off < best.off - 1e-9)) best = { p, n, off };
        }
        r.splice(best.p, 0, u);
      }
      rows[k] = r;
      r.forEach((i, at) => (items[i].at = at));
    }
    return { items, rows: copy(), crossings: crossings() };
  }
  if (!how.thorough) {
    let best = { n: crossings(), rows: copy() };
    for (let s = 0; s < SWEEPS && best.n > 0; s++) {
      if (s % 2 === 0) for (let k = 1; k < depth; k++) sweep(k, "ups");
      else for (let k = depth - 2; k >= 0; k--) sweep(k, "downs");
      const n = crossings();
      if (n < best.n) best = { n, rows: copy() };
    }
    best.rows.forEach((r) => r.forEach((i, k) => (items[i].at = k)));
    return { items, rows: best.rows, crossings: best.n };
  }

  // A Rearrange's: how far the lines run across, in places about each row's middle — the shorter, the tidier.
  const span = () => {
    let s = 0;
    for (const it of items) for (const j of it.downs) s += Math.abs(it.at - (rows[it.layer].length - 1) / 2 - (items[j].at - (rows[items[j].layer].length - 1) / 2));
    return s;
  };
  /** How many times `u`'s lines cross `v`'s, `u` left of `v`, to the rows above and below. @param {number} u @param {number} v */
  const pair = (u, v) => {
    let n = 0;
    work += items[u].ups.length * items[v].ups.length + items[u].downs.length * items[v].downs.length;
    for (const by of /** @type {const} */ (["ups", "downs"])) for (const p of items[u][by]) for (const q of items[v][by]) if (items[p].at > items[q].at) n++;
    return n;
  };
  /** Each two neighbours in a row swapped where fewer lines cross, until none is. @param {number} k */
  const swaps = (k) => {
    const r = rows[k];
    for (let moved = true, round = 0; moved && round < r.length; round++) {
      moved = false;
      for (let p = 0; p + 1 < r.length; p++) {
        if (pair(r[p + 1], r[p]) >= pair(r[p], r[p + 1])) continue;
        [r[p], r[p + 1]] = [r[p + 1], r[p]];
        items[r[p]].at = p;
        items[r[p + 1]].at = p + 1;
        moved = true;
      }
    }
  };
  /** A start from a rank of each box, a slot's from the boxes it runs between, as the view's is. @param {(id: string) => number} r */
  const startBy = (r) => sharesBy((i) => {
    const [from, to] = items[i].ends;
    return items[i].id !== null ? r(items[i].id) : r(to) + (from === null ? 0 : r(from)) / (ids.length + 1);
  });
  const viewAt = new Map(ids.map((id, i) => [id, i]));
  // Each task's followers after it, depth first from the tasks that need nothing: a family together.
  /** @type {Map<string, string[]>} */
  const next = new Map(ids.map((id) => [id, []]));
  for (const e of edges) if (e.from !== FOLD && next.has(e.from) && next.has(e.to)) /** @type {string[]} */ (next.get(e.from)).push(e.to);
  /** @type {Map<string, number>} */
  const deep = new Map();
  /** @param {string} id */
  const walk = (id) => {
    if (deep.has(id)) return;
    deep.set(id, deep.size);
    for (const t of next.get(id) || []) walk(t);
  };
  for (const id of ids) if (!edges.some((e) => e.to === id && e.from !== FOLD && next.has(e.from))) walk(id);
  for (const id of ids) walk(id);
  const at = (/** @type {Map<string, number>} */ m) => (/** @type {string} */ id) => /** @type {number} */ (m.get(id));
  /** @type {{ n: number, span: number, rows: number[][] } | null} */
  let best = null;
  const keepIfBetter = () => {
    const n = crossings();
    const s = span();
    if (!best || n < best.n || (n === best.n && s < best.span - 1e-9)) best = { n, span: s, rows: copy() };
  };
  /** From a start, sweeps down and up — each row's neighbours swapped after its sweep, `swapping` — the best kept. @param {readonly number[]} seed @param {number} sweeps @param {boolean} swapping */
  const tryFrom = (seed, sweeps, swapping) => {
    arrange(seed);
    keepIfBetter();
    for (let s = 0; s < sweeps && work < WORK; s++) {
      if (s % 2 === 0)
        for (let k = 1; k < depth; k++) {
          sweep(k, "ups");
          if (swapping) swaps(k);
        }
      else
        for (let k = depth - 2; k >= 0; k--) {
          sweep(k, "downs");
          if (swapping) swaps(k);
        }
      keepIfBetter();
    }
  };
  // Each start tried both ways, then again from the best found until a round finds none better: a second press finds
  // what the first did.
  let seeds = [start, view, startBy((id) => ids.length - 1 - /** @type {number} */ (viewAt.get(id))), startBy(at(deep))];
  for (let round = 0; round < 8 && work < WORK; round++) {
    const was = best;
    for (const seed of seeds) {
      if (work >= WORK) break;
      tryFrom(seed, THOROUGH, true);
      tryFrom(seed, SWEEPS, false);
    }
    if (best === was) break;
    const s = items.map(() => 0);
    /** @type {{ rows: number[][] }} */ (/** @type {unknown} */ (best)).rows.forEach((r) => r.forEach((i, k) => (s[i] = (k + 0.5) / r.length)));
    seeds = [s];
  }
  const found = /** @type {{ n: number, span: number, rows: number[][] }} */ (/** @type {unknown} */ (best));
  found.rows.forEach((r) => r.forEach((i, k) => (items[i].at = k)));
  return { items, rows: found.rows, crossings: found.n };
}

/** Whether a task's work is over: done or dropped. @param {BTask | undefined} t */
const over = (t) => !t || t.state === "done" || t.state === "dropped";

/**
 * The graph laid out: a row a step, each task a one-line box — a hunt box as tall as the page draws it (`tall`, px more
 * than one line) — the lines, and the finished steps at the top folded into one row unless the person showed them
 * (`open.steps`); a box whose hunt still works (`busy`) keeps its step from finishing. `box`: a one-line box's size,
 * where the page's type is not the usual size; `fired`: the tasks a Reviewer was sent from (`groupsOf`). `dir` "right":
 * drawn left to right, a column a step, the folded steps a column at the left. `keep`: the order a Rearrange found
 * (`order`); `thorough`: look for it (`orderOf`).
 * @param {readonly BTask[]} tasks  in the view's order
 * @param {{ open?: { steps: boolean }, box?: { w: number, h: number } | null, tall?: ((id: string) => number) | null,
 *   busy?: ((id: string) => boolean) | null, fired?: ((id: string) => boolean) | null, dir?: Dir,
 *   keep?: readonly (readonly string[])[] | null, thorough?: boolean }} [o]
 * @returns {Layout}
 */
export function boxesOf(tasks, o = {}) {
  const size = { ...BOX, ...(o.box || {}) };
  size.w = 2 * Math.round(size.w / 2);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const groups = groupsOf(tasks, o.fired);
  const subs = stepsOf(tasks);
  /** Each task's box: its own, the hunt box it is a fix in, or its step's. @type {Map<string, string>} */
  const owner = new Map(tasks.map((t) => [t.id, t.id]));
  for (const [hunted, fixes] of groups) for (const f of fixes) owner.set(f, hunted);
  for (const [step, kids] of subs) for (const k of kids) owner.set(k, step);
  const boxOf = (/** @type {string} */ id) => /** @type {string} */ (owner.get(id));
  const nodes = tasks.filter((t) => boxOf(t.id) === t.id).map((t) => t.id);
  /** A box's tasks: its own, a hunt box's fixes, a step's sub-tasks. @param {string} id */
  const members = (id) => [id, ...(groups.get(id) || subs.get(id) || [])];
  /** Each need of a box's tasks out of the box: the task needed, and the one in the box that needs it. @param {string} id */
  const outs = (id) => members(id).flatMap((m) => /** @type {BTask} */ (byId.get(m)).needs.filter((x) => owner.has(x) && boxOf(x) !== id).map((x) => ({ x, m })));
  /** What a box needs, by box: a need inside the box — a fix's of its hunted task, a sub-task's of another — is no line. */
  const needs = new Map(nodes.map((id) => [id, { needs: [...new Set(outs(id).map((e) => boxOf(e.x)))] }]));
  const layer = layersOf(nodes, needs);
  const depth = nodes.length ? Math.max(...layer.values()) + 1 : 0;
  // The finished steps at the top: a step is finished once each of its tasks is done or dropped, one done at least —
  // a hunt box's fixes among them — and no hunt in it still works.
  const steps = Array.from({ length: depth }, (_, k) => {
    const ids = nodes.filter((id) => layer.get(id) === k);
    const all = ids.flatMap(members).map((id) => byId.get(id));
    return { state: all.every(over) && all.some((t) => t?.state === "done") && !ids.some((id) => o.busy?.(id)) ? "done" : "open" };
  });
  const foldLayers = foldCount(steps);
  const lay = (/** @type {string} */ id) => /** @type {number} */ (layer.get(boxOf(id)));
  const folds = tasks.filter((t) => lay(t.id) < foldLayers).map((t) => t.id);
  const n = o.open?.steps ? 0 : foldLayers;
  const hidden = tasks.filter((t) => lay(t.id) < n).map((t) => t.id);
  const shown = nodes.filter((id) => /** @type {number} */ (layer.get(id)) >= n);
  const at = new Map(shown.map((id) => [id, /** @type {number} */ (layer.get(id)) - n]));

  // The lines: each box a box needs, the tasks it stands for at either end; out of the folded row, one to each box
  // with a need folded.
  /** @type {{ from: string, to: string, key: string, froms: string[], tos: string[] }[]} */
  const edges = [];
  /** The tasks a line stands for at either end. @param {{ x: string, m: string }[]} es */
  const ends = (es) => ({ froms: [...new Set(es.map((e) => e.x))], tos: [...new Set(es.map((e) => e.m))] });
  for (const to of shown) {
    const own = outs(to);
    const folded = own.filter((e) => !at.has(boxOf(e.x)));
    for (const from of /** @type {{ needs: string[] }} */ (needs.get(to)).needs)
      if (at.has(from)) edges.push({ from, to, key: `${from}>${to}`, ...ends(own.filter((e) => boxOf(e.x) === from)) });
    if (folded.length) edges.push({ from: FOLD, to, key: `${FOLD}>${to}`, ...ends(folded) });
  }

  const across = o.dir === "right";
  const { items, rows, crossings } = shown.length
    ? orderOf(shown, at, edges, { keep: o.keep, thorough: !!o.thorough, base: n })
    : { items: /** @type {Item[]} */ ([]), rows: /** @type {number[][]} */ ([]), crossings: 0 };
  const tallOf = (/** @type {string} */ id) => size.h + Math.max(0, Math.round(Number(o.tall?.(id)) || 0));
  // Below, `x` is across a row and `y` along the rows, as drawn down; drawn left to right, the two are turned.
  /** Half an item's size across its row: a box's width, its height drawn left to right; a slot's none. @param {number} i */
  const half = (i) => {
    const id = items[i].id;
    return id === null ? 0 : (across ? tallOf(id) : size.w) / 2;
  };
  const gap = across ? ACROSS.gy : size.gx;
  /** The least distance between two neighbours' middles. @param {number} i @param {number} j */
  const apart = (i, j) => half(i) + half(j) + (items[i].id !== null && items[j].id !== null ? gap : items[i].id === null && items[j].id === null ? SLOT_GAP : SLOT_PAD);
  /** Each item's middle, px, about 0. @type {number[]} */
  const x = items.map(() => 0);
  for (const r of rows) {
    let pos = 0;
    r.forEach((i, k) => {
      if (k) pos += apart(r[k - 1], i);
      x[i] = pos;
    });
    for (const i of r) x[i] -= pos / 2;
  }
  /** A row's places, each toward the mean of its neighbours above or below. @param {number[]} r @param {"ups" | "downs"} by */
  const place = (r, by) => {
    const want = r.map((i) => {
      const nb = items[i][by];
      return nb.length ? nb.reduce((s, j) => s + x[j], 0) / nb.length : x[i];
    });
    const xs = packRow(want, r.map((i) => (items[i].id === null ? SLOT_WEIGHT : 1)), r.map((i, k) => (k ? apart(r[k - 1], i) : 0)));
    r.forEach((i, k) => (x[i] = xs[k]));
  };
  for (let s = 0; s < ROUNDS; s++) {
    for (const r of rows) place(r, "ups");
    for (const r of [...rows].reverse()) place(r, "downs");
  }
  for (const r of rows) place(r, "ups");

  const left = items.length ? Math.min(...items.map((_, i) => x[i] - half(i))) : 0;
  const right = items.length ? Math.max(...items.map((_, i) => x[i] + half(i))) : 0;
  // The folded steps: a row over the rows, or drawn left to right a column beside the columns, as long as they are.
  const foldW = n > 0 ? Math.max(right - left, across ? ACROSS.foldH : FOLD_W) : 0;
  const inner = Math.max(right - left, foldW);
  // The boxes and slots from the drawing's corner, the middle of what is narrower than the folded row under its middle.
  const shift = (across ? PAD : PADX) + (inner - (right - left)) / 2 - left;
  const xAt = (/** @type {number} */ i) => Math.round(x[i] + shift);
  const foldDeep = across ? size.w : FOLD_H;
  const rowGap = across ? ACROSS.gx : size.gy;
  const pad = across ? PADX : PAD;
  /** @type {number[]} */
  const rowTop = [];
  /** @type {number[]} */
  const rowH = [];
  let y = pad + (n > 0 ? foldDeep + rowGap : 0);
  rows.forEach((r, k) => {
    rowTop[k] = y;
    rowH[k] = across ? size.w : Math.max(size.h, ...r.map((i) => items[i].id).filter((id) => id !== null).map((id) => tallOf(/** @type {string} */ (id))));
    y += rowH[k] + rowGap;
  });
  /** @type {Map<string, Box>} */
  const boxes = new Map();
  for (const r of rows) for (const i of r) {
    const id = items[i].id;
    if (id === null) continue;
    const h = tallOf(id);
    boxes.set(id, across ? { x: rowTop[items[i].layer], y: xAt(i) - h / 2, w: size.w, h } : { x: xAt(i) - size.w / 2, y: rowTop[items[i].layer], w: size.w, h });
  }
  const fold = n > 0 ? (across ? { x: PADX, y: PAD, w: size.w, h: Math.round(foldW) } : { x: PADX, y: PAD, w: Math.round(foldW), h: FOLD_H }) : null;
  /** @type {Map<string, number[]>} */
  const slots = new Map();
  for (const r of rows) for (const i of r) if (items[i].id === null) slots.set(items[i].line, [...(slots.get(items[i].line) || []), i]);
  const lines = edges.map((e) => {
    const T = /** @type {Box} */ (boxes.get(e.to));
    const passes = (slots.get(e.key) || []).sort((p, q) => items[p].layer - items[q].layer);
    const S = e.from === FOLD ? null : /** @type {Box} */ (boxes.get(e.from));
    const F = /** @type {Box} */ (fold);
    const ends = { from: e.from, to: e.to, froms: e.froms, tos: e.tos };
    if (across) {
      // Left to right: out of the right side's middle, into the left side's.
      const via = passes.map((i) => ({ y: xAt(i), left: rowTop[items[i].layer], right: rowTop[items[i].layer] + rowH[items[i].layer] }));
      const b = { x: T.x, y: T.y + T.h / 2 };
      return { ...ends, a: S ? { x: S.x + S.w, y: S.y + S.h / 2 } : { x: F.x + F.w, y: via[0]?.y ?? b.y }, b, via };
    }
    const via = passes.map((i) => ({ x: xAt(i), top: rowTop[items[i].layer], bottom: rowTop[items[i].layer] + rowH[items[i].layer] }));
    const b = { x: T.x + T.w / 2, y: T.y };
    return { ...ends, a: S ? { x: S.x + S.w / 2, y: S.y + S.h } : { x: via[0]?.x ?? b.x, y: F.y + FOLD_H }, b, via };
  });
  const along = y - (rows.length || n > 0 ? rowGap : 0) + pad;
  return {
    boxes,
    rows: rows.map((r) => r.map((i) => items[i].id).filter((id) => id !== null).map(String)),
    groups,
    steps: subs,
    lines,
    fold,
    foldLayers,
    folds,
    hidden,
    w: across ? along : Math.round(inner + 2 * PADX),
    h: across ? Math.round(inner + 2 * PAD) : along,
    box: { w: size.w, h: size.h },
    dir: across ? "right" : "down",
    order: rows.map((r) => r.map((i) => items[i].key)),
    crossings,
  };
}
