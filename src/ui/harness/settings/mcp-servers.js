// @ts-check
// Library › Connectors (HarnessV4_Settings_Plan HS-1; Settings › MCP servers until the owner's word of 10-26), the
// connectors part of Library › Plugins & Connectors since the owner's of 11-09 (library/plugins.js): tools
// from other programs, for every engine a chat runs on — your MCP servers, and the ones your plugins bring where they
// are on. One control at the top says where a change applies (HS-D6, lib/applies-to.js) — all chats, a Space of yours
// (its chats and the projects it shows get yours and its own), or one project, whose chats get yours and its own — and
// the list under it is that place's (lib/mcp-list.js), the same part a chat's
// own settings show, here with Import from other apps beside Add (HS-6). Built with an injected `h`, `api`, menu and
// the list's own parts, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { createMcpList } from "../lib/mcp-list.js";
import { appliesTo } from "../lib/applies-to.js";

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, start?: string | null, finish?: { plugin: string, title: string } | null,
 *   openPlugin?: (id: string) => void, onRows?: (rows: any[]) => void }} [cb]
 *   `start`: "project:<id>" opens the page on that project (a Space's Connectors and Project settings), else on All
 *   chats; `finish`: a plugin just installed or turned on there, whose setup — a sign-in, a test — opens over its list;
 *   `openPlugin`, `onRows`: the list's (lib/mcp-list.js) — a plugin's sheet from its server's row, the rows as drawn
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, menu?: any, list?: Parameters<typeof createMcpList>[1] }} [io]
 * @returns {{ refresh: () => void }}  the list of the place picked, read again (a plugin turned on or off beside it)
 */
export function renderMcpServers(body, cb = {}, io = {}) {
  const m = io.h || h;
  const host = m("div", { class: "mcps-host" });
  /** The setup to open, once, on the list of the place it was turned on for. */
  let finish = cb.finish || null;
  /** The list of the place picked now. @type {ReturnType<typeof createMcpList> | null} */
  let list = null;
  const control = appliesTo({
    onToast: cb.onToast,
    onPick: (scope, place) => {
      const onAll = scope === "all";
      // A Space of yours passes these to the projects it shows (the owner's word of 10-26).
      const shows = place?.shows ? ` and in the ${place.shows === 1 ? "project" : `${place.shows} projects`} it shows` : "";
      control.say(onAll ? "Your connectors: every chat has them, unless its project or the chat itself switches one off." : place?.space ? `Chats in this Space${shows} get yours and these.` : "Chats in this project get yours and these.");
      const mine = finish && scope === (cb.start || "all") ? finish : null;
      if (mine) finish = null;
      list = createMcpList({ scope, at: onAll ? "global" : "project", onToast: cb.onToast, imports: true, pluginsPage: true, ...(mine ? { finish: mine } : {}), ...(cb.openPlugin ? { openPlugin: cb.openPlugin } : {}), ...(cb.onRows ? { onRows: cb.onRows } : {}) }, io.list);
      host.replaceChildren(list.el);
    },
  }, io);
  body.replaceChildren(control.el, host);
  control.start(/^project:/.test(String(cb.start || "")) ? String(cb.start).slice("project:".length) : null);
  return { refresh: () => void list?.refresh() };
}
