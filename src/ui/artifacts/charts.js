// @ts-check
// A Dashboard's charts, and the formats its values are shown in (HarnessV4_Artifacts_Plan E18 step 7, AF-D11, AFC-125,
// AFC-126). A value in its format and an axis's ticks are pure; a chart is SVG drawn as text at the width it has, its
// colors by the look's names through its classes (types.css), so a switch of theme needs no drawing again. A bar chart
// lays its bars across where their names are long; a line chart breaks where a value is missing. Each chart
// says which row the pointer is over, for the page's tip. Nothing here runs as the module loads.

/** The formats a value is shown in: the agent's and a feed's columns' (core's FORMATS). */
export const FORMATS = Object.freeze(["number", "usd", "percent", "tokens", "ms", "seconds", "tps", "date", "time", "text"]);
/** The most columns a chart draws, a color each (core's SERIES_MAX). */
export const SERIES_MAX = 6;
/** Names longer than this lay a bar chart's bars across. */
export const ACROSS_NAME = 10;
/** A chart's height, laid up and down; a bar's thickness, laid across. */
const CHART_H = 220;
const ACROSS_ROW = 12;

/** A number as figures, with at most `d` decimals. @param {number} n @param {number} d */
const figures = (n, d) => n.toLocaleString("en-US", { maximumFractionDigits: d });
/** A large number short: 12.3K, 4.56M. @param {number} n */
function short(n) {
  const a = Math.abs(n);
  const [by, unit] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  const x = n / by;
  return `${figures(x, !unit ? 0 : Math.abs(x) < 10 ? 2 : Math.abs(x) < 100 ? 1 : 0)}${unit}`;
}
/** Dollars: $1.20, $1,234, <$0.01. @param {number} n */
function dollars(n) {
  const a = Math.abs(n);
  if (a > 0 && a < 0.005) return "<$0.01";
  const sign = n < 0 ? "-" : "";
  return a >= 1000 ? `${sign}$${figures(a, 0)}` : `${sign}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A value in a format (AFC-126): "—" for none; a day (`2026-10-16`) as Oct 16; a moment as 2:05 PM; a value that is
 * no number, as written.
 * @param {unknown} v @param {string} [format]
 */
export function formatValue(v, format = "number") {
  if (v == null || v === "") return "—";
  // "id": a number that names a thing (a run, a PR), as written — never "8,812".
  if (format === "text" || format === "id") return String(v);
  if (format === "date") {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    return d ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : String(v);
  }
  if (format === "time") {
    const t = new Date(String(v));
    return Number.isNaN(t.getTime()) ? String(v) : t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const n = numberOf(v);
  if (n == null) return String(v);
  const a = Math.abs(n);
  if (format === "usd") return dollars(n);
  if (format === "percent") return `${figures(n * 100, a < 0.1 ? 1 : 0)}%`;
  if (format === "tokens") return short(n);
  if (format === "ms") return a >= 1000 ? `${figures(n / 1000, 1)} s` : `${Math.round(n)} ms`;
  if (format === "seconds") return `${figures(n, a < 10 ? 1 : 0)} s`;
  if (format === "tps") return `${figures(n, 1)} tok/s`;
  return a >= 1e6 ? short(n) : figures(n, a < 10 ? 2 : a < 1000 ? 1 : 0);
}

/** A value as a number, or null where it is none: a number, or figures written as text. @param {unknown} v */
export function numberOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * An axis's ticks (AFC-125): round steps — 1, 2, 2.5 or 5 of a power of ten — from zero or below the least to above
 * the most, about `count` of them; 0 and 1 where every value is zero.
 * @param {number} lo @param {number} hi @param {number} [count]
 */
export function ticksOf(lo, hi, count = 4) {
  const min = Math.min(0, lo);
  const max = Math.max(0, hi);
  if (min === max) return [0, 1];
  const raw = (max - min) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw - 1e-12) ?? 10 * p;
  const from = Math.floor(min / step + 1e-9) * step;
  const to = Math.ceil(max / step - 1e-9) * step;
  /** @type {number[]} */
  const out = [];
  for (let i = 0; from + i * step <= to + step / 2; i++) out.push(Number((from + i * step).toPrecision(12)));
  return out;
}

/** Text as SVG's text. @param {unknown} s */
const svgText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A pixel as SVG writes it. @param {number} n */
const px = (n) => String(Math.round(n * 10) / 10);

/** @type {CanvasRenderingContext2D | null} */
let ruler = null;
/** How wide text is in a chart's small type (`.chart-axis`), in pixels. @param {string} s */
export function textWidth(s) {
  if (!ruler) {
    const probe = document.createElement("span");
    probe.className = "chart-axis";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    ruler = document.createElement("canvas").getContext("2d");
    if (ruler) ruler.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    probe.remove();
  }
  return ruler ? ruler.measureText(s).width : s.length * 7;
}
/** Text cut with "…" to a width in pixels, as it is drawn. @param {string} s @param {number} w */
function fitWidth(s, w) {
  if (textWidth(s) <= w) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}…`) > w) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * @typedef {{ rows: Record<string, unknown>[], x: string, ys: string[], width: number, xFormat: string,
 *   formatOf: (column: string) => string }} ChartIn  the rows; the column that names each (`x`) and those drawn
 *   (`ys`); the width it has; how `x` is shown, and each drawn column
 * @typedef {{ svg: string, height: number, across: boolean, at: (x: number, y: number) => number,
 *   spot: (i: number) => [number, number] }} Chart  the drawing, its height, whether its bars lie across, the row under
 *   a point of it (-1 for none), and where a row's tip stands when the keyboard moves to it
 */

/** The least and the most of the drawn columns' values. @param {ChartIn} c */
function spanOf(c) {
  let lo = 0;
  let hi = 0;
  for (const r of c.rows)
    for (const y of c.ys) {
      const n = numberOf(r[y]);
      if (n == null) continue;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
  return ticksOf(lo, hi);
}

/** Whether a bar chart lays its bars across (AFC-125): a name too long to stand under its bar. @param {ChartIn} c */
export const barsAcross = (c) => c.rows.some((r) => formatValue(r[c.x], c.xFormat).length > ACROSS_NAME);

/** A bar chart (AFC-125): each row's bars side by side, a color each; across where `barsAcross` says. @param {ChartIn} c @returns {Chart} */
export function barChart(c) {
  return barsAcross(c) ? barsLaidAcross(c) : barsStanding(c);
}

/** @param {ChartIn} c @returns {Chart} */
function barsStanding(c) {
  const ticks = spanOf(c);
  const yFormat = c.formatOf(c.ys[0]);
  const left = Math.max(...ticks.map((t) => textWidth(formatValue(t, yFormat)))) + 10;
  const top = 8;
  const bottom = CHART_H - 22;
  const right = c.width - 4;
  const n = Math.max(1, c.rows.length);
  const band = (right - left) / n;
  const lo = ticks[0];
  const hi = /** @type {number} */ (ticks.at(-1));
  const y = (/** @type {number} */ v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const group = Math.min(band * 0.72, c.ys.length * 40);
  const bar = group / c.ys.length;
  const names = c.rows.map((r) => formatValue(r[c.x], c.xFormat));
  const every = Math.max(1, Math.ceil((Math.max(0, ...names.map(textWidth)) + 10) / band));
  const parts = ticks.map((t) => `<line class="${t === 0 ? "chart-zero" : "chart-grid"}" x1="${px(left)}" x2="${px(right)}" y1="${px(y(t))}" y2="${px(y(t))}"/><text class="chart-axis" x="${px(left - 6)}" y="${px(y(t))}" text-anchor="end" dominant-baseline="middle">${svgText(formatValue(t, yFormat))}</text>`);
  c.rows.forEach((r, i) => {
    const x0 = left + i * band + (band - group) / 2;
    c.ys.forEach((col, s) => {
      const v = numberOf(r[col]);
      if (v == null) return;
      const a = y(Math.max(0, v));
      const b = y(Math.min(0, v));
      parts.push(`<rect class="chart-bar series-${s + 1}" data-i="${i}" x="${px(x0 + s * bar + 0.5)}" y="${px(a)}" width="${px(Math.max(1, bar - 1))}" height="${px(Math.max(v === 0 ? 0 : 1, b - a))}" rx="2"/>`);
    });
    if (i % every === 0) parts.push(`<text class="chart-axis" x="${px(left + (i + 0.5) * band)}" y="${px(bottom + 15)}" text-anchor="middle">${svgText(fitWidth(names[i], band * every - 4))}</text>`);
  });
  return {
    svg: `<svg class="chart" width="${px(c.width)}" height="${CHART_H}" viewBox="0 0 ${px(c.width)} ${CHART_H}" role="img">${parts.join("")}</svg>`,
    height: CHART_H,
    across: false,
    at: (px0, py0) => (px0 < left || px0 > right || py0 < top || py0 > bottom + 18 || !c.rows.length ? -1 : Math.min(c.rows.length - 1, Math.floor((px0 - left) / band))),
    spot: (i) => [left + (i + 0.5) * band, top + 8],
  };
}

/** @param {ChartIn} c @returns {Chart} */
function barsLaidAcross(c) {
  const ticks = spanOf(c);
  const yFormat = c.formatOf(c.ys[0]);
  const names = c.rows.map((r) => formatValue(r[c.x], c.xFormat));
  const nameW = Math.min(c.width * 0.4, Math.max(0, ...names.map(textWidth)) + 12);
  const one = c.ys.length === 1;
  // A single column's value stands at its bar's end: room is kept for the longest.
  const valueW = one ? Math.max(0, ...c.rows.map((r) => textWidth(formatValue(r[c.ys[0]], yFormat)))) + 8 : 0;
  const left = nameW;
  const right = c.width - 4 - valueW;
  const row = Math.max(22, c.ys.length * ACROSS_ROW + 10);
  const top = 4;
  const bottom = top + c.rows.length * row;
  const height = bottom + 20;
  const lo = ticks[0];
  const hi = /** @type {number} */ (ticks.at(-1));
  const x = (/** @type {number} */ v) => left + ((v - lo) / (hi - lo)) * (right - left);
  const thick = (row - 10) / c.ys.length;
  const parts = ticks.map((t) => `<line class="${t === 0 ? "chart-zero" : "chart-grid"}" x1="${px(x(t))}" x2="${px(x(t))}" y1="${px(top)}" y2="${px(bottom)}"/><text class="chart-axis" x="${px(x(t))}" y="${px(bottom + 14)}" text-anchor="middle">${svgText(formatValue(t, yFormat))}</text>`);
  c.rows.forEach((r, i) => {
    const y0 = top + i * row + 5;
    parts.push(`<text class="chart-axis chart-name" x="${px(left - 8)}" y="${px(top + (i + 0.5) * row)}" text-anchor="end" dominant-baseline="middle">${svgText(fitWidth(names[i], nameW - 14))}</text>`);
    c.ys.forEach((col, s) => {
      const v = numberOf(r[col]);
      if (v == null) return;
      const a = x(Math.min(0, v));
      const b = x(Math.max(0, v));
      parts.push(`<rect class="chart-bar series-${s + 1}" data-i="${i}" x="${px(a)}" y="${px(y0 + s * thick)}" width="${px(Math.max(v === 0 ? 0 : 1, b - a))}" height="${px(Math.max(1, thick - 1))}" rx="2"/>`);
      if (one) parts.push(`<text class="chart-axis chart-value" x="${px(b + 6)}" y="${px(y0 + thick / 2)}" dominant-baseline="middle">${svgText(formatValue(v, yFormat))}</text>`);
    });
  });
  return {
    svg: `<svg class="chart" width="${px(c.width)}" height="${px(height)}" viewBox="0 0 ${px(c.width)} ${px(height)}" role="img">${parts.join("")}</svg>`,
    height,
    across: true,
    at: (_px0, py0) => (py0 < top || py0 >= bottom ? -1 : Math.floor((py0 - top) / row)),
    spot: (i) => [left + 8, top + (i + 0.5) * row],
  };
}

/**
 * A line chart (AFC-125): each drawn column a line along the rows in their order, a color each, broken where a value is
 * missing; a single line with its area under it; points shown where there are few.
 * @param {ChartIn} c @returns {Chart}
 */
export function lineChart(c) {
  const ticks = spanOf(c);
  const yFormat = c.formatOf(c.ys[0]);
  const left = Math.max(...ticks.map((t) => textWidth(formatValue(t, yFormat)))) + 10;
  const top = 8;
  const bottom = CHART_H - 22;
  const right = c.width - 8;
  const n = c.rows.length;
  const lo = ticks[0];
  const hi = /** @type {number} */ (ticks.at(-1));
  const x = (/** @type {number} */ i) => (n < 2 ? (left + right) / 2 : left + (i / (n - 1)) * (right - left));
  const y = (/** @type {number} */ v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const parts = ticks.map((t) => `<line class="${t === 0 ? "chart-zero" : "chart-grid"}" x1="${px(left)}" x2="${px(right)}" y1="${px(y(t))}" y2="${px(y(t))}"/><text class="chart-axis" x="${px(left - 6)}" y="${px(y(t))}" text-anchor="end" dominant-baseline="middle">${svgText(formatValue(t, yFormat))}</text>`);
  const few = n <= 16;
  c.ys.forEach((col, s) => {
    /** @type {[number, number][][]} */
    const runs = [[]];
    c.rows.forEach((r, i) => {
      const v = numberOf(r[col]);
      if (v == null) {
        if (runs[runs.length - 1].length) runs.push([]);
        return;
      }
      runs[runs.length - 1].push([x(i), y(v)]);
    });
    const drawn = runs.filter((run) => run.length);
    if (c.ys.length === 1)
      for (const run of drawn.filter((r) => r.length > 1))
        parts.push(`<path class="chart-area series-${s + 1}" d="M${run.map(([a, b]) => `${px(a)},${px(b)}`).join("L")}L${px(run[run.length - 1][0])},${px(y(0))}L${px(run[0][0])},${px(y(0))}Z"/>`);
    for (const run of drawn) parts.push(`<path class="chart-line series-${s + 1}" d="M${run.map(([a, b]) => `${px(a)},${px(b)}`).join("L")}"/>`);
    c.rows.forEach((r, i) => {
      const v = numberOf(r[col]);
      // A point that stands alone, and every point where there are few, shows; the rest show under the pointer.
      const alone = v != null && (numberOf(c.rows[i - 1]?.[col]) == null && numberOf(c.rows[i + 1]?.[col]) == null);
      if (v != null) parts.push(`<circle class="chart-dot series-${s + 1}${few || alone ? " shown" : ""}" data-i="${i}" cx="${px(x(i))}" cy="${px(y(v))}" r="3.5"/>`);
    });
  });
  const names = c.rows.map((r) => formatValue(r[c.x], c.xFormat));
  const widest = Math.max(0, ...names.map(textWidth)) + 16;
  const room = Math.max(1, Math.floor((right - left) / widest));
  const marks = n <= room ? names.map((_, i) => i) : Array.from({ length: room }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, room - 1)));
  for (const i of new Set(marks)) {
    const anchor = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle";
    parts.push(`<text class="chart-axis" x="${px(x(i))}" y="${px(bottom + 15)}" text-anchor="${anchor}">${svgText(names[i])}</text>`);
  }
  return {
    svg: `<svg class="chart" width="${px(c.width)}" height="${CHART_H}" viewBox="0 0 ${px(c.width)} ${CHART_H}" role="img">${parts.join("")}</svg>`,
    height: CHART_H,
    across: false,
    at: (px0, py0) => {
      if (!n || py0 < top || py0 > bottom + 18 || px0 < left - 8 || px0 > right + 8) return -1;
      return n < 2 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px0 - left) / (right - left)) * (n - 1))));
    },
    spot: (i) => [x(i), top + 8],
  };
}
