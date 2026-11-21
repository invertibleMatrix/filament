// @ts-check
// The browser's line over the box (the owner's of 11-02: "when a browser is being used by the chat then it should show
// an indicator above composer about it and clicking on it should open the browser where user can see a live view"):
// while the chat's agent — or one of its agents — drives the chat's browser, a quiet line says who and what it does
// there, and its button opens the Browser pane, where the page shows live. A call under way always shows it; between
// calls it stands while the chat is at work and its agents drove the browser since the chat was last seen resting,
// within DRIVE_MS (panes/browser.js, the pane's veil) — so the steps of one piece of work read as one use, never a line
// that comes and goes with each call, and a turn that never touches the browser is not said to use it. Filament tells
// the page each move on the events feed (`browser`: app/browser/registry.js `moved`; lib/browser-use.js keeps it).
// While the Browser pane is in sight beside the chat, the line says who and what without its button: the page it would
// open shows there already (the owner's of 11-05).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { DRIVE_MS } from "../panes/browser.js";

/** What the button does, on hover. */
export const WATCH_DOES = "Open the Browser pane: the page the agent works on, live";

/**
 * The chat's browser as Filament last said it: the call at work, when one last ran, whether the developer holds it,
 * whether the desktop app is there to show it, and what the newest call did and whose it was.
 * @typedef {{ busy: { words: string, at: number, by?: string } | null, droveAt: number | null, taken: boolean, available: boolean,
 *   last: { words: string, by?: string } | null }} BrowserUse
 * @typedef {{ who: string, words: string, until: number | null }} BrowserLine  `until`: when it goes unless another
 *   call comes — null while one is under way
 */

/**
 * The line while the chat's agents drive its browser, or null: never while the developer holds the browser or no app
 * is there to show it.
 * @param {BrowserUse | null | undefined} use
 * @param {boolean} working  the chat at work: its turn, or an agent of its that runs
 * @param {number} now
 * @param {number} [rested]  when the chat was last seen resting: what its agents did before counts no more
 * @returns {BrowserLine | null}
 */
export function browserLineOf(use, working, now, rested = 0) {
  if (!use || !use.available || use.taken) return null;
  const drove = Number(use.droveAt) || 0;
  if (!use.busy && !(working && drove > rested && now - drove <= DRIVE_MS)) return null;
  const said = use.busy || use.last || null;
  return {
    who: said?.by || "Your agent",
    words: String(said?.words || ""),
    until: use.busy ? null : drove + DRIVE_MS,
  };
}

/**
 * The line in the words of the header's Browser button, out of ⋯ while it stands and the pane is out of sight (the
 * owner's of 11-10: "if browser is being controlled and not opened on the right pane then show a button on top bar").
 * @param {BrowserLine} line
 */
export const usingWords = (line) => `${line.who} is using it${line.words ? `: ${line.words}` : ""}`;

/**
 * @param {{ onOpen: () => void, mk?: typeof h }} o  `onOpen`: the Browser pane opened beside the chat
 * @returns {{ el: HTMLElement, paint: (line: BrowserLine | null) => void, inSight: (on: boolean) => void }}
 */
export function createBrowserLine({ onOpen, mk = h }) {
  const who = mk("span", { class: "browser-line-who" });
  const what = mk("span", { class: "browser-line-what" });
  const go = mk("button", { class: "browser-line-go", type: "button", title: WATCH_DOES, onclick: () => onOpen() },
    mk("span", { class: "browser-line-icon", html: ICONS.globe, "aria-hidden": "true" }), "Watch live");
  const el = mk("div", { class: "browser-line hidden", role: "status" },
    mk("span", { class: "browser-line-dot", "aria-hidden": "true" }), mk("span", { class: "browser-line-words" }, who, what), go);
  /** What it says, as last painted: painted again only when that moves — it is asked at each frame of a turn. */
  let said = "";
  return {
    el,
    // Its words in place, its button the one element it was (the owner's of 11-01: buttons blinking under a resting
    // pointer, clicks lost).
    paint(line) {
      const key = line ? `${line.who}\u0000${line.words}` : "";
      if (key === said) return;
      said = key;
      el.classList.toggle("hidden", !line);
      if (!line) return;
      who.textContent = `${line.who} is using the browser`;
      what.textContent = line.words ? `: ${line.words}` : "";
      what.setAttribute("title", line.words);
    },
    /**
     * The Browser pane in front beside the chat, or not: in sight, the button goes, whatever the line says meanwhile
     * ("when the browser is opened on the right side then Watch live button chip should not be shown").
     * @param {boolean} on
     */
    inSight(on) {
      go.classList.toggle("hidden", on);
    },
  };
}
