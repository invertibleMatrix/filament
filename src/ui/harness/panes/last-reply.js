// @ts-check
// The newest finished reply's record (proposal_ux R2: the Context pane's parts, in the Run pane now): Run › Calls heads
// with what it sent, got back, read from the cache and cost, the Context sources as §9 B8 computes them (labelled an
// estimate), the chat's held tokens per request as a bar chart (cache read shaded) and — only when the records can
// honestly fund it — the forecast line for the next request's cost; Run › For developers says what Filament did to it.
// The record is read once per turn where the page has none (a reload brings the turns without them).
import { h, morphChildren, standing } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { costWords } from "../../lib/cost.js";
import { cacheSaid } from "../../lib/cache-facts.js";
import { api } from "../lib/api.js";
import { briefReads } from "../lib/brief-reads.js";
import { contextSources, sourceTint } from "../widgets/context.js";
import { heldSeries, forecastNext } from "./pane-data.js";
import { meterTurnOf } from "../conversation/history.js";

/** @typedef {{ chat: any }} LastReplyCtx */

/**
 * The reply whose record the pane shows: the newest finished model turn, as the meter picks it — a command and the
 * running turn have none of their own, so mid-turn it is the reply before. Null: no reply has ended yet.
 * @param {any[]} turns
 */
export function anatomyTurn(turns) {
  return meterTurnOf(turns, () => null);
}

/** Records read, per turn, once: a reload brings the turns without them (HarnessV4_Tasks U3, V4-D216). A promise while
 *  it is on its way. */
const records = new WeakMap();

/** The chat's request list for the held-per-request bars, read once a moment: the run's pulse draws Calls again a second
 *  or so apart while a turn runs. */
const requestsRead = briefReads((path) => api(path));

/**
 * The newest reply's record, or why there is none, into `box`; drawn again once a record read here lands, if the box is
 * still on screen. `draw` turns the record into the part's nodes. Drawn in place: the run's pulse draws the box again a
 * second or so apart, and the part made anew each time stood new elements under a resting pointer (the owner's of
 * 11-01: buttons blinking under a resting pointer, clicks lost).
 * @param {HTMLElement} box @param {LastReplyCtx} ctx @param {(r: any) => any[]} draw
 */
function withRecord(box, ctx, draw) {
  const turn = anatomyTurn(ctx.chat?.turns || []);
  const had = turn ? turn.rec || records.get(turn) || null : null;
  if (turn && !turn.rec && !records.has(turn) && turn.requestId) {
    const asked = api(`/requests/${encodeURIComponent(String(turn.requestId))}`)
      .then((r) => { records.set(turn, r || null); })
      .catch(() => { records.set(turn, null); })
      .then(() => { if (box.isConnected) withRecord(box, ctx, draw); });
    records.set(turn, asked);
  }
  const r = had && !(had instanceof Promise) ? had : null;
  if (!r) {
    morphChildren(box, [h("div", { class: "pane-empty" }, !turn
      ? ctx.chat?.live ? "The first reply's figures show here once it ends." : "No reply yet."
      : records.get(turn) instanceof Promise ? "Reading the last reply's figures…" : "The last reply's request is not on record.")]);
    return;
  }
  morphChildren(box, draw(r));
}

/**
 * Run › Calls' head: the newest reply's figures, its Context sources, and the held tokens per request with the
 * forecast.
 * @param {HTMLElement} box @param {LastReplyCtx} ctx
 */
export function renderLastReply(box, ctx) {
  withRecord(box, ctx, (r) => {
    const src = contextSources(r);
    const total = src.rows.reduce((n, [, v]) => n + v, 0);
    // The bars are placed by their read as it lands, into the box that stands (`data-placed`, `standing`): drawn as a
    // child of the draw, each pulse would empty them until the read answered again.
    const historyBox = h("div", { class: "ctx-history", "data-key": "history", "data-placed": "" });
    readHistory(historyBox, ctx, r);
    return [h("div", { class: "ctx-anatomy-body" },
      h("div", { class: "pane-toolbar" }, h("span", {}, `The newest reply${r.model ? ` · ${r.model}` : ""}`)),
      h("div", { class: "kv ctx-kv" },
        h("span", {}, "sent"), h("span", {}, `${fmt.n(r.tokens?.input)} tok`),
        h("span", {}, "out"), h("span", {}, fmt.n(r.tokens?.output)),
        // A reply whose usage said no cache numbers (lib/cache-facts.js) has none to show: a dash, never 0.
        h("span", {}, "cache read"), h("span", {}, cacheSaid(r.tokens) ? fmt.n(r.tokens?.cacheRead || 0) : "–"),
        h("span", {}, "cache write"), h("span", {}, cacheSaid(r.tokens) ? fmt.n(r.tokens?.cacheWrite || 0) : "–"),
        // An agent turn's cost is the loop's whole spend; the shell record's own cost is one round (§9.3.4). Its list
        // figure is its rounds' (Providers P4) — a plan's turn paid $0, which is a figure, not "–".
        h("span", {}, "cost"), h("span", {}, r.agent?.spentUsd != null ? costWords(r.agent.spentUsd, r.agent.listUsd ?? null).text : costWords(r.cost ?? null, r.listCost ?? null).text)),
      src.rows.length
        ? h("div", { class: "ctx-sources", "data-key": "sources" },
            h("h4", { class: "pane-sub" }, "Context sources ", h("span", { class: "ctx-est" }, "(estimate)")),
            ...src.rows.map(([label, n]) => h("div", { class: "ctx-source-row" },
              h("span", { class: "ctx-source" },
                h("span", { class: `meter-swatch${sourceTint(label) ? "" : " held"}`, style: sourceTint(label) ? `background:var(--color-context-breakdown-${sourceTint(label)})` : "" }),
                label),
              h("span", { class: "ctx-source-n" }, `${fmt.n(n)} · ${total ? Math.round((n / total) * 100) : 0}%`))),
            src.measured ? null : h("p", { class: "pane-note" }, "The rest is not measured for agent turns."))
        // A coding agent's own context is not Filament's to itemise (AC3-5): the record says it whole.
        : h("p", { class: "pane-note" }, r.acp
          ? "A coding agent's turn — the agent keeps its own context and reports it whole, so there are no parts to name."
          : "This record carries no composition figures."),
      h("h4", { class: "pane-sub" }, "Held per request"),
      historyBox)];
  });
}

/**
 * For developers' part of the record: what Filament did to the newest request.
 * @param {HTMLElement} box @param {LastReplyCtx} ctx
 */
export function renderFilamentDid(box, ctx) {
  withRecord(box, ctx, (r) => [
    h("div", { class: "pane-toolbar" }, h("span", {}, "What Filament did")),
    r.changes?.length
      ? h("ul", { class: "pane-changes" }, ...r.changes.map((/** @type {any} */ x) => h("li", {}, x)))
      : h("p", { class: "pane-note" }, "Nothing: the newest request went as the chat composed it."),
  ]);
}

/**
 * The held tokens (input + both cache tokens) per request of the chat, oldest first, the cache read share shaded. The
 * forecast is a plain fit over the priced tail, read at the next request and labelled as the estimate it is; without
 * priced rows there is no line.
 * @param {HTMLElement} historyBox @param {LastReplyCtx} ctx @param {any} r
 */
function readHistory(historyBox, ctx, r) {
  /** The bars into the box on the page — the one drawn over by a later pulse's draw, or this draw's own. @param {any[]} parts */
  const place = (parts) => {
    const at = standing(historyBox);
    if (at.isConnected) morphChildren(at, parts);
  };
  requestsRead(`/sessions/${encodeURIComponent(ctx.chat?.chainId || r.memory?.chain || "")}/requests?limit=50`)
    .then((page) => {
      const rows = [...(page.requests || [])].reverse();
      if (!rows.length) {
        place([h("p", { class: "pane-note" }, "No recorded requests yet.")]);
        return;
      }
      const series = heldSeries(rows);
      const max = Math.max(...series, 1);
      place([h("div", {},
        h("div", { class: "ctx-bars" },
          ...series.map((v, i) => {
            const read = rows[i]?.tokens?.cacheRead || 0;
            const hpx = Math.max(2, Math.round((v / max) * 96));
            const rpx = v ? Math.max(1, Math.round((read / v) * hpx)) : 0;
            return h("span", { class: "ctx-bar", style: `height:${hpx}px`, title: `request ${i + 1}: ${fmt.n(v)} held${read ? ` · ${fmt.n(read)} cache read` : ""}` },
              h("span", { class: "ctx-bar-read", style: `height:${rpx}px` }));
          })),
        forecast(rows, series.length))]);
    })
    .catch(() => place([h("p", { class: "pane-note" }, "The chat's records could not be read.")]));
}

/**
 * The forecast line, only from priced records: the linear fit's next value, said as an estimate. On a plan every request
 * is paid $0: the line reads the list price instead, and says so.
 * @param {any[]} rows @param {number} n
 */
function forecast(rows, n) {
  const listed = rows.some((x) => x.cost === 0 && typeof x.listCost === "number" && x.listCost > 0);
  const costs = rows.map((x) => {
    const c = listed ? x.listCost : x.cost;
    return typeof c === "number" ? c : null;
  });
  const priced = costs.filter((c) => c != null);
  if (priced.length < 3) return h("p", { class: "pane-note" }, "Too few priced records for a forecast — the line needs priced calls only, never a guess.");
  const next = forecastNext(/** @type {number[]} */ (costs));
  if (next == null) return null;
  return h("p", { class: "pane-note" }, `At this rate request ${n + 1} costs ≈ ${fmt.usd(next)}${listed ? " at list price" : ""} (estimate) — a linear fit of the last ${Math.min(10, priced.length)} priced records.`);
}
