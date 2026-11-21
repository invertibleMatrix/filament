// @ts-check
// The Compacting row (HarnessV4_Tasks U3-5, UX-8): a compaction under way, said at the transcript's end while it
// runs — who writes, what has been written so far, how long it has run, how long since the last byte — with its Stop.
// Its figures are the server's (`compaction-progress` on the events feed, `app/sessions/service.js`): the step in the
// compactor's own words, the calls as the request log sees them stream. Nothing is made up: a percent only where the
// slice pass knows one, tokens as an estimate said as one, and no silence said while the stream flows.
import { h as pageH } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";

/**
 * A running compaction as the server says it.
 * @typedef {{ door?: string, since: number, step?: string | null, percent?: number | null, calls?: { running?: number, done?: number, planned?: number },
 *   thinkingChars?: number, textChars?: number, lastByteAt?: number | null, own?: boolean, stoppable?: boolean }} CompactionProgress
 */

/** How long nothing has come before the row says so: under it the stream is flowing. */
export const QUIET_MS = 5000;

/** The time run, as a clock: "0:42", "1:12", an hour's as "1:02:07". @param {number} ms */
export function ranFor(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/**
 * A running compaction in words, in order: who writes (the compactor's step), what has been written — its thinking
 * until it writes, then what it wrote after the thinking it did, so the figure never falls back as if the call began
 * again —, a slice pass's calls of the total it planned before it began ("2 of about 8": the pass may add a
 * call or two as it reads) and its percent, the time run, and the time since the last byte once that is a silence (or
 * that its call has said nothing yet). With no total planned, the calls done and running are said, never a total made
 * of the calls begun so far.
 * @param {CompactionProgress} p @param {number} now  the page's clock
 * @returns {string[]}
 */
export function compactingParts(p, now) {
  const parts = [p.step || (p.own ? "the agent compacts its own session" : "getting ready")];
  const text = Number(p.textChars) || 0;
  const thinking = Number(p.thinkingChars) || 0;
  if (text > 0) parts.push(`≈${fmt.n(fmt.tokens(text))} tokens written${thinking > 0 ? ` after ≈${fmt.n(fmt.tokens(thinking))} of thinking` : ""}`);
  else if (thinking > 0) parts.push(`thinking, ≈${fmt.n(fmt.tokens(thinking))} tokens so far`);
  const running = Number(p.calls?.running) || 0;
  const done = Number(p.calls?.done) || 0;
  const planned = Number(p.calls?.planned) || 0;
  if (planned > 1) parts.push(`${done} of about ${Math.max(planned, running + done)} calls done`);
  else if (running + done > 1) parts.push(`${done} done, ${running} running`);
  if (p.percent != null && Number.isFinite(Number(p.percent))) parts.push(`${Math.round(Number(p.percent))}%`);
  parts.push(ranFor(now - Number(p.since)));
  const last = Number(p.lastByteAt) || 0;
  const quiet = now - last;
  if (last > 0 && quiet >= QUIET_MS) parts.push(`last byte ${quiet < 60_000 ? `${Math.floor(quiet / 1000)} s` : ranFor(quiet)} ago`);
  else if (!last && running > 0) parts.push("waiting for the first byte");
  return parts;
}

/**
 * The row. `set` draws what the server last said, with its stop where there is one; `tick` moves its clocks between
 * the server's words. A stop pressed is asked once, and can be pressed again if the compaction goes on after it.
 * `bar`: a progress bar under the words (the card's progress, proposal_ux §4.12) — filled to the percent where the
 * server knows one, else moving, with no figure made up.
 * @param {{ h?: typeof pageH, bar?: boolean }} [o]
 */
export function compactingRow({ h = pageH, bar = false } = {}) {
  /** @type {CompactionProgress | null} */
  let said = null;
  /** @type {(() => any) | null} */
  let stopIt = null;
  const words = h("span", { class: "compacting-words" });
  const stop = h("button", {
    class: "boundary-toggle compacting-stop hidden", type: "button",
    onclick: () => {
      if (stop.disabled || !stopIt) return;
      stop.disabled = true;
      Promise.resolve(stopIt()).catch(() => {}).then(() => {
        stop.disabled = false;
      });
    },
  }, "Stop");
  const fill = bar ? h("span", { class: "compacting-fill" }) : null;
  const track = fill ? h("span", { class: "compacting-bar is-busy" }, fill) : null;
  const el = h("div", { class: `compacting-row${track ? " has-bar" : ""}` }, h("span", { class: "compacting-label" }, h("span", { class: "work-state gradient" }, "⌁ Compacting"), words), stop, track);
  /** @param {number} [now] */
  const tick = (now = Date.now()) => {
    if (said) words.replaceChildren(` · ${compactingParts(said, now).join(" · ")}`);
  };
  return {
    el,
    /** @param {CompactionProgress} progress @param {{ onStop?: (() => any) | null, stopTitle?: string }} [o] @param {number} [now] */
    set(progress, { onStop = null, stopTitle = "" } = {}, now = Date.now()) {
      said = progress;
      stopIt = onStop;
      if (track && fill) {
        const pct = progress.percent != null && Number.isFinite(Number(progress.percent)) ? Math.max(0, Math.min(100, Number(progress.percent))) : null;
        track.classList.toggle("is-busy", pct == null);
        fill.setAttribute("style", pct == null ? "" : `width:${pct}%`);
      }
      stop.classList.toggle("hidden", !onStop);
      stop.setAttribute("title", stopTitle);
      tick(now);
    },
    tick,
  };
}
