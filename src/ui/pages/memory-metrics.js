// @ts-check
// Memory → Activity's "What memory showed, and what the work used" (the memory plan's b4): each layer's showings, how
// many the work used, their tokens and the showings that came again, over a window, from `GET /api/memory/metrics`.
// The words are lib/memory-metrics.js's.
import { ui } from "../runtime.js";
import { METRIC_WINDOWS, METRICS_NOTE, metricsView } from "../lib/memory-metrics.js";

/**
 * The panel, read now and again on each pick.
 * @param {any} S  the panel's remembered pick (`state.memMetrics`): `days`
 * @returns {HTMLElement}
 */
export function metricsPanel(S) {
  const { api, h } = /** @type {any} */ (ui);
  if (!METRIC_WINDOWS.some((w) => w.value === S.days)) S.days = "30";
  let seq = 0;
  const box = h("div", {}, h("p", { class: "muted small" }, "reading…"));
  const pick = h("select", { class: "sm", "aria-label": "Over the last", onchange: () => { S.days = pick.value; void read(); } }, ...METRIC_WINDOWS.map((w) => h("option", { value: w.value, selected: w.value === S.days ? "" : null }, w.label)));
  /** @param {any} r  the route's answer */
  function paint(r) {
    const v = metricsView(r);
    if (v.empty) return box.replaceChildren(h("p", { class: "muted small", style: "margin:0" }, v.empty));
    box.replaceChildren(
      h("div", { class: "table-wrap" },
        h("table", { class: "small" },
          h("thead", {}, h("tr", {}, ...[["Layer"], ["Shown", "num"], ["Used"], ["Rate", "num"], ["Tokens", "num"], ["Tokens a turn", "num"], ["Shown again", "num"]].map(([t, c]) => h("th", c ? { class: c } : {}, t)))),
          h("tbody", {}, ...v.rows.map((x) => h("tr", {}, h("td", {}, x.layer), h("td", { class: "num" }, x.shown), h("td", {}, x.used), h("td", { class: "num" }, x.rate), h("td", { class: "num" }, x.tokens), h("td", { class: "num" }, x.perTurn), h("td", { class: "num", title: "Showings of a memory the session had been shown already" }, x.again)))))),
      ...v.lines.map((l) => h("p", { class: "muted small", style: "margin:6px 0 0" }, l)));
  }
  async function read() {
    const mine = ++seq;
    try {
      const r = await api(`/memory/metrics?days=${encodeURIComponent(S.days)}`);
      if (mine === seq) paint(r);
    } catch (/** @type {any} */ e) {
      if (mine === seq) box.replaceChildren(h("p", { class: "err small", style: "margin:0" }, e?.body?.error || e?.message || String(e)));
    }
  }
  void read();
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "What memory showed, and what the work used"), h("span", { class: "grow" }), h("span", { class: "toolbar wrap", style: "margin:0;gap:8px" }, pick)),
    h("p", { class: "muted small", style: "margin:0 0 10px" }, METRICS_NOTE),
    box);
}
