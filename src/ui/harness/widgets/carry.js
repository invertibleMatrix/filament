// @ts-check
// "Carry earlier turns as" (HarnessV4_Tasks U3-7, UX-12): the one control of the flows that carry a chat — a fork
// (`fork.transcript`) and a fresh coding-agent session's start (`context.carry`). Each flow keeps its own stored
// values; the label, the names and the lines are the shared words' (lib/context-words.js), and the control is drawn
// once: a radiogroup of capsules under its label, the chosen one's line under them.
import { CARRY_LABEL } from "../../lib/context-words.js";

export { CARRY_LABEL };

/** @typedef {{ readonly id: string, readonly name: string, readonly line: string }} CarryOption */

/** The columns the capsules stand in: up to four in one row, more in even rows of three (six across would clip the
 *  names in a panel's width). @param {number} n */
export const carryCols = (n) => (n <= 4 ? Math.max(1, n) : 3);

/**
 * Where an arrow key moves the choice among the ones choosable now, the ends wrapping. From one that is not among them
 * (a choice that cannot be taken any more) it steps as if from the list's end: right to the first, left to the last.
 * @param {readonly string[]} ids @param {string} current @param {number} step  1 or -1
 */
export function carryStep(ids, current, step) {
  if (!ids.length) return current;
  const found = ids.indexOf(current);
  const at = found >= 0 ? found : step > 0 ? -1 : ids.length;
  return ids[(at + step + ids.length) % ids.length];
}

/** A line as a sentence: its first letter raised, a full stop where it ends without one. @param {string} s */
const sentence = (s) => {
  const t = String(s || "").trim();
  return t ? `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : "";
};

/**
 * The control. `off(id)` says why a choice cannot be taken now (it is drawn disabled, the reason its hint, and the
 * arrows step over it); `lineOf(option)` is the sentence under the capsules for the one chosen, the option's own line
 * unless given; `figures` leaves room under each name for a figure `fig(id, text)` fills as it arrives (a view's size).
 * `onChange` hears a choice that differs from the one in force; `paint()` draws the choice in force again. `bare`: the
 * label is not drawn — the row the control opens under already says it — and stays the group's name.
 * @param {(tag: string, attrs?: any, ...kids: any[]) => any} mk
 * @param {{ options: readonly CarryOption[], value: () => string, onChange: (id: string) => void,
 *   off?: (id: string) => string | null | false | undefined, lineOf?: (o: CarryOption) => string, figures?: boolean, label?: string, bare?: boolean }} o
 * @returns {{ el: any, group: any, line: any, paint: () => void, fig: (id: string, text: string) => void }}
 */
export function carryControl(mk, o) {
  const label = o.label || CARRY_LABEL;
  const why = (/** @type {string} */ id) => o.off?.(id) || null;
  /** @type {Map<string, any>} */
  const btns = new Map();
  /** @type {Map<string, any>} */
  const figs = new Map();
  const line = mk("div", { class: "carry-line" });
  const pick = (/** @type {string} */ id) => {
    if (id === o.value() || why(id)) return;
    o.onChange(id);
    paint();
  };
  const group = mk("div", {
    class: "carry-segs",
    role: "radiogroup",
    "aria-label": label,
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      // A radiogroup is one Tab stop: the arrows move the choice, and the focus with it.
      const next = carryStep(o.options.map((x) => x.id).filter((id) => !why(id)), o.value(), step);
      pick(next);
      btns.get(next)?.focus?.();
    },
  }, ...o.options.map((opt) => {
    const fig = o.figures ? mk("span", { class: "carry-seg-fig" }) : null;
    if (fig) figs.set(opt.id, fig);
    const b = mk("button", { class: "carry-seg", type: "button", role: "radio", "data-carry": opt.id, onclick: () => pick(opt.id) },
      mk("span", { class: "carry-seg-name" }, opt.name), fig);
    btns.set(opt.id, b);
    return b;
  }));
  group.style.setProperty("--carry-cols", String(carryCols(o.options.length)));
  const paint = () => {
    const v = o.value();
    for (const opt of o.options) {
      const b = btns.get(opt.id);
      const on = opt.id === v;
      const reason = why(opt.id);
      b.classList.toggle("is-on", on);
      b.toggleAttribute("disabled", !!reason && !on);
      b.setAttribute("title", reason || opt.line);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    }
    const chosen = o.options.find((x) => x.id === v);
    line.replaceChildren(chosen ? (o.lineOf ? o.lineOf(chosen) : sentence(chosen.line)) : "");
  };
  paint();
  return {
    el: mk("div", { class: "carry" }, o.bare ? null : mk("span", { class: "carry-label" }, label), group, line),
    group,
    line,
    paint,
    fig: (id, text) => figs.get(id)?.replaceChildren(text),
  };
}
