// @ts-check
// A press on a tagged chat's link (chat-link.js), anywhere on the page — the box you type in, a bubble, a reply: the
// chat opens where it is kept; where it is not, a toast says so and the link greys (the owner's word of 11-02).
import { h } from "../../lib/dom.js";
import { api } from "./api.js";
import { ICONS } from "./icons.js";
import { routeFor } from "./router.js";
import { toast } from "./ui.js";
import { CHAT_GONE, CHAT_LINK_EL, CHAT_LINK_TITLE } from "./chat-link.js";

/**
 * A chat's link as an element, as `chatLinkHtml` draws it in a reply. @param {string} title @param {string} id
 * @param {Record<string, string>} [attrs]
 */
export const chatLinkEl = (title, id, attrs = {}) =>
  h("a", { class: "ref-chip is-chat", href: routeFor("task", { id }), "data-chat": id, title: CHAT_LINK_TITLE, ...attrs }, h("span", { class: "ref-ic", html: ICONS.messageCircle }), title);

/**
 * Open a tagged chat: where it is kept, its page; where it is not, the toast says so and its link (`el`) greys. A read
 * that fails another way opens the page, which says what it finds.
 * @param {string} id @param {Element | null} [el]
 * @param {{ read?: (path: string) => Promise<any>, say?: (msg: string, kind?: string) => void, go?: (hash: string) => void }} [o]
 */
export async function openTaggedChat(id, el = null, { read = api, say = toast, go = (hash) => void (location.hash = hash) } = {}) {
  if (el?.classList.contains("is-gone")) return void say(CHAT_GONE, "err");
  try {
    await read(`/memory/sessions/${encodeURIComponent(id)}?budget=200`);
  } catch (/** @type {any} */ err) {
    if (err?.status === 404) {
      el?.classList.add("is-gone");
      el?.setAttribute("aria-disabled", "true");
      el?.setAttribute("title", CHAT_GONE);
      return void say(CHAT_GONE, "err");
    }
  }
  go(routeFor("task", { id }));
}

/**
 * Every chat link under `root` opens its chat on a press (`openTaggedChat`): one listener for the page, heard first, so
 * no row's own press handles it; a row that carries a chat's id of its own (Import's) is its own. A press with a
 * modifier, or another button, is left to the browser.
 * @param {{ addEventListener: (type: string, fn: (e: any) => void, capture?: boolean) => void }} root
 * @param {Parameters<typeof openTaggedChat>[2]} [o]
 */
export function chatLinks(root, o = {}) {
  root.addEventListener(
    "click",
    (e) => {
      const el = e.target?.closest?.(CHAT_LINK_EL);
      if (!el || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      void openTaggedChat(String(el.getAttribute("data-chat")), el, o);
    },
    true,
  );
}
