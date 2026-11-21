// @ts-check
// The crafter's line over the box (the owner's yes of 10-27): in a crafter chat, the skill it crafts and the way back to
// the chat `/craft` was typed in; in that chat, the crafters opened from it while they work or wait for the person — a
// press opens one. Its buttons only open chats: nothing runs from it. What it says comes from the sessions list
// (lib/craft.js `craftLineOf`).
import { h } from "../../lib/dom.js";
import { craftLineWords } from "../lib/craft.js";

/** At most this many crafters get a button of their own on a chat's line. */
const BUTTONS = 3;

/**
 * @param {{ onOpen: (id: string) => void, mk?: typeof h }} o
 * @returns {{ el: HTMLElement, paint: (line: import("../lib/craft.js").CraftLine | null) => void }}
 */
export function createCrafterLine({ onOpen, mk = h }) {
  const words = mk("span", { class: "crafter-line-words" });
  const go = mk("span", { class: "crafter-line-go" });
  const el = mk("div", { class: "crafter-line hidden", role: "status" }, words, go);
  /** @param {string} id @param {string} label @param {string} title */
  const btn = (id, label, title) => mk("button", { class: "crafter-line-btn", type: "button", title, onclick: () => onOpen(id) }, label);
  /** What its buttons stand for, as last drawn: drawn again only when that moves. */
  let drawn = "";
  return {
    el,
    paint(line) {
      el.classList.toggle("hidden", !line);
      if (!line) return;
      words.textContent = craftLineWords(line);
      // Painted at every view of the chat: its buttons only as what they open moves, so the one under a resting
      // pointer stays the element it was (the owner's of 11-01: buttons blinking, clicks lost).
      const key = JSON.stringify(line.kind === "crafter" ? [line.kind, line.from || null] : [line.kind, line.crafters.map((c) => [c.id, c.skill || "", c.title])]);
      if (key === drawn) return;
      drawn = key;
      if (line.kind === "crafter") {
        go.replaceChildren(...(line.from ? [btn(line.from.id, `“${line.from.title}”`, "Open the chat /craft was typed in")] : []));
        return;
      }
      const [one, ...more] = line.crafters;
      go.replaceChildren(...(more.length
        ? line.crafters.slice(0, BUTTONS).map((c) => btn(c.id, c.skill || c.title, `Open ${c.title}`))
        : [btn(one.id, "Open", `Open ${one.title}: watch it craft, and steer it`)]));
    },
  };
}
