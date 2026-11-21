// @ts-check
// A Space's first screen (the Designer's redesign of 10-29): what the Space is for, who works in it, and three first
// steps — make an app, ask an agent here, connect an account —, while it holds no app, task or routine — nor a chat, in
// a Space of your own —, until Not now. Each card's press opens what the page's head and ⋯ open too: nothing is sent or
// written by it.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { whose } from "../lib/words.js";

/**
 * @typedef {{
 *   name: string,
 *   own: boolean,
 *   chats: number,
 *   onNewApp: () => void,
 *   onNewChat: () => void,
 *   onConnect: () => void,
 *   onLookAfter: (() => void) | null,
 *   onNotNow: () => void,
 * }} StartHere
 *   `own`: a Space of your own (its words are the person's place, not a project's); `chats`: how many chats a project
 *   has, each of which works in its Space; `onLookAfter`: What do you look after…, where the page can fill the Start
 */

/**
 * Start here, as a card of three.
 * @param {StartHere} o
 */
export function startHere(o) {
  /** @param {string} ic @param {string} title @param {string} line @param {...HTMLElement} acts */
  const card = (ic, title, line, ...acts) =>
    h("div", { class: "sp-start-card" },
      h("span", { class: "sp-start-ic", "aria-hidden": "true", html: ICONS[ic] || "" }),
      h("b", { class: "sp-start-t" }, title),
      h("p", { class: "sp-quiet sp-start-line" }, line),
      h("div", { class: "sp-start-acts" }, ...acts));
  /** @param {string} cls @param {string} label @param {() => void} press */
  const btn = (cls, label, press) => h("button", { class: cls, type: "button", onclick: () => press() }, label);
  const lead = o.own
    ? `${o.name} is a place of your own for apps, tasks and the chats that work on them. Any chat you start here can see and change what is in it; nothing runs until you say so.`
    : `${whose(o.name)} Space holds the apps its chats make, its board of tasks and What happened, the log of what they did. Every chat in ${o.name} can see and change it; nothing runs until you say so.`;
  // Who works here, and on what (the owner's first question, 10-29: "which agent do i ask"): any chat started here, on
  // any agent the Start offers — each gets the space tool, Filament's own and a coding agent alike.
  const who = o.own ? "A chat you start here" : o.chats ? `Every chat in ${o.name} — the ${o.chats === 1 ? "one" : o.chats} it has now, and each you start —` : `A chat you start in ${o.name}`;
  return h("section", { class: "sp-sec sp-start", "aria-label": "Start here" },
    h("h3", { class: "sp-start-h" }, "Start here"),
    h("p", { class: "sp-quiet sp-start-lead" }, lead),
    h("div", { class: "sp-start-grid" },
      card("layoutGrid", "Make an app",
        o.own
          ? "Say what it should do — a to-do list, a habit tracker, the feeds you read in one place —, and an agent makes it in a chat. Nothing runs until you keep it."
          : "Say what it should do — a button for each of its scripts, this week's commits, its numbers at a glance —, and an agent makes it in a chat. Nothing runs until you keep it.",
        btn("sm primary", "New app…", o.onNewApp)),
      card("messageCirclePlus", "Ask an agent here",
        `${who} works in this Space: it can add tasks, note what it did in What happened, and make or change its apps. Any agent will do — Filament's own, Claude Code, Codex…`,
        btn("ghost sm", "New chat here…", o.onNewChat)),
      card("plug", "Connect an account",
        // What Filament's list of connectors has, not what it may lack (the Designer's walk of 10-29: email and calendar
        // were promised, and found nowhere).
        "Connect an account or a service, like GitHub or Linear, and the chats here can use it. An agent can then watch it and tell you what needs you.",
        btn("ghost sm", "Connectors…", o.onConnect),
        ...(o.onLookAfter ? [btn("ghost sm", "What do you look after…", o.onLookAfter)] : []))),
    h("div", { class: "sp-start-foot" },
      // What the head above holds: a project's has New chat here… and Add to this Space…, whose first row is New app…;
      // a Space of your own's has New app… itself.
      h("span", { class: "sp-quiet" }, o.own ? "New app… and New chat here… stay at the top of this page." : "New chat here… and Add to this Space… stay at the top of this page."),
      h("span", { class: "sb-sp" }),
      h("button", { class: "ghost sm sp-start-away", type: "button", onclick: () => o.onNotNow() }, "Not now")));
}
