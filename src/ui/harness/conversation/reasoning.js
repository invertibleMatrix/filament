// @ts-check
// The thinking block: brain icon, the label (Thinking in the gradient
// while it streams, Thought · Ns when it finishes), the last thinking line rolling in from the right while
// collapsed and streaming, and a plain-text body that never renders markdown. Collapsed by default once finished;
// a finished block stays as the developer left it. The Appearance "Show reasoning" switch hides the blocks.
import { h } from "../../lib/dom.js";
import { prefs } from "../prefs.js";
import { ICONS } from "../lib/icons.js";
import { lastThinkingLine } from "../lib/labels.js";

/**
 * The Appearance "Show reasoning" switch, said once on the page's root (`data-hide-reasoning`), where the stylesheet
 * hides every block but a turn's first: no block is kept to repaint. A module that held drawn blocks would hold every
 * redrawn turn's whole detached DOM with them, for the page's life.
 */
let watching = false;
const sayOnRoot = () => document.documentElement.toggleAttribute("data-hide-reasoning", !prefs.get("showReasoning"));
function watchPref() {
  if (watching) return;
  watching = true;
  sayOnRoot();
  prefs.onChange((key) => {
    if (key === "showReasoning") sayOnRoot();
  });
}

/** A few seconds / N seconds — the finished label's duration words. @param {number} ms */
function thoughtDuration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 5) return "a few seconds";
  return s === 1 ? "1 second" : `${s} seconds`;
}

/**
 * @param {{ text: string, done?: boolean, startedAt?: number, endedAt?: number }} block
 * @param {{ isFirst?: boolean }} [o]  the turn's first thinking block stays visible when Show reasoning is off
 *   ("the first item per turn remains visible") — a turn with every mark of its thinking hidden
 *   reads as if nothing happened.
 * @returns {{ el: HTMLElement, draw: () => void, finish: () => void }}
 */
export function thinkEl(block, o = {}) {
  block.startedAt ||= Date.now();
  const body = h("div", { class: "a-think-text" });
  const word = h("span", { class: "think-word" });
  const stream = h("span", { class: "think-stream hidden" });
  const summary = h("summary", {},
    h("span", { class: "think-ic", html: ICONS.brain }),
    word,
    stream,
    h("span", { class: "think-chev", html: ICONS.chevronRight }));
  const d = h("details", { class: `a-think${o.isFirst ? " is-first" : ""}` },
    summary,
    h("div", { class: "a-think-clip" }, h("div", { class: "a-think-body" }, body)));
  /** the developer opened or closed it by hand — a finished block stays as they left it */
  let held = false;

  const paint = () => {
    if (block.done) {
      word.classList.remove("gradient");
      word.replaceChildren(
        h("span", { class: "think-k" }, "Thought"),
        h("span", { class: "think-dot" }, "·"),
        h("span", {}, thoughtDuration((block.endedAt || Date.now()) - (block.startedAt || Date.now()))),
      );
      stream.classList.add("hidden");
      return;
    }
    word.classList.add("gradient");
    word.textContent = "Thinking";
    const line = lastThinkingLine(block.text);
    // The rolling line shows only while collapsed — an open block shows the body instead.
    stream.classList.toggle("hidden", !line || d.open);
    if (line) stream.textContent = line;
  };

  const draw = () => {
    // Plain text, line breaks kept. Rendering markdown here would re-parse the block on every thinking token.
    body.textContent = block.text || "";
    if (!block.done) paint();
    // The newest words roll in from the right: the single line viewport rides its end while streaming.
    if (!d.open && stream.scrollWidth > stream.clientWidth) stream.scrollLeft = stream.scrollWidth;
  };

  d.addEventListener("toggle", () => { held = true; paint(); });
  watchPref();
  paint();
  draw();

  return {
    el: d,
    draw,
    finish() {
      block.done = true;
      block.endedAt ||= Date.now();
      paint();
      if (!held) d.removeAttribute("open");
    },
  };
}
