// @ts-check
// Memory → Overview's "How models did" (HarnessV3-Memory M7-D53): what the harness's Settings → Memory → Models shows,
// in the console's own style and the same words (src/ui/lib/outcomes.js), from the outcomes route (M7-D52). Every
// workspace or one, over a window, of every kind of work or one: a row per model and kind, how its runs ended, its
// medians and its cost, and a line under it for each thing its runs did. A record the owner reads; nothing routes by it.
import { ui } from "../runtime.js";
import { OUTCOME_WINDOWS, OUTCOME_FILTERS, OUTCOMES_NOTE, outcomesPath, outcomeWords, endedParts, noOutcomesWords } from "../lib/outcomes.js";

/**
 * The panel, read now and again on each pick.
 * @param {any} S  the panel's remembered picks (`state.memOutcomes`): `project` (null for every workspace), `days`, `kind`
 * @returns {HTMLElement}
 */
export function outcomesPanel(S) {
  const { api, h } = /** @type {any} */ (ui);
  if (!OUTCOME_WINDOWS.some((w) => w.value === S.days)) S.days = "30";
  if (!OUTCOME_FILTERS.some((f) => f.value === S.kind)) S.kind = "";
  if (S.project === undefined) S.project = null;
  /** The workspaces to pick from, once read. @type {any[]} */
  let workspaces = [];
  let seq = 0;
  const box = h("div", {}, h("p", { class: "muted small" }, "reading…"));
  const pickers = h("span", { class: "toolbar wrap", style: "margin:0;gap:8px" });

  /** A picker over `options`, `value` picked, `onPick` with the new value. @param {string} label @param {readonly { value: string, label: string }[]} options @param {string} value @param {(v: string) => void} onPick */
  const select = (label, options, value, onPick) => {
    const sel = h("select", { class: "sm", "aria-label": label, onchange: () => onPick(sel.value) }, ...options.map((o) => h("option", { value: o.value, selected: o.value === value ? "" : null }, o.label)));
    return sel;
  };
  function paintPickers() {
    const where = [{ value: "", label: "Every workspace" }, ...workspaces.map((w) => ({ value: String(w.project), label: String(w.name) }))];
    pickers.replaceChildren(
      select("Workspace", where, S.project || "", (v) => { S.project = v || null; void read(); }),
      select("Over the last", OUTCOME_WINDOWS, S.days, (v) => { S.days = v; void read(); }),
      select("Kind of work", OUTCOME_FILTERS, S.kind, (v) => { S.kind = v; void read(); }));
  }
  /** How runs ended, as a bar. @param {ReturnType<typeof endedParts>} parts @param {string} label */
  const bar = (parts, label) =>
    h("span", { class: "mo-bar", role: "img", "aria-label": label }, ...parts.map((p) => h("span", { class: `mo-seg is-${p.key}`, style: `flex:${p.n}`, title: `${p.n} ${p.label}` })));
  /** @param {any} r  the route's answer */
  function paint(r) {
    if (!r.groups.length) return box.replaceChildren(h("p", { class: "muted small", style: "margin:0" }, noOutcomesWords({ days: S.days, kind: S.kind, everywhere: !S.project })));
    const rows = r.groups.flatMap((/** @type {any} */ g) => {
      const w = outcomeWords(g);
      return [
        h("tr", { class: "mo-group" },
          h("td", {}, h("code", {}, w.who)),
          h("td", {}, w.runs),
          h("td", { class: "num" }, w.held, bar(endedParts(g), w.heldWords)),
          h("td", {}, w.trouble ? h("span", { class: "warn" }, w.trouble) : h("span", { class: "muted" }, "–")),
          h("td", { class: "num" }, w.rounds),
          h("td", { class: "num" }, w.time),
          h("td", { class: "num" }, w.perRun),
          h("td", { class: "muted" }, w.cost)),
        ...w.lines.map((l) =>
          h("tr", { class: "mo-did" },
            h("td", {}),
            h("td", {}, l.what),
            h("td", { class: "num" }, l.held, bar(l.parts, l.held)),
            h("td", {}, l.trouble ? h("span", { class: "warn" }, l.trouble) : h("span", { class: "muted" }, "–")),
            h("td", { colspan: "4" }))),
      ];
    });
    box.replaceChildren(
      h("div", { class: "table-wrap" },
        h("table", { class: "small mem-outcomes" },
          h("thead", {}, h("tr", {}, ...[["Model"], ["Runs"], ["Held", "num"], ["Corrected · failed · stopped"], ["Rounds", "num"], ["Time", "num"], ["A run", "num"], ["Cost"]].map(([t, c]) => h("th", c ? { class: c } : {}, t)))),
          h("tbody", {}, ...rows))),
      h("p", { class: "muted small", style: "margin:6px 0 0" }, `${r.runs} run${r.runs === 1 ? "" : "s"} · rounds and time are medians · a run's cost is over the runs with a price`));
  }
  /** The outcomes for the picks, read again; a read overtaken by a newer one is dropped. */
  async function read() {
    const mine = ++seq;
    paintPickers();
    try {
      const r = await api(outcomesPath({ project: S.project, days: S.days, kind: S.kind }));
      if (mine === seq) paint(r);
    } catch (/** @type {any} */ e) {
      if (mine === seq) box.replaceChildren(h("p", { class: "err small", style: "margin:0" }, e?.body?.error || e?.message || String(e)));
    }
  }
  api("/memory/claims/scopes")
    .then((/** @type {any} */ r) => {
      workspaces = (r.scopes || []).filter((/** @type {any} */ s) => s.project !== null);
      // A workspace picked before and gone since: every workspace instead.
      if (S.project && !workspaces.some((w) => w.project === S.project)) {
        S.project = null;
        return read();
      }
      paintPickers();
    })
    .catch(() => {});
  void read();
  return h("section", { class: "panel" },
    h("div", { class: "panel-head" }, h("h2", {}, "How models did"), h("span", { class: "grow" }), pickers),
    h("p", { class: "muted small", style: "margin:0 0 10px" }, OUTCOMES_NOTE),
    box);
}
