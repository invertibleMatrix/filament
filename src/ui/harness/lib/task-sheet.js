// @ts-check
// What the harness's task sheets share (HarnessV3-ACP AC3-7, AC3-8): the sign-in sheet and the install sheet each run
// a program in a terminal on a sheet, or wait for a page, and say how it ended. Here are their head, their buttons, a
// line or a code with its Copy, the same task folded away as a line for a terminal of one's own, a wait, an outcome,
// and the terminal shown — kept while its program runs and after one that failed, whose words it holds. Built with an
// injected `h`, copy and terminal view, so the sheets run on the fake DOM.
import { ICONS } from "./icons.js";

/** @typedef {import("./xterm.js").TerminalView} TerminalView */

/**
 * @param {{ h: (tag: string, attrs?: any, ...kids: any[]) => any, copy: (text: string) => Promise<void>,
 *   toast: (msg: string, kind?: string) => void, show: (el: HTMLElement, id: string, o?: any) => TerminalView }} o
 */
export function taskSheetParts({ h: m, copy: copyText, toast, show }) {
  /** @param {string} variant @param {string} label @param {() => void} onClick @param {{ disabled?: boolean }} [x] */
  const btn = (variant, label, onClick, x = {}) =>
    m("button", { class: `zc-btn zc-btn-v-${variant}`, type: "button", ...(x.disabled ? { disabled: "" } : {}), onclick: onClick }, label);
  /** @param {string} text @param {string} what */
  const copy = (text, what) => copyText(text).then(() => toast(`${what} copied`), () => toast("Copy failed", "err"));
  /** A line or a code, with its Copy. @param {string} cls @param {string} text @param {string} what */
  const copyBox = (cls, text, what) =>
    m("div", { class: cls },
      m("code", { class: "tk-copy-text" }, text),
      m("button", { class: "tk-copy", type: "button", title: `Copy ${what.toLowerCase()}`, "aria-label": `Copy ${what.toLowerCase()}`, html: ICONS.copy, onclick: () => void copy(text, what) }));
  /** The same task as a line for a terminal of the person's own, folded away under the sheet's way. @param {string} summary @param {string} line */
  const altLine = (summary, line) => m("details", { class: "tk-alt" }, m("summary", {}, summary), copyBox("tk-line", line, "The line"));
  /** @param {string} words */
  const waiting = (words) =>
    m("div", { class: "tk-wait", role: "status" }, m("span", { class: "tk-spin", "aria-hidden": "true", html: ICONS.loader }), m("span", {}, words));
  /** How a task ended: its tile, its title and a line. @param {"ok" | "stop"} tone @param {string} title @param {any} line */
  const outcome = (tone, title, line) =>
    m("div", { class: "tk-outcome" },
      m("span", { class: `tk-outcome-tile is-${tone}`, "aria-hidden": "true", html: tone === "ok" ? ICONS.check : ICONS.x }),
      m("div", { class: "tk-outcome-text" }, m("b", {}, title), line));
  /**
   * The sheet's head: its tile, its title, and the line under it (`sub`, the sheet's to fill).
   * @param {any} tile @param {string} title @param {HTMLElement} sub
   */
  const head = (tile, title, sub) => m("div", { class: "tk-head" }, tile, m("div", { class: "tk-head-text" }, m("div", { class: "tk-title" }, title), sub));

  /**
   * The terminal a task runs in, its view made once per terminal: `of` shows it, `drop` lets go of the view (the
   * terminal runs on), `shown` says whether one is held, and `focusFresh` hands a new one the keys once it is on the
   * page — the person's own hand started the task.
   */
  function terminal() {
    const box = m("div", { class: "tk-term" });
    /** @type {{ view: TerminalView | null, id: string, fresh: boolean }} */
    const t = { view: null, id: "", fresh: false };
    const drop = () => {
      t.view?.dispose();
      t.view = null;
      t.id = "";
    };
    return {
      /** @param {string} id */
      of(id) {
        if (t.id !== id) {
          drop();
          box.replaceChildren();
          t.id = id;
          t.view = show(box, id, {});
          t.fresh = true;
        }
        return box;
      },
      drop,
      shown: () => !!t.view,
      box: () => box,
      focusFresh() {
        if (t.fresh && t.view) {
          t.fresh = false;
          t.view.focus();
        }
      },
    };
  }

  return { btn, copy, copyBox, altLine, waiting, outcome, head, terminal };
}
