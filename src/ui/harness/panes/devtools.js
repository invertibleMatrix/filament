// @ts-check
// The Developer tools pane (§5.9.8), Filament's traffic page per session: the token-debug tiles and the
// full table (one row per main-session request, every column the plan names), then Network status — the
// upstream attempts each record tells about, with the request headers the record kept. Response headers
// are not recorded anywhere, and the pane says so rather than showing an empty section.
import { h, morphChildren } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { api } from "../lib/api.js";
import { briefReads } from "../lib/brief-reads.js";
import { attemptsOf, isMainRecord } from "./pane-data.js";
import { cacheSaid, hitOf, seenPrompt } from "../../lib/cache-facts.js";

// The run's pulse draws the pane again a second or so apart while a turn runs: the chat's records are read once a moment.
const requestsRead = briefReads((path) => api(path));


/**
 * @param {HTMLElement} body
 * @param {{ chat: any, setBadge?: (n: number) => void }} ctx
 */
export function renderDevtools(body, ctx) {
  const chainId = ctx.chat?.chainId;
  if (!chainId) { body.append(h("div", { class: "pane-empty" }, "No main session token records yet.")); return; }
  const box = h("div", { class: "pane-scroll", "data-chain": chainId }, h("div", { class: "pane-empty", "data-key": "none" }, "Loading…"));
  body.append(box);
  draw(box, chainId, ctx);
}

/**
 * The pane at the run's pulse: the box that stands for the chat drawn again in place — the pulse emptied the pane and
 * made it anew, its table back to "Loading…" and the header sections opened closed (the owner's of 11-01: buttons
 * blinking under a resting pointer, clicks lost). Another chat's: drawn anew.
 * @param {HTMLElement} body
 * @param {{ chat: any, setBadge?: (n: number) => void }} ctx
 */
export function refreshDevtools(body, ctx) {
  const chainId = ctx.chat?.chainId;
  const box = body.querySelector(".pane-scroll");
  if (chainId && box && box.getAttribute("data-chain") === chainId) {
    draw(/** @type {HTMLElement} */ (box), chainId, ctx);
    return;
  }
  body.replaceChildren();
  renderDevtools(body, ctx);
}

/**
 * The chat's records into the box, in place: each part keyed by what it is, each attempt's row by its record.
 * @param {HTMLElement} box @param {string} chainId @param {{ setBadge?: (n: number) => void }} ctx
 */
function draw(box, chainId, ctx) {
  requestsRead(`/sessions/${encodeURIComponent(chainId)}/requests?limit=100`).then((r) => {
    const rows = r.requests || [];
    const main = rows.filter(isMainRecord);
    ctx.setBadge?.(main.length);
    if (!rows.length) { morphChildren(box, [h("div", { class: "pane-empty", "data-key": "none" }, "No main session token records yet.")]); return; }
    // The note rides only when the ring was capped (HarnessV3-Launch LD-D19).
    const capNote = r.capped ? h("p", { class: "pane-note", "data-key": "cap" }, "Older calls are no longer in the ring — the figures cover the newest 100 (observability.keepLastRequests, 500 by default).") : null;

    const totalIn = main.reduce((n, x) => n + (x.tokens?.input || 0), 0);
    const totalCacheRead = main.reduce((n, x) => n + (x.tokens?.cacheRead || 0), 0);
    // The average is of the requests whose usage said its cache numbers (lib/cache-facts.js): none where none did.
    const cacheable = main.reduce((n, x) => n + seenPrompt(x.tokens), 0);
    const avgHit = cacheable ? totalCacheRead / cacheable : null;

    morphChildren(box, [
      h("div", { class: "pane-toolbar", "data-key": "tokens" }, h("span", {}, "Token debug")),
      capNote,
      h("div", { class: "dev-tiles", "data-key": "tiles" },
        tile("Main requests", String(main.length)),
        tile("Average hit", avgHit != null ? fmt.pct(avgHit) : "–"),
        tile("Total input", fmt.n(totalIn)),
        tile("Total cache read", fmt.n(totalCacheRead))),
      main.length
        ? h("div", { class: "dev-table-wrap", "data-key": "table" },
          h("table", { class: "pane-table" },
            h("thead", {}, h("tr", {}, ...["Round", "Input", "Output", "Total", "Reasoning", "Cache read", "Cache write", "Hit rate", "TPS (tokens/s)"].map((c) => h("th", {}, c)))),
            h("tbody", {}, ...main.slice().reverse().map((x, i) => {
              const t = x.tokens || {};
              const total = (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
              // A request whose usage said no cache numbers has none to show: a dash, never 0.
              const said = cacheSaid(t);
              const hit = hitOf(t);
              return h("tr", {},
                h("td", {}, String(main.length - i)),
                h("td", {}, fmt.n(t.input || 0)),
                h("td", {}, fmt.n(t.output || 0)),
                h("td", {}, fmt.n(total)),
                h("td", {}, t.thinking ? fmt.n(t.thinking) : "–"),
                h("td", {}, said ? fmt.n(t.cacheRead || 0) : "–"),
                h("td", {}, said ? fmt.n(t.cacheWrite || 0) : "–"),
                h("td", {}, hit != null ? fmt.pct(hit) : "–"),
                h("td", {}, x.tps != null ? String(x.tps) : "–"));
            }))))
        : h("div", { class: "pane-empty", "data-key": "table" }, "No main session token records yet."),
      h("div", { class: "pane-toolbar", "data-key": "network" }, h("span", {}, "Network status")),
      network(rows)]);
  }).catch((e) => { morphChildren(box, [h("div", { class: "pane-empty", "data-key": "none" }, String(e?.message || e))]); });
}

/** @param {string} label @param {string} value */
const tile = (label, value) => h("div", { class: "dev-tile" }, h("span", { class: "dev-tile-value" }, value), h("span", { class: "dev-tile-label" }, label));

/** The attempts every recent record tells about, oldest last. @param {any[]} rows */
const network = (rows) => {
  const attempts = rows.slice(0, 20).flatMap((rec) => attemptsOf(rec).map((a) => ({ rec, a })));
  if (!attempts.length) return h("div", { class: "pane-empty", "data-key": "net" }, "No upstream attempts recorded yet.");
  return h("div", { class: "dev-net", "data-key": "net" }, ...attempts.map(({ rec, a }) =>
    h("div", { class: "dev-attempt", "data-key": `${rec.id}:${a.attempt}:${a.served ? "served" : "failed"}` },
      h("div", { class: "dev-attempt-row", "data-key": "row" },
        h("span", { class: "dev-attempt-model" }, rec.model || ""),
        h("span", { class: "dev-attempt-provider" }, a.provider),
        h("span", { class: "dev-attempt-col" }, `Attempt ${a.attempt}`),
        h("span", { class: "dev-attempt-col" }, a.http != null ? `HTTP ${a.http}` : "HTTP –"),
        h("span", { class: "dev-attempt-col" }, a.ms != null ? fmt.ms(a.ms) : "–"),
        a.error ? h("span", { class: "dev-attempt-error" }, a.error) : null),
      a.served ? headerRows(rec) : null)));
};

/**
 * The header sections of one served call. The list rows carry no headers — the record's detail does — so
 * the section fetches on first open. Response headers Filament does not record; it says so. The sections stand as
 * first drawn (`data-placed`): a draw at the pulse leaves them, open or closed, with what they read — their own
 * listeners act on themselves.
 * @param {any} rec
 */
const headerRows = (rec) => {
  /** @type {any} */
  let req = null;
  /** @returns {HTMLElement} */
  const reqSection = () => {
    req = h("details", { class: "dev-headers" },
      h("summary", {}, "Request headers"),
      h("div", { class: "pane-note" }, "Loading…"));
    req.addEventListener("toggle", () => {
      if (!req.open || req.dataset.done) return;
      req.dataset.done = "1";
      api(`/requests/${encodeURIComponent(rec.id)}`).then((full) => {
        const headers = full?.shapedHeaders && Object.keys(full.shapedHeaders).length
          ? Object.keys(full.shapedHeaders).map((k) => `${k}: ${full.shapedHeaders[k]}`).join("\n")
          : "";
        req.querySelector(".pane-note")?.remove();
        req.append(headers
          ? h("pre", { class: "dev-headers-pre" }, headers)
          : h("p", { class: "pane-note" }, "No headers recorded."));
      }).catch(() => {
        req.querySelector(".pane-note")?.remove();
        req.append(h("p", { class: "pane-note" }, "No headers recorded."));
      });
    });
    return req;
  };
  return h("div", { "data-key": "headers", "data-placed": "" },
    reqSection(),
    h("details", { class: "dev-headers" },
      h("summary", {}, "Response headers"),
      h("p", { class: "pane-note" }, "No headers recorded.")));
};
