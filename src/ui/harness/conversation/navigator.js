// @ts-check
// The query-map rail: one tick per user message, hidden until
// the pointer nears the frame's left edge, a hover preview card (query + answer), and a click that scrolls that
// turn to the top with a highlight. The rail appears once a conversation has at least two turns. It stands beside the
// transcript alone, from its top to where it ends (`place`), never down beside the composer (the owner's of 10-31).
import { h } from "../../lib/dom.js";

/** The hover mountain: peak 2.6, near 1.7, mid 1.25. */
function scaleFor(distance) {
  if (distance === 0) return 2.6;
  if (distance === 1) return 1.7;
  if (distance === 2) return 1.25;
  return 1;
}

/**
 * @param {{ onJump: (index: number) => void, previewOf: (index: number) => { query: string, answer: string } }} cb
 * @returns {{ el: HTMLElement, setCount: (n: number) => void, setActive: (i: number) => void, arm: (on: boolean) => void, place: (head: number, tail: number) => void }}
 */
export function createNavigator(cb) {
  const ticks = h("div", { class: "nav-ticks" });
  const preview = h("div", { class: "nav-preview hidden" },
    h("p", { class: "nav-q" }),
    h("p", { class: "nav-a" }));
  const el = h("nav", { class: "turn-nav hidden", "aria-label": "turn navigator" }, ticks, preview);
  /** @type {HTMLElement[]} */
  let bars = [];
  /** Each bar's tick, the button that holds it. @type {HTMLElement[]} */
  let marks = [];
  let hover = -1;
  let active = -1;

  const paint = () => {
    const focus = hover >= 0 ? hover : active;
    bars.forEach((bar, i) => {
      const d = focus < 0 ? 99 : Math.abs(i - focus);
      bar.style.transform = `scaleX(${scaleFor(d)})`;
      bar.classList.toggle("focus", hover >= 0 && i === hover);
      bar.classList.toggle("current", i === active);
    });
  };

  /** The current turn's tick in sight: a rail shorter than its ticks scrolls them, and the tick of the turn the
   *  transcript stands on is never left off its end. */
  const showActive = () => {
    const mark = marks[active];
    if (!mark) return;
    const top = mark.offsetTop;
    const bottom = top + mark.offsetHeight;
    if (top < ticks.scrollTop) ticks.scrollTop = top;
    else if (bottom > ticks.scrollTop + ticks.clientHeight) ticks.scrollTop = bottom - ticks.clientHeight;
  };

  /** @param {number} n */
  function setCount(n) {
    el.classList.toggle("hidden", n < 2);
    if (bars.length === n) return;
    bars = [];
    marks = [];
    ticks.replaceChildren();
    for (let i = 0; i < n; i++) {
      const bar = h("span", { class: "nav-bar" });
      const btn = h("button", {
        class: "nav-tick",
        type: "button",
        "aria-label": `jump to turn ${i + 1}`,
        "aria-posinset": String(i + 1),
        "aria-setsize": String(n),
      }, bar);
      btn.addEventListener("pointerenter", () => {
        hover = i;
        const p = cb.previewOf(i);
        preview.querySelector(".nav-q").textContent = p.query || "(no text)";
        preview.querySelector(".nav-a").textContent = p.answer || "…";
        preview.classList.remove("hidden");
        const top = btn.offsetTop - ticks.scrollTop;
        preview.style.top = `${Math.max(0, Math.min(top, ticks.clientHeight - 96))}px`;
        paint();
      });
      btn.addEventListener("pointerleave", () => { hover = -1; preview.classList.add("hidden"); paint(); });
      btn.addEventListener("click", () => cb.onJump(i));
      ticks.append(btn);
      bars.push(bar);
      marks.push(btn);
    }
    paint();
    showActive();
  }

  /** At each scroll of the transcript: only a move to another turn paints the rail again. @param {number} i */
  function setActive(i) {
    if (i === active) return;
    active = i;
    paint();
    showActive();
  }

  /** The rail shows only while the pointer is near the frame's left edge. @param {boolean} on */
  function arm(on) {
    el.classList.toggle("armed", on);
  }

  /**
   * Beside the transcript alone: `head` and `tail`, how far its box stands from the frame's top and foot — the bands
   * over it and the dock under it, which grows with a long draft, the steer line, a card that asks.
   * @param {number} head @param {number} tail
   */
  function place(head, tail) {
    el.style.setProperty("--head-gap", `${head}px`);
    el.style.setProperty("--tail-gap", `${tail}px`);
    showActive();
  }

  return { el, setCount, setActive, arm, place };
}
