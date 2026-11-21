// @ts-check
// Memory for other agents (HarnessV3-Memory M7-D46), Settings › Connect other apps' part (HarnessV4_Settings_Plan
// HS-4; Settings › Memory links there since the owner's of 11-09): the command that adds memory's door to Claude Code,
// and what any other client needs. The key is named, never shown.
import { h } from "../../lib/dom.js";
import { ICONS } from "./icons.js";

/**
 * The part's words and its control; each page sets them in its own row.
 * @param {typeof h} m @param {{ path: string, keyed: boolean }} door  `GET /api/memory/mcp`
 * @param {{ origin: string, copy: (text: string) => Promise<void>, toast: (msg: string, kind?: string) => void }} o
 *   `origin`: where this page is served, which an agent on this machine reaches Filament at
 * @returns {{ label: string, desc: string, control: any }}
 */
export function memoryDoor(m, door, o) {
  const url = `${o.origin}${door.path}`;
  const header = "Authorization: Bearer <your inbound key>";
  const command = `claude mcp add --scope user --transport http filament-memory ${url}${door.keyed ? ` --header "${header}"` : ""}`;
  const copyBtn = m("button", {
    class: "mset-act",
    type: "button",
    title: "Copy the command",
    "aria-label": "Copy the command",
    html: ICONS.copy,
    onclick: () =>
      o.copy(command).then(
        () => o.toast("Copied: run it in a terminal, then fill in your key"),
        () => o.toast("Copy failed: select the command instead", "err"),
      ),
  });
  return {
    label: "Other agents",
    desc: `Claude Code, Cursor or any agent that speaks MCP shares this memory: what it learns, every session here knows, and the other way round. Add it once with this command.${door.keyed ? " The key is one of your inbound keys; it is not shown here." : " No inbound key is set, so only programs on this machine reach it."}`,
    control: m("div", { class: "mset-mcp" },
      m("div", { class: "mset-mcp-line" }, m("code", { class: "mset-mcp-cmd" }, command), copyBtn),
      m("p", { class: "mset-quiet" }, `Another client: ${url}, over Streamable HTTP${door.keyed ? `, with the header ${header}` : ""}.`)),
  };
}
