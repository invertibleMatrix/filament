// @ts-check
// An agent's thread beside the chat (proposal_ux §4.7, Phase 5): one sub-agent's conversation in a tile of its own — the
// part the Sub Agents tab draws (subagent-viewer.js): its head, what it was shown, each question and its work as it
// streams, the changes it made with Apply, and its box; a coding agent's own is a thread to read. A thread opens here
// from Open beside — a Watch all tile, an answer's card in the chat — and where a saved agent you asked answers while the
// window has room (app.js `openSubagent`). Its tab is the chat's (tiles.js items): another chat shows its own. The head
// of the tile holds the way to the same thread in the Sub Agents tab. It took the Agents pane's place; that pane's rows —
// whom the main agent may ask, who runs on what — are in the Agents tab's gear now.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { guestOf } from "../lib/guest-thread.js";
import { guestConversation, subagentConversation } from "../subagent-viewer.js";

/**
 * Draw an agent's thread into a tile's body.
 * @param {HTMLElement} body  the tile's body
 * @param {{ chainId: string, id: string, toast: (msg: string, kind?: string) => void, main: import("../subagent-viewer.js").MainDoor,
 *   held?: import("../lib/held-asks.js").HeldAsks | null, onAskSelf?: ((tag: string) => void) | null,
 *   head?: HTMLElement | null, onOpen?: () => void,
 *   answer?: ((id: string, a: import("../conversation/interaction.js").PermissionAnswer) => Promise<boolean>) | null, always?: ((id: string, offer: any) => Promise<boolean>) | null,
 *   conversation?: typeof subagentConversation, guest?: typeof guestConversation }} o
 *   `head`: the tile's place for its own controls; `onOpen`: the thread in the Sub Agents tab; `answer`, `always`: a
 *   call of its that waits for you, answered in its foot; `conversation` and `guest`: the tests' seams
 * @returns {{ close: () => void, focusFollowUp: () => void }}  `close` lets go of what the thread follows
 */
export function renderThreadPane(body, o) {
  const conversation = o.conversation || subagentConversation;
  const guest = o.guest || guestConversation;
  const conv = guestOf(o.id)
    ? guest({ id: o.id, toast: o.toast })
    : conversation({ chainId: o.chainId, id: o.id, toast: o.toast, main: o.main, held: o.held || null, onAskSelf: o.onAskSelf || null, answer: o.answer || null, always: o.always || null });
  const scroller = h("div", { class: "thp-scroll" }, conv.body);
  const root = h("div", { class: "thp", "data-thread": o.id }, h("div", { class: "thp-head" }, conv.head), scroller, conv.foot);
  body.replaceChildren(root);
  if (o.head && o.onOpen) {
    const open = o.onOpen;
    o.head.replaceChildren(h("button", { class: "tile-btn thp-open", type: "button", title: "This thread in the Agents tab", "aria-label": "Open in Agents", html: ICONS.botMessageSquare, onclick: () => open() }));
  }
  conv.mount(scroller);
  return {
    close: () => conv.close(),
    focusFollowUp: () => ("focusFollowUp" in conv && typeof conv.focusFollowUp === "function" ? conv.focusFollowUp() : undefined),
  };
}

/**
 * A thread's tile made once the agents' list is its chat's (the Sub Agents tab waits likewise, side.js `paintThread`):
 * a tile the chat's layout brings back while the chat still opens, or while the list is still the chat left's — the
 * tiles are drawn before the list takes the chat's chain (app.js `selectChat`, `refreshStatus`) —, made at once, read
 * its agent under another chat's chain, was told it is gone and was never made again. Until then it says Loading, as a
 * thread's own first state does. A coding agent's own needs no chat.
 * @template {{ close: () => void }} P
 * @param {HTMLElement} body  the tile's body
 * @param {{ id: string, mine: () => boolean, onChange: (fn: () => void) => () => void, make: () => P }} o
 *   `mine`: whether the list is the open chat's now, asked at each change; `onChange`: the list's changes, its return
 *   the unsubscribe; `make`: the thread's pane
 * @returns {{ close: () => void }}  lets go of the pane once made, else of the wait
 */
export function threadOnceListed(body, o) {
  /** @type {P | null} */
  let pane = null;
  /** @type {(() => void) | null} */
  let off = null;
  if (guestOf(o.id) || o.mine()) pane = o.make();
  else {
    body.replaceChildren(h("div", { class: "sav-loading gradient" }, "Loading"));
    off = o.onChange(() => {
      if (pane || !o.mine()) return;
      off?.();
      off = null;
      pane = o.make();
    });
  }
  return {
    close: () => {
      off?.();
      off = null;
      pane?.close();
    },
  };
}
