// @ts-check
// The Feature board (HarnessV2 §10.6): one row per feature — its global switch, its state in the open session, a
// number from the owner's own traffic, where the evidence lives — and the replay-compare action: the open session's
// last N turns replayed on a copy under the feature's own settings, the two sides' numbers side by side as the run reports them.
// Every number is the server's (`GET /api/features`, the run's events); nothing is summed here but the table's totals,
// and those come from `run-end`.
import { h } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { shortWhen } from "../../lib/claims.js";
import { api, followRun, RUN_GONE } from "../lib/api.js";

/** @param {number | null | undefined} n */
const tok = (n) => (n == null ? "–" : fmt.n(n));
/** @param {number | null | undefined} n */
const usd = (n) => (n == null ? "–" : fmt.usd(n));

/**
 * One feature as a row of the board: its switch's state in the server's words, with the config path as the line's
 * tooltip, as on the badge (HarnessV3-Launch LD-D10).
 * @param {any} f  a Feature (app/features.js)
 * @param {{ onCompare: (f: any) => void } | null} act
 * @param {typeof h} [mk]
 */
export function featureRow(f, act, mk = h) {
  const sw = mk("span", { class: `zc-badge feature-switch ${f.switch.on ? "on" : "off"}`, title: f.switch.key }, f.switch.on ? "on" : "off");
  const sess = f.session
    ? mk("div", { class: "feature-session" },
        mk("span", { class: `dot ${f.session.on === true ? "on" : f.session.on === false ? "off" : "na"}` }),
        mk("span", {}, f.session.state),
        f.session.detail ? mk("div", { class: "muted small" }, f.session.detail) : null)
    : mk("span", { class: "muted small" }, "open a session to see its state");
  return mk("div", { class: "settings-row feature-row", "data-feature": f.id },
    mk("div", { class: "settings-row-text" },
      mk("div", { class: "settings-row-label" }, f.label, " ", sw),
      mk("div", { class: "settings-row-desc" }, f.what),
      mk("div", { class: "muted small", title: f.switch.key }, f.switch.value)),
    mk("div", { class: "feature-cells" },
      mk("div", { class: "feature-cell" }, mk("div", { class: "feature-cell-k" }, "in this session"), sess),
      mk("div", { class: "feature-cell" }, mk("div", { class: "feature-cell-k" }, "from your sessions"),
        mk("div", { class: "feature-count" }, fmt.n(f.count.value)),
        mk("div", { class: "muted small" }, `${f.count.what} (${f.count.source === "archive" ? "memory's archive" : "your traffic"})`)),
      mk("div", { class: "feature-cell feature-actions" },
        // A console page (Records) opens in a tab of its own, as About's links do; a harness route opens here.
        mk("a", { class: "ghost sm btn-link", href: f.evidence.href, ...(String(f.evidence.href).startsWith("#") ? {} : { target: "_blank", rel: "noopener" }) }, f.evidence.label),
        f.compare && act ? mk("button", { class: "ghost sm", type: "button", onclick: () => act.onCompare(f) }, f.compare.label) : null)));
}

/**
 * The board's own line: where its numbers come from, and nothing the page's header already said (HarnessV3-Launch
 * LD-D18). Memory's archive is named only when the board read one.
 * @param {{ window: { records: number, oldest: string | null }, archive?: boolean }} board
 */
export function sourcesLine(board) {
  const n = board.window.records;
  if (!n) return board.archive ? "From memory's archive: your own traffic has no requests yet." : "Your own traffic has no requests yet.";
  const when = shortWhen(board.window.oldest);
  const traffic = n === 1 ? `the last request${when ? `, on ${when}` : ""}` : `the last ${fmt.n(n)} requests${when ? `, since ${when}` : ""}`;
  return `From your own traffic: ${traffic}${board.archive ? ", and memory's archive" : ""}.`;
}

/**
 * The comparison table: one row per replayed turn as the run reports it, the totals at the end.
 * @param {{ n: number, status: string, original: any, replay: any, error?: string }[]} rows
 * @param {{ original: any, replay: any } | null} totals
 */
export function compareTable(rows, totals) {
  const side = (/** @type {any} */ s) => [h("td", {}, tok(s?.sentTokens)), h("td", {}, tok(s?.inputTokens)), h("td", {}, tok(s?.cacheReadTokens)), h("td", {}, usd(s?.costUsd)), h("td", {}, s?.ms != null ? `${fmt.n(s.ms)} ms` : "–")];
  const head = (/** @type {string} */ label) => [h("th", {}, `${label} sent`), h("th", {}, "billed in"), h("th", {}, "cache"), h("th", {}, "cost"), h("th", {}, "time")];
  return h("table", { class: "compare-table" },
    h("thead", {}, h("tr", {}, h("th", {}, "turn"), ...head("original"), ...head("replay"), h("th", {}, ""))),
    h("tbody", {},
      ...rows.map((r) => h("tr", { class: r.status === "error" ? "err" : "" }, h("td", {}, `t${r.n}`), ...side(r.original), ...side(r.replay), h("td", { class: "muted small" }, r.error ? r.error : r.replay?.form ? `as ${r.replay.form === "plain" ? "whole" : r.replay.form}` : ""))),
      totals ? h("tr", { class: "totals" }, h("td", {}, "total"), ...side(totals.original), ...side(totals.replay), h("td", {}, "")) : null));
}

/**
 * @typedef {{ api?: (path: string, o?: any) => Promise<any>, follow?: typeof followRun }} FeaturesIo  the admin API and
 *   a run's follow (a test's stand-ins)
 */

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, getChain?: () => string | undefined }} cb
 * @param {FeaturesIo} [io]
 */
export async function renderFeatures(body, cb, io = {}) {
  const call = io.api || api;
  const chainId = cb.getChain?.() || null;
  body.replaceChildren(h("p", { class: "muted small" }, "loading the board…"));
  /** @type {any} */
  let board;
  try {
    board = await call(`/features${chainId ? `?session=${encodeURIComponent(chainId)}` : ""}`);
  } catch (/** @type {any} */ e) {
    body.replaceChildren(h("p", { class: "err" }, `the board could not be read: ${e?.message || e}`));
    return;
  }
  const compareHost = h("div", { class: "compare-host" });
  const intro = h("p", { class: "set-desc" }, sourcesLine(board));
  const act = board.session ? { onCompare: (/** @type {any} */ f) => compareForm(compareHost, board, f, cb, io) } : null;
  body.replaceChildren(intro, h("div", { class: "feature-board" }, ...board.features.map((f) => featureRow(f, act))), compareHost);
}

/**
 * The replay-compare form and its live table.
 * @param {HTMLElement} host @param {any} board @param {any} feature
 * @param {{ onToast?: (msg: string, kind?: string) => void }} cb
 * @param {FeaturesIo} io
 */
async function compareForm(host, board, feature, cb, io) {
  const call = io.api || api;
  const follow = io.follow || followRun;
  const chainId = board.session;
  // What the copy runs under is the feature's own variant (app/features.js): memory off, tool results as one line, or
  // your defaults alone.
  const variant = feature.compare || {};
  const under = String(variant.under || "the same settings");
  const turnsIn = h("input", { class: "compare-turns", type: "number", min: "1", max: "10", value: "3" });
  const out = h("div", { class: "compare-out" });
  const go = h("button", { class: "sm", type: "button" }, "Replay-compare");
  go.addEventListener("click", async () => {
    go.setAttribute("disabled", "");
    out.replaceChildren(h("p", { class: "muted small" }, "making the copy…"));
    /** @type {{ n: number, status: string, original: any, replay: any, error?: string }[]} */
    const rows = [];
    try {
      const started = await call(`/sessions/${encodeURIComponent(chainId)}/replay-compare`, { method: "POST", body: { ...(variant.settings ? { settings: variant.settings } : {}), ...(variant.defaults ? { defaults: true } : {}), turns: Number(/** @type {HTMLInputElement} */ (turnsIn).value) || 3 } });
      const status = h("p", { class: "muted small" }, `replaying turn${started.turns.length === 1 ? "" : "s"} ${started.turns.join(", ")} on the copy ${started.forkId} under ${under}…`);
      const table = h("div", {}, compareTable(rows, null));
      out.replaceChildren(status, table, h("p", { class: "small" }, h("a", { href: `#/task/${encodeURIComponent(started.forkId)}` }, "Open the copy"), " · ", h("a", { href: `#/control-room/${encodeURIComponent(started.runId)}` }, "the run")));
      /** The run's end came among its events: the totals and their line are drawn. */
      let ended = false;
      follow(started.runId, {
        onEvent: (e) => {
          if (e.type === "replay-turn") {
            rows.push(e);
            table.replaceChildren(compareTable(rows, null));
          }
          if (e.type === "run-end") {
            ended = true;
            const sum = e.summary || {};
            table.replaceChildren(compareTable(sum.rows || rows, sum.totals || null));
            status.textContent = e.status === "done"
              ? `done: ${sum.replayed ?? rows.length} turn${(sum.replayed ?? rows.length) === 1 ? "" : "s"} replayed under ${under} — original ${tok(sum.totals?.original?.sentTokens)} sent / ${usd(sum.totals?.original?.costUsd)}, replay ${tok(sum.totals?.replay?.sentTokens)} sent / ${usd(sum.totals?.replay?.costUsd)}`
              : `the replay stopped: ${e.status}`;
            go.removeAttribute("disabled");
          }
        },
        onGap: () => cb.onToast?.("Some run events were lost before the page followed", "err"),
        // The follow can end with no run-end among the events: a run that ended with none in its log (Filament
        // restarted under it), or one the server no longer holds. The line says which, and the form is free again.
        onRunEnd: (st) => {
          if (!ended) status.textContent = `the replay stopped: ${st}`;
        },
        onMissing: () => {
          status.textContent = RUN_GONE;
        },
        onDone: () => go.removeAttribute("disabled"),
      });
    } catch (/** @type {any} */ e) {
      out.replaceChildren(h("p", { class: "err" }, String(e?.message || e)));
      go.removeAttribute("disabled");
    }
  });
  host.replaceChildren(
    h("h3", { class: "compare-title" }, `Replay-compare — ${feature.label}`),
    h("p", { class: "set-desc" }, `Duplicate the open session under ${under} and replay its last turns there; the table shows what each side sent and paid. The original is not touched.`),
    h("div", { class: "compare-form" }, h("label", {}, "last ", turnsIn, " turns"), go),
    out);
}
