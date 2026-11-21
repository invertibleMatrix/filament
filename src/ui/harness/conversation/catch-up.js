// @ts-check
// Catch me up (HarnessV4_Tasks E15 step 7, AG-206 and AG-207): a quiet line over the box, offered when the session on
// screen moved while nobody looked — it was marked unread when it was opened, or a turn of it ended while the window
// was hidden. Its button opens Catch me up in the Sub Agents tab, the question to the Reviewer in the box: nothing is asked
// until you send it (a press starts no agent — the owner's word of 10-18). Sent while the main agent's cache is warm, a
// live copy of the main agent answers, on its model and effort, reading the conversation at the cache's price (the
// owner's of 11-05); else the Reviewer reads the session folded. Its five lines stand in that thread and in the chat as
// its card, opened, and the main agent hears nothing. The line goes when you send it, on its ×, and as soon as you
// type or send here: someone who writes is caught up.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";

/** The line's words. */
export const MOVED_WORDS = "This session moved while you were away";
/** What the button does, on hover. */
export const CATCH_UP_DOES = "Opens the question in the Agents tab: once you send it, a live copy of your agent — while its cache is warm — or else the Reviewer reads what happened since your last message and says it in five lines. The main agent hears nothing.";

/**
 * @param {{ onCatchUp: () => void, onDismiss: () => void, mk?: typeof h }} o
 * @returns {{ el: HTMLElement, paint: (show: boolean) => void }}  `paint`: whether the line shows
 */
export function createCatchUp({ onCatchUp, onDismiss, mk = h }) {
  // Its words end in "…", as a button's do that asks for more before anything happens.
  const go = mk("button", { class: "catch-up-go", type: "button", title: CATCH_UP_DOES, onclick: () => onCatchUp() }, "Catch me up…");
  const drop = mk("button", { class: "catch-up-x", type: "button", title: "Not now", "aria-label": "Dismiss: this session moved while you were away", html: ICONS.x, onclick: () => onDismiss() });
  const el = mk("div", { class: "catch-up hidden", role: "status" }, mk("span", { class: "catch-up-words" }, MOVED_WORDS), go, drop);
  return {
    el,
    paint(show) {
      el.classList.toggle("hidden", !show);
    },
  };
}
