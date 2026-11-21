// @ts-check
// The console's engine line (HarnessV3-AtHome AH-D2): above every page while memory's engine installs, what
// it is doing and where it takes its packages from, with the percent as a bar. Once an install ends well it
// says so for a few seconds, then goes. One that fails goes at once: the alerts banner says it when nobody pressed for
// it, and the panel that was pressed when someone did. The element is kept and changed in place, so the page under it
// never redraws for a percent. The page hands in `h`, so a test draws it without a browser.
import { engineProgress } from "../lib/engine.js";

/** How long the line says an install ended well. */
export const READY_MS = 6000;

/**
 * @param {{ h: any, onShown?: (shown: boolean) => void, onFailed?: () => void, later?: (fn: () => void, ms: number) => any, cancel?: (t: any) => void }} d
 *   `onShown`: the line came or went (the page puts it above itself, or takes it away). `onFailed`: an install ended
 *   without the engine (the page reads its alerts now, so the failure's alert shows as the line goes)
 */
export function engineLine({ h, onShown = () => {}, onFailed = () => {}, later = setTimeout, cancel = clearTimeout }) {
  const words = h("span", { class: "engine-line-words" });
  const fill = h("span", { class: "engine-line-fill" });
  const el = h("div", { class: "engine-line", role: "status" }, words, h("span", { class: "engine-line-bar", "aria-hidden": "true" }, fill));
  let shown = false;
  /** The state said before this one. @type {string | null} */
  let was = null;
  /** The "ended well" line's timer. @type {any} */
  let timer = null;
  const stop = () => {
    if (timer) cancel(timer);
    timer = null;
  };
  /** @param {boolean} on */
  const show = (on) => {
    if (on === shown) return;
    shown = on;
    onShown(on);
  };
  /** @param {string} text @param {number} percent */
  const say = (text, percent) => {
    words.replaceChildren(text);
    fill.style.width = `${percent}%`;
  };
  return {
    el,
    shown: () => shown,
    /** Where memory's engine stands now (`GET /api/memory/engine`, or the events feed's `engine`). @param {any} now */
    set(now) {
      const p = engineProgress(now);
      const state = now?.state ?? null;
      if (p) {
        stop();
        say(p.line, p.percent);
        el.classList.remove("is-ready");
        show(true);
      } else if (state === "ready" && was === "installing" && !now.kept) {
        stop();
        say("Memory is ready: its engine is installed.", 100);
        el.classList.add("is-ready");
        show(true);
        timer = later(() => {
          timer = null;
          show(false);
        }, READY_MS);
      } else if (!(state === "ready" && timer)) {
        // A read on reconnect that says "ready" again leaves the line saying so; anything else takes it away. An install
        // over an engine that did not go in (`kept`: the one before runs on) ends as a failure does, never as "ready".
        stop();
        show(false);
        if ((state === "missing" || now?.kept) && was === "installing") onFailed();
      }
      was = state;
    },
  };
}
