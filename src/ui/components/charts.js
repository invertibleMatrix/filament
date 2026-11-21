// @ts-check
// Tiny SVG widgets the admin dashboard paints inline. The 30-day usage stacked bars stay on the
// Usage page — they close over that page's selection — until that page moves.

/**
 * A 96×22 sparkline of the last N one-second speeds (live in-flight rows).
 * @param {number[]} values
 * @returns {SVGSVGElement}
 */
export function spark(values) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const w = 96,
    ht = 22;
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", `0 0 ${w} ${ht}`);
  svg.setAttribute("preserveAspectRatio", "none");
  if (values.length < 2) return svg;
  const max = Math.max(1, ...values),
    step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(ht - 1 - (v / max) * (ht - 2)).toFixed(1)}`);
  const area = document.createElementNS(NS, "polygon");
  area.setAttribute("points", [`0,${ht}`, ...pts, `${w},${ht}`].join(" "));
  area.setAttribute("fill", "currentColor");
  area.setAttribute("opacity", "0.15");
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", pts.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("vector-effect", "non-scaling-stroke");
  const title = document.createElementNS(NS, "title");
  title.textContent = `speed over the last ${values.length} seconds (peak ${max} tok/s)`;
  svg.append(title, area, line);
  return svg;
}
