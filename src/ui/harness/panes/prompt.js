// @ts-check
// Run › Calls (§5.9.6, Filament's "show me the prompt"; the Prompt pane until proposal_ux M1): one card per model call
// of the session.
// Collapsed, a card is the tag the record itself carries, the model, the in/out figures, the finish
// reason and the duration. Expanded it fetches the record: the input's messages with role stripes and
// per-message Copy content when bodies are stored — an honest notice when they are not — and the output
// side's figures (Filament records the reply's counts, never its bytes; the reply lives in the transcript).
import { h, morphChildren } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { stopReasonText } from "../lib/labels.js";
import { promptTagOf } from "./pane-data.js";

/** The trajectory colours, one role stripe each. */
const ROLE_CLASS = { user: "user", assistant: "assistant", system: "system" };

// The run's pulse draws this pane again a second or so apart, in place: the cards are the elements that stood, keyed by
// their record (a list made anew put new cards, buttons and a new search field under a resting pointer — the owner's
// of 11-01: buttons blinking under a resting pointer, clicks lost); what the developer opened stays open and the rows
// it already fetched are not pulled again a second later.
/** @type {Map<string, { rows: any[], capped: boolean, at: number }>} chain → the fetched rows, briefly */
const rowCache = new Map();
/** Cards the developer left open, by record id — a pane drawn anew (another chat, Refresh) rebuilds them open. */
const openCards = new Set();
/** What each body shows, for the pulse: its chat, and the list drawn again in place. @type {WeakMap<HTMLElement, { chainId: string, again: () => void }>} */
const drawn = new WeakMap();
/** The records a drawing reads at a time, the rest waiting their turn: Expand all opens every card at once, and a
 *  hundred reads at once would hold the browser's six connections to Filament, every other read of the page behind them. */
export const RECORD_READS_AT_ONCE = 2;

/**
 * @param {HTMLElement} body
 * @param {{ chat: any, setBadge?: (n: number) => void, config?: any }} ctx
 */
export function renderPrompt(body, ctx) {
  const chainId = ctx.chat?.chainId;
  if (!chainId) {
    body.append(h("div", { class: "pane-empty" }, "No calls yet: they show here once a turn lands."));
    drawn.set(body, { chainId: "", again: () => {} });
    return;
  }

  /** @type {any[]} */
  let rows = [];
  /** The cards by record id, each the element that stands: a draw passes them as themselves. @type {Map<string, any>} */
  const cards = new Map();
  let capped = false;
  let query = "";
  /** Whether the list has shown its rows: "Loading…" shows before the first, never over the cards at a pulse. */
  let listed = false;

  const toolbar = h("div", { class: "pane-toolbar" },
    h("span", { class: "prompt-toolbar-count" }, ""),
    h("span", { class: "flex-1" }));
  const list = h("div", { class: "pane-scroll prompt-list" }, h("div", { class: "pane-empty", "data-key": "empty" }, "Loading…"));
  const search = h("input", { class: "zc-input", type: "text", placeholder: "Search trajectory…", "aria-label": "Search trajectory" });
  const expandAll = h("button", { class: "ghost sm", type: "button", title: "Expand all", html: ICONS.chevronsUpDown });
  const collapseAll = h("button", { class: "ghost sm", type: "button", title: "Collapse all", html: ICONS.chevronsDownUp });
  const refresh = h("button", { class: "ghost sm", type: "button", title: "Refresh", html: ICONS.rotateCcw });
  body.append(
    h("div", { class: "pane-toolbar" }, h("span", {}, "Every call"), h("span", { class: "flex-1" }), expandAll, collapseAll, refresh),
    h("div", { class: "prompt-search" }, search),
    toolbar,
    list);

  const paintCount = () => {
    const total = rows.reduce((n, x) => n + (x.tokens?.input || 0) + (x.tokens?.output || 0), 0);
    toolbar.querySelector(".prompt-toolbar-count")?.replaceChildren(
      document.createTextNode(`${rows.length} call${rows.length === 1 ? "" : "s"} · ${fmt.n(total)} tok`));
  };

  /** The list drawn in place: the cards that stand are passed as themselves, a record gone from the ring takes its card with it. */
  const paintList = () => {
    paintCount();
    const q = query.trim().toLowerCase();
    const shown = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : rows;
    const ids = new Set(rows.map((r) => r.id));
    for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
    const kids = [
      capped ? h("p", { class: "pane-note", "data-key": "capped" }, "Older calls are no longer in the ring (observability.keepLastRequests, 500 by default).") : null,
      ...shown.map((rec) => cards.get(rec.id) || card(rec)),
    ];
    if (!shown.length) kids.push(h("div", { class: "pane-empty", "data-key": "empty" }, q ? "No calls match." : "No calls recorded for this session."));
    morphChildren(list, kids);
    listed = true;
  };

  const load = () => {
    const hit = rowCache.get(chainId);
    if (hit && Date.now() - hit.at < 8000 && hit.rows.length) {
      rows = hit.rows;
      capped = hit.capped;
      ctx.setBadge?.(rows.length);
      paintList();
      return;
    }
    if (!listed) morphChildren(list, [h("div", { class: "pane-empty", "data-key": "empty" }, "Loading…")]);
    api(`/sessions/${encodeURIComponent(chainId)}/requests?limit=100`).then((r) => {
      rows = r.requests || [];
      capped = !!r.capped;
      rowCache.set(chainId, { rows, capped, at: Date.now() });
      ctx.setBadge?.(rows.length);
      paintList();
    }).catch((e) => { morphChildren(list, [h("div", { class: "pane-empty", "data-key": "empty" }, String(e?.message || e))]); });
  };

  /** @param {any} rec */
  const card = (rec) => {
    const detail = h("div", { class: "prompt-detail" }, h("div", { class: "pane-empty" }, "Loading…"));
    let loaded = false;
    const stop = stopReasonText(rec.stopReason || "");
    const t = rec.tokens || {};
    const det = h("details", { class: "prompt-card", "data-key": rec.id },
      h("summary", {},
        h("span", { class: "prompt-tag" }, promptTagOf(rec)),
        h("span", { class: "prompt-model" }, rec.model || ""),
        h("span", { class: "prompt-usage" }, `in ${fmt.n(t.input || 0)} · out ${fmt.n(t.output || 0)}`),
        rec.stopReason ? h("span", { class: "prompt-stop" }, stop) : null,
        rec.totalMs != null ? h("span", { class: "prompt-ms" }, fmt.ms(rec.totalMs)) : null),
      detail);
    cards.set(rec.id, det);
    if (openCards.has(rec.id)) {
      det.open = true;
      loaded = true;
      fill(rec, detail);
    }
    det.addEventListener("toggle", () => {
      if (det.open) {
        openCards.add(rec.id);
        // Records leave the ring; an open card of a gone record should not hold a slot forever.
        if (openCards.size > 200) openCards.delete(openCards.values().next().value);
        if (!loaded) { loaded = true; fill(rec, detail); }
        return;
      }
      openCards.delete(rec.id);
      // Re-expand refetches: the ring may have moved on under a collapsed card.
      loaded = false;
      detail.replaceChildren(h("div", { class: "pane-empty" }, "Loading…"));
    });
    return det;
  };

  /** The records' reads under way, and those waiting their turn. */
  let reading = 0;
  /** @type {Array<() => void>} */
  const waiting = [];
  /** A record read in its turn, RECORD_READS_AT_ONCE at a time. @param {string} id */
  const readRecord = async (id) => {
    if (reading >= RECORD_READS_AT_ONCE) await new Promise((r) => waiting.push(() => r(null)));
    else reading++;
    try {
      return await api(`/requests/${encodeURIComponent(id)}`);
    } finally {
      // The slot goes to the next read waiting, else it is free.
      const next = waiting.shift();
      if (next) next();
      else reading--;
    }
  };

  /** @param {any} rec @param {HTMLElement} detail */
  const fill = async (rec, detail) => {
    try {
      const full = await readRecord(rec.id);
      const raw = full?.shapedBody || full?.inboundBody || "";
      detail.replaceChildren(...inputSection(raw, full).filter(Boolean), outputSection(rec, full));
    } catch (e) {
      detail.replaceChildren(h("p", { class: "pane-note" }, String(/** @type {any} */ (e)?.message || e)));
    }
  };

  /** The Input section: the messages when the record stores them, the honest notice when it does not. @param {string} raw @param {any} full @returns {HTMLElement[]} */
  const inputSection = (raw, full) => {
    if (!raw) {
      const stored = ctx?.config?.observability?.storeBodies;
      const why = full?.bodyWithheld
        ? String(full.bodyWithheld)
        : stored
          ? "Request bodies are stored at " + JSON.stringify(stored) + " — this record carries none (it predates the setting, or the call was not a request)."
          : "Request bodies are not stored (observability.storeBodies keeps summaries, not bytes). Set it to shaped in the console to see the prompt bytes.";
      return [h("p", { class: "pane-note" }, why)];
    }
    let messages = [];
    try { messages = JSON.parse(raw)?.messages || []; } catch {}
    if (!messages.length) return [h("p", { class: "pane-note" }, "This record carries no message bodies.")];
    return [h("div", { class: "prompt-section-label" }, "Input"),
      h("div", { class: "prompt-messages" }, ...messages.slice(0, 40).map((/** @type {any} */ m) => {
        const text = typeof m.content === "string"
          ? m.content
          : (m.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("\n");
        const role = m.role || "?";
        const pre = h("pre", { class: "prompt-msg-text" }, String(text || "").slice(0, 1200));
        const copy = h("button", { class: "ghost xs prompt-copy", type: "button" }, "Copy content");
        copy.addEventListener("click", () => navigator.clipboard.writeText(String(text || "")).catch(() => {}));
        return h("details", { class: `prompt-msg stripe-${ROLE_CLASS[role] || "tool"}` },
          h("summary", {}, h("b", {}, role), h("span", { class: "flex-1" }), copy),
          pre);
      }))];
  };

  /** The Output section: the record's reply figures and, when the call failed, its error — never invented text. @param {any} rec @param {any} full */
  const outputSection = (rec, full) => {
    const t = rec.tokens || {};
    const bits = [
      rec.stopReason ? `finish: ${stopReasonText(rec.stopReason)}` : "",
      t.output ? `out ${fmt.n(t.output)} tok` : "",
      rec.tps != null ? `${rec.tps} tok/s` : "",
      full?.outChars != null ? `${fmt.n(full.outChars)} chars` : "",
    ].filter(Boolean);
    return h("div", { class: "prompt-output" },
      h("div", { class: "prompt-section-label" }, "Output"),
      bits.length ? h("p", { class: "pane-note" }, bits.join(" · ")) : null,
      rec.status === "error" || rec.error ? h("p", { class: "pane-note prompt-error" }, String(rec.error || "the call failed")) : null,
      h("p", { class: "pane-note" }, "Filament records this reply's figures, not its bytes — the reply itself lives in the transcript."));
  };

  search.addEventListener("input", () => { query = search.value; paintList(); });
  expandAll.addEventListener("click", () => cards.forEach((el) => { if (!el.open) { el.open = true; el.dispatchEvent(new Event("toggle")); } }));
  collapseAll.addEventListener("click", () => cards.forEach((el) => { el.open = false; }));
  // Refresh is the developer's own press: the list shows "Loading…" and its cards are made anew from the records read.
  refresh.addEventListener("click", () => { cards.clear(); rowCache.delete(chainId); listed = false; load(); });
  drawn.set(body, { chainId, again: load });
  load();
}

/**
 * The pane at the run's pulse: the list drawn again in place for the chat it shows — the pulse emptied the pane and made
 * it anew (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost). Another chat's: drawn anew.
 * @param {HTMLElement} body
 * @param {{ chat: any, setBadge?: (n: number) => void, config?: any }} ctx
 */
export function refreshPrompt(body, ctx) {
  const had = drawn.get(body);
  if (had && had.chainId === (ctx.chat?.chainId || "")) {
    had.again();
    return;
  }
  body.replaceChildren();
  renderPrompt(body, ctx);
}
