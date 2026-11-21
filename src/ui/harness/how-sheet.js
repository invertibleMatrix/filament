// @ts-check
// How earlier turns are kept (proposal_ux §4.12 step 4, phase 3): the one sheet for how a chat makes room, opened from
// the context ring's popover and the Context pane. Its level control picks whose settings it shows, as every sheet's
// does (§4.16): This chat — the session's own, panes/context-how.js's section over the session — and All new chats —
// your defaults, the same section Settings › How earlier turns are kept draws. A project holds none of these, so it is
// no level here. Each level writes through its own writer; the sheet itself holds
// no setting. The section open for a chat is the one the host draws again when the session moves (`repaintContextHow`).
import { h } from "../lib/dom.js";
import { sheet, pills } from "./lib/ui.js";
import { ICONS } from "./lib/icons.js";
import { howSection } from "./panes/context-how.js";
import { mountContext } from "./settings/context.js";

/** The sheet's title, as the popover's link, the Context pane's row and Settings name it. */
export const HOW_TITLE = "How earlier turns are kept";

/** A level of the sheet: this chat, or every new chat. @typedef {"chat" | "yours"} HowLevel */

/** The chat's section on screen, so the host can draw it again when the session moves. @type {{ el: any, repaint: (force?: boolean) => void } | null} */
let shown = null;

/**
 * The session view moved — or, `force`, a compaction landed or was undone, which moves neither the settings nor the
 * turns: the chat's section on screen draws again where what it shows has moved.
 * @param {boolean} [force]
 */
export function repaintContextHow(force = false) {
  shown?.repaint(force);
}

/** What each level is, in one line under the control. */
const LEVEL_WORDS = Object.freeze({
  chat: "This chat follows your defaults. A row you change here says so, with Use yours to follow them again.",
  yours: "Every chat that has not chosen its own.",
});

/**
 * The levels a sheet offers: This chat where there is a session, and All new chats always.
 * @param {{ chat: boolean }} o
 * @returns {{ id: HowLevel, label: string, title: string }[]}
 */
export function howLevels({ chat }) {
  return [
    ...(chat ? [{ id: /** @type {const} */ ("chat"), label: "This chat", title: "This chat's own settings" }] : []),
    { id: /** @type {const} */ ("yours"), label: "All new chats", title: "Your defaults: every chat that has not chosen its own" },
  ];
}

/**
 * Open the sheet. `how`: the widgets' context of the open chat, which its section reads and writes through (null with no
 * session); `chainId`: its session; `level`: the level it opens on — the first it offers otherwise.
 * @param {{ how: import("./widgets/registry.js").WidgetContext | null, chainId: string | null,
 *   models: () => any[], onToast: (msg: string, kind?: string) => void, onChanged?: () => void, level?: HowLevel }} o
 */
export function openHowSheet(o) {
  const levels = howLevels({ chat: !!(o.how && o.chainId) });
  /** @type {HowLevel} */
  let level = levels.find((l) => l.id === o.level)?.id || levels[0].id;
  const say = h("p", { class: "how-sheet-say" });
  const box = h("div", { class: "how-sheet-box" });
  const cb = { onToast: o.onToast, ...(o.onChanged ? { onChanged: o.onChanged } : {}) };
  const draw = () => {
    shown = null;
    say.replaceChildren(LEVEL_WORDS[level]);
    if (level === "chat" && o.how && o.chainId) {
      shown = howSection(o.how, { key: String(o.chainId) });
      box.replaceChildren(shown.el);
    } else mountContext(box, cb, { models: o.models });
  };
  const control = levels.length > 1 ? pills(levels, { active: level, onChange: (id) => { level = /** @type {HowLevel} */ (id); draw(); } }) : null;
  // The level control beside the title, as every sheet's (§4.16).
  const head = h("div", { class: "how-sheet-head" },
    h("span", { class: "how-sheet-ic", html: ICONS.history }),
    h("h2", { class: "how-sheet-title" }, HOW_TITLE),
    control ? h("div", { class: "how-sheet-levels" }, control.el) : null);
  const s = sheet({
    label: HOW_TITLE,
    head,
    body: h("div", { class: "how-sheet-body" }, say, box),
    class: "how-sheet",
    onClose: () => { shown = null; },
  });
  draw();
  return s;
}
