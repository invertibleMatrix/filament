// @ts-check
// Where you left off (HarnessV4_Space_Plan S1, SG-D3): the card at the top of What happened (the Space's own top until
// the reshape of 10-29) when its chats moved since your last look, or when you were away 8 h and more — made of Filament's own facts, no agent (R1): when you last looked, the
// newest lines of What happened since then that are not yours, the chats that ask you, and, after a long time away,
// where work stood. Continue in "x" opens that chat; Catch me up… fills the Start with the question and only Send asks
// it; Dismiss hides it until things move again. Your last look is this browser's, kept per project as the Space is
// left (`keepLook`). The arithmetic is lib/space-view.js `leftOff`.
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { lookWords, whenWords } from "../lib/space-view.js";

/** @param {string} project */
const lookKey = (project) => `filament.space.look.${project}`;

/** When you last looked at a project's Space in this browser; null for never. @param {string} project */
export function lastLook(project) {
  try {
    const v = Number(globalThis.localStorage?.getItem(lookKey(project)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Your look at a project's Space, kept as of a moment. @param {string} project @param {number} at */
export function keepLook(project, at) {
  try {
    globalThis.localStorage?.setItem(lookKey(project), String(at));
  } catch {}
}

/**
 * The words the Catch me up start asks, as the Start's box holds them: the Space read since your last look, and git —
 * none where the folder is no repository (`plain`: a Space of your own's, the reviewer of 10-29).
 * @param {string} since  the moment, as the space tool takes it ("2026-10-23 19:40") @param {boolean} [plain]
 */
export const catchUpWords = (since, plain = false) =>
  `${plain ? "Catch me up on this Space. Read it" : "Catch me up on this project. Read its Space"} with your space tool — the board, and What happened since ${since}${plain ? " —." : " — and each lane's git status."} In five lines: what was done, what changed, what failed or waits for me, and what comes next. Plain words; name a file or a command only where it matters.`;

/** A moment as the space tool takes it. @param {number} ms */
export function toolMoment(ms) {
  const d = new Date(ms);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * What the card does. `nameOf`: a chat by its name; `openChat`: Continue; `catchUp`: Catch me up… with your last look;
 * `dismiss`: Dismiss, your look kept as of now.
 * @typedef {{ nameOf: (chain: string) => string, openChat: (chain: string) => void, catchUp: (since: number) => void,
 *   dismiss: () => void, now?: () => number }} LeftOffCtx
 */

/** @param {LeftOffCtx} ctx */
export function leftOffCard(ctx) {
  const now = ctx.now || Date.now;
  const el = h("section", { class: "sp-left", "aria-label": "Where you left off", hidden: "" });
  return {
    el,
    /** @param {ReturnType<typeof import("../lib/space-view.js").leftOff>} c */
    paint(c) {
      el.hidden = !c;
      if (!c) return el.replaceChildren();
      const go = c.go;
      /** A line of What happened, as the card says it: an agent's after its chat's name, another machine's after that machine's. @param {import("../lib/space-view.js").SpaceEntry} e */
      const line = (e) => (e.by.kind === "agent" && e.by.chain ? `${e.by.name || ctx.nameOf(e.by.chain)}: ${e.text}` : e.by.kind === "machine" ? `${e.by.name || "Another machine"}: ${e.text}` : e.text);
      // In place: its words name the minute, so it is drawn each minute, and its buttons made anew stood under a resting
      // pointer (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
      morphChildren(el, [
        h("span", { class: "sp-left-ic", html: ICONS.history }),
        h("div", { class: "sp-left-words" },
          h("div", { class: "sp-left-head" }, h("b", {}, "Where you left off"), h("span", { class: "sp-quiet" }, ` · ${lookWords(c.last, now())}`)),
          ...(c.lines.length
            ? [h("ul", { class: "sp-left-lines" }, ...c.lines.map((e) => h("li", { title: e.text }, h("span", { class: "sp-left-at" }, whenWords(e.at, now())), h("span", { class: "sp-left-t" }, line(e)))))]
            : []),
          ...(c.more > 0 ? [h("p", { class: "sp-quiet sp-left-more" }, `and ${c.more} more below`)] : []),
          ...c.asks.slice(0, 2).map((a) => h("p", { class: "sp-left-ask" }, h("b", {}, `“${a.name}”`), ` ${a.fact}`)),
          ...(c.stood ? [h("p", { class: "sp-left-stood" }, "Last at work: ", h("b", {}, `“${c.stood.name}”`), ` in ${c.stood.chip}: ${c.stood.facts}`)] : [])),
        h("div", { class: "sp-left-acts" },
          ...(go ? [h("button", { class: "sm primary sp-left-go", type: "button", "data-key": "go", title: "Opens the chat; nothing is sent", onclick: () => ctx.openChat(go) }, `Continue in “${ctx.nameOf(go)}”`)] : []),
          h("button", { class: "ghost sm sp-left-catch", type: "button", "data-key": "catch", title: "The Start here, the question in its box: nothing is asked until you send", onclick: () => ctx.catchUp(c.last) }, "Catch me up…"),
          h("button", { class: "ghost sm sp-left-x", type: "button", "data-key": "x", onclick: () => { el.hidden = true; ctx.dismiss(); } }, "Dismiss")),
      ]);
    },
  };
}
