// @ts-check
// A tagged chat's link (the owner's word of 11-02): a chat tagged in a message (`chatTag`'s `[title](chat:<id>)`) is
// drawn as its link wherever the message shows — the box you type in, your bubble, an agent's reply — the same chip,
// marked `data-chat` with its id: a press on any opens the chat, or says it is no longer kept (chat-open.js).
import { ICONS } from "./icons.js";
import { routeFor } from "./router.js";

/** What a press on a chat's link says where the chat is no longer kept. */
export const CHAT_GONE = "That chat is not available: it was deleted, or is no longer kept";

/** What a chat's link says on pointing. */
export const CHAT_LINK_TITLE = "Past chat · press to open it";

/** A chat's link on the page, as both of these draw it — not anything else marked with a chat's id. */
export const CHAT_LINK_EL = "a.ref-chip.is-chat[data-chat]";

/**
 * A chat's link as markup, its title already escaped for HTML: a reply's (md-stream.js). Its id is a chat id's letters
 * alone (`CHAT_LINK`). @param {string} titleHtml @param {string} id
 */
export const chatLinkHtml = (titleHtml, id) =>
  `<a class="ref-chip is-chat" href="${routeFor("task", { id })}" data-chat="${id}" title="${CHAT_LINK_TITLE}"><span class="ref-ic">${ICONS.messageCircle}</span>${titleHtml}</a>`;
