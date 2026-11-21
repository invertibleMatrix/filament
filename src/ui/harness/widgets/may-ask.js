// @ts-check
// The row "The main agent may ask" (HarnessV4_Tasks E15 step 3, AG-44): whom a chat's main agent may ask,
// by itself — the saved agents whose tags the chat's `subagents.ask` names. The Start board draws it for a chat not
// yet made, the Agents pane beside one that is. Its value is the names in a few words; its menu ticks the cards one
// by one, lists a tag whose card was deleted struck through so it can be taken off (AG-53), and ends with the way
// back to the default: the ticks on the cards in Settings › Agents. A chat's own list replaces the default, whole.
// One list of agents (HarnessV4_OneAgent_Plan OA1): each does what its card's level lets it. Builder and Reviewer carry
// no tick — the main agent has them in every chat — and a ticked copy of either says whose place it takes.
import { ICONS } from "../lib/icons.js";
import { askNamed, askAfter, mayAskWords } from "../lib/agent-cards.js";
import { row } from "./kit.js";

/** @typedef {import("../lib/agent-cards.js").AgentCard} AgentCard */

/** The row's words under its label while the list is the Library's (U13 revised: "as in Library" or "this chat's own"). */
export const MAY_ASK_SUB = "as in Library";

/**
 * @typedef {object} MayAsk
 * @property {readonly string[]} tags  the list in force, by tag
 * @property {string} sub  the words under the label: what the row is, or where its list comes from
 * @property {boolean} own  the chat holds a list of its own, so there is a default to go back to
 * @property {readonly AgentCard[]} cards  your saved agents, the shipped ones first
 * @property {readonly string[]} defaults  the tags ticked on their cards
 * @property {string} [off]  why nobody is asked whatever the list says (`mayAskOff`), in the sub-line's place
 * @property {(tags: string[]) => void} onChange  the chat's own list, written whole
 * @property {() => void} onDefault  the chat's own list dropped
 * @property {readonly string[]} [teams]  the teams it may start beside it by itself, by name (`subagents.teams`): said
 *   after the agents, so a ticked team never reads as "Nobody" (the Designer's review of 10-24)
 * @property {() => void} [onTeams]  where the teams are ticked: Library › Agents and teams
 */

/**
 * Why nobody is asked in a made chat whatever its list says, or "". A coding agent (`engine.coder`) asks through
 * Filament's agent tool, which goes with the turns this page sends: nobody is asked where another client writes them
 * (HarnessV4_Tasks E12 step 2, AG-71), and the loop's tool switches are not its to read (AG-72). Else: the chat's
 * agent tool is off. The harness runs a chat's turns on Filament's loop, which is always on (the owner's of 11-09).
 * @param {{ effective?: any, engine?: { active?: boolean, coder?: string | null } | null } | null | undefined} st  the chat's settings
 * @param {string | null} [outside]  who writes the chat's turns, when it is not this page
 */
export function mayAskOff(st, outside = null) {
  if (st?.engine?.coder) return outside ? `Nobody is asked while ${outside} writes this chat's turns: Filament's agent tool goes with the turns sent from here` : "";
  return st?.effective?.loop?.tools?.agent === false ? "Nobody is asked while the agent tool is off in this chat's tools" : "";
}

/** The menu's heading: Builder and Reviewer are the main agent's in every chat, so no tick is theirs. */
export const MAY_ASK_HEAD = "Your agents — Builder and Reviewer always";

/**
 * The menu's rows: a tick per card under one heading — but the two it always has — the deleted tags the list still
 * names, then the way back to the default.
 * @param {import("./kit.js").Mk} mk @param {MayAsk} o @returns {any[]}
 */
export function mayAskMenu(mk, o) {
  const { tags, gone } = askNamed(o.tags, o.cards);
  const usual = askNamed(o.defaults, o.cards).named.map((c) => c.name);
  /** @param {AgentCard} c */
  const tick = (c) => {
    const on = tags.includes(c.tag);
    const place = !c.shipped ? o.cards.find((x) => x.always && x.tag === c.from) : null;
    return { type: "check", label: c.name, desc: place ? `${c.goodFor} · takes ${place.name}'s place` : c.goodFor, checked: on, onClick: () => o.onChange(askAfter(tags, c.tag, !on)) };
  };
  const offered = o.cards.filter((c) => !c.always);
  const teams = o.teams || [];
  return [
    ...(offered.length ? [{ type: "label", label: MAY_ASK_HEAD }, ...offered.map(tick)] : []),
    // The teams it may send on the side: ticked on their cards, so the row says them and the menu leads there.
    ...(teams.length ? [
      { type: "label", label: "Teams it may send on the side" },
      { label: teams.join(", "), icon: "users", desc: "Ticked on their cards in Library › Agents and teams", ...(o.onTeams ? { onClick: () => o.onTeams?.() } : { disabled: true }) },
    ] : []),
    ...gone.map((t) => ({
      type: "check",
      label: mk("span", { class: "may-ask-gone" }, mk("s", {}, `@${t}`), " deleted"),
      desc: "Its card is gone, so nobody is asked under this tag: untick to take it off the list",
      checked: true,
      onClick: () => o.onChange(askAfter(tags, t, false)),
    })),
    { type: "separator" },
    {
      label: "Use the default",
      icon: "rotateCcw",
      desc: `As in Library: ${usual.length ? mayAskWords(usual) : "nobody"}`,
      disabled: !o.own,
      onClick: () => o.onDefault(),
    },
  ];
}

/**
 * @param {import("./kit.js").Mk} mk @param {MayAsk} o
 * @param {(items: any[], at: { anchor: HTMLElement, side: "bottom", align: "end", width: number }) => unknown} openMenu
 * @returns {HTMLElement}
 */
export function mayAskRow(mk, o, openMenu) {
  const { named, gone } = askNamed(o.tags, o.cards);
  const names = [...named.map((c) => c.name), ...(o.teams || []).map((n) => `${n} team`)];
  const lost = gone.length ? `${gone.map((t) => `@${t}`).join(", ")} ${gone.length === 1 ? "was" : "were"} deleted` : "";
  /** @type {HTMLElement} */
  const el = row(mk, {
    label: "Your agent may use",
    sub: o.off || [o.sub, lost].filter(Boolean).join(" · "),
    value: mk("span", { class: "may-ask-value" }, mk("span", { class: "may-ask-names" }, mayAskWords(names)), mk("span", { class: "may-ask-chev", "aria-hidden": "true", html: ICONS.chevronDown })),
    cls: `may-ask${o.off ? " is-warned" : ""}`,
    title: names.length > 2 ? names.join(", ") : "",
    chevron: false,
    onClick: () => openMenu(mayAskMenu(mk, o), { anchor: el, side: "bottom", align: "end", width: 320 }),
  });
  el.setAttribute("aria-haspopup", "menu");
  return el;
}

/** The gear's row while the chat's own Parallelize tasks is on: what the card's Always accept in this chat set. */
export const CHAT_PARALLEL = Object.freeze({
  label: "Sub-agents that change files",
  sub: "Start without asking in this chat: you chose Always accept on its card",
  back: "Ask first again",
  tip: "Take back Always accept: this chat follows Parallelize tasks in Settings › Experimental again",
});

/**
 * The row under "Your agent may use" while the chat's own Parallelize tasks is on (the owner's of 11-16: the card's
 * Always accept in this chat), with its way back.
 * @param {import("./kit.js").Mk} mk @param {{ off: () => void }} o @returns {HTMLElement}
 */
export function chatParallelRow(mk, o) {
  return row(mk, {
    label: CHAT_PARALLEL.label,
    sub: CHAT_PARALLEL.sub,
    cls: "chat-parallel",
    trailing: mk("button", { class: "inst-link", type: "button", title: CHAT_PARALLEL.tip, onclick: () => o.off() }, CHAT_PARALLEL.back),
  });
}
