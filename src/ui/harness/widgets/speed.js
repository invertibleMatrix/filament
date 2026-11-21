// @ts-check
// The Speed instrument (HarnessV3-AtHome AH-S1, built with HarnessV3-ACP AC3-5): how fast the model writes. The pill,
// on the strip's right beside what the session costs, is the reply's rate over the last few seconds while it streams, easing between readings;
// while the reply pauses (a tool runs, the agent waits), its average so far, muted; between replies, the last reply's
// average, muted; nothing before the first reply this page has seen. The popover
// gives the same figure large, what the reply wrote and its average, and how the figure is counted. Every model's
// turn alike — the loop's rounds and a coding agent's turn. The figure is the page's own measure of the stream, or the
// loop's rounds' own counts once they come (lib/speed.js), handed over with the composer's live figures: it never fetches.
import { h } from "../../lib/dom.js";
import { head, hero, group, row, note, tok } from "./kit.js";
import { speedNumber, speedWords, PAUSE_MS } from "../lib/speed.js";

/** A stretch of time in seconds, to a tenth below ten. @param {number} ms */
const seconds = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return `${s < 10 ? (Math.round(s * 10) / 10).toFixed(1).replace(/\.0$/, "") : Math.round(s)} s`;
};

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @returns {import("./frame.js").WidgetSpec}
 */
export function speedWidget(ctx, io = {}) {
  const figure = () => ctx.live()?.speed || null;
  /** Writing now: the shown chat's turn streams, and its stream is writing (lib/speed.js `live`). */
  const writing = () => !!ctx.live()?.streaming && figure()?.rate != null;
  /** The running reply between words — a tool running, the agent waiting: the figure is its average so far. */
  const pausing = () => !!ctx.live()?.streaming && !writing() && figure()?.settled === false;
  /** What the pill says: the eased figure — the rate while the model writes, else the reply's average; null before any. */
  const shown = () => figure()?.shown ?? (writing() ? /** @type {number} */ (figure()?.rate) : figure()?.average ?? null);

  /** @type {null | (() => void)} */
  let painter = null;

  /** @param {typeof h} m */
  const panel = (m) => {
    const sub = m("span", {});
    const heroBox = m("div", {});
    const rows = m("div", {});
    painter = () => {
      const f = figure();
      const now = writing();
      const paused = pausing();
      const r = shown();
      sub.replaceChildren(now ? "Writing now" : paused ? "This reply, between words" : r != null ? "The last reply" : "No reply yet");
      heroBox.replaceChildren(hero(m, {
        value: r != null ? speedNumber(r) : "—",
        unit: "tok/s",
        caption: now ? "Over the last few seconds" : paused ? "Its average so far, while it wrote" : r != null ? "The reply's average, while it wrote" : "Shows as the next reply streams",
      }));
      rows.replaceChildren(...(f
        ? [group(m,
            row(m, { label: "Written", sub: now || paused ? "This reply so far" : "The last reply", value: `${tok(f.tokens)} tokens` }),
            f.average != null ? row(m, { label: "Average", sub: `Over ${seconds(f.writingMs)} of writing`, value: speedWords(f.average) }) : null)]
        : []));
    };
    painter();
    return m("div", { class: "inst inst-speed" },
      head(m, { icon: "activity", title: "Speed", sub }),
      heroBox,
      rows,
      note(m, `Each finished round's own count where its provider gives one, thinking and tool calls included; else counted from the stream as it arrives — words, thinking and the calls it writes — about four characters to a token. A tool running, the agent waiting, or a gap longer than ${seconds(PAUSE_MS)} isn't writing time.`));
  };

  return {
    id: "speed",
    label: "Speed",
    icon: "activity",
    width: 300,
    liveNow: true,
    // The tile on Overview (proposal_ux §4.6, S): the figure the pill says, large, and what it is.
    tile: (m) => {
      const r = shown();
      const f = figure();
      return [
        hero(m, { value: r != null ? speedNumber(r) : "—", unit: "tok/s", caption: writing() ? "writing now" : pausing() ? "this reply's average so far" : r != null ? "the last reply's average" : "shows as the next reply streams" }),
        f ? m("p", { class: "ov-quiet" }, `${tok(f.tokens)} tokens written${f.average != null ? ` · ${seconds(f.writingMs)} of writing` : ""}`) : null,
      ].filter(Boolean);
    },
    // Nothing to say before a reply has streamed on this page.
    visible: () => shown() != null,
    state: () => {
      const r = shown();
      return r == null ? "" : speedWords(r);
    },
    // Between replies the figure is the last one's: the glyph and the figure step back.
    marks: () => ({ still: !writing() }),
    title: () => {
      const r = shown();
      if (r == null) return "Speed: no reply yet";
      if (writing()) return `Speed: ${speedWords(r)} over the last few seconds — the model is writing`;
      return pausing() ? `Speed: this reply's average so far, ${speedWords(r)} — it isn't writing this moment` : `Speed: the last reply wrote ${speedWords(r)} on average`;
    },
    panel,
    repaint: () => painter?.(),
  };
}
