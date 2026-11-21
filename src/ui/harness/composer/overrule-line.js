// @ts-check
// The line over the composer while your next message overrules what saved agents answered the main agent
// (HarnessV4_Tasks E15 step 3, AG-47): whose answer, its first line, that the message goes to the main agent, and a ×
// that takes the overrule back and leaves the draft. Overrule on an answer's card sets it. The message you then send
// carries it — into the running turn, or as the next turn — and Filament tells the agent whose answer your words stand
// over. The list is the shown chat's: another chat has its own.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { listed } from "../lib/agent-cards.js";

/**
 * An answer the next message overrules: the agent and its exchange, its name, the question it answered, and the
 * answer's first line, which the line quotes.
 * @typedef {{ agentId: string, exchange: number, name: string, question: string, answer: string }} Overruling
 */

/** Answers one message overrules, at most (the server's bound). */
export const MAX_OVERRULED = 8;
/** The characters of an answer's first line the line quotes. */
const QUOTED = 90;

/**
 * The list with one more answer: the same answer once, the newest last, the oldest gone past the bound.
 * @param {readonly Overruling[]} list @param {Overruling} o @returns {Overruling[]}
 */
export function withOverruled(list, o) {
  const same = (/** @type {Overruling} */ x) => x.agentId === o.agentId && x.exchange === o.exchange;
  return [...list.filter((x) => !same(x)), o].slice(-MAX_OVERRULED);
}

/**
 * What a send carries of the list: who and which answer, with the name and the question for an agent Filament holds no
 * longer (a restart). @param {readonly Overruling[]} list
 */
export const overrulesSent = (list) => list.map((o) => ({ agentId: o.agentId, exchange: o.exchange, name: o.name, question: o.question }));

/**
 * The line's words; null with nothing overruled.
 * @param {readonly Overruling[]} list
 * @returns {{ whose: string, quote: string } | null}  `whose`: after "Overruling "; `quote`: one answer's first line
 */
export function overruleWords(list) {
  if (!list.length) return null;
  if (list.length === 1) {
    const said = String(list[0].answer || "").trim();
    return { whose: `${list[0].name}'s answer`, quote: said.length > QUOTED ? `${said.slice(0, QUOTED - 1)}…` : said };
  }
  const names = [...new Set(list.map((o) => o.name))];
  return { whose: names.length === 1 ? `${list.length} answers of ${names[0]}` : `the answers of ${listed(names)}`, quote: "" };
}

/**
 * A message's small mark for whose answers it overrules: "overrules PM's answer".
 * @param {readonly { name?: string }[]} list
 */
export function overruleMark(list) {
  const names = [...new Set(list.map((o) => String(o?.name || "a saved agent")))];
  return names.length === 1 ? `overrules ${names[0]}'s answer${list.length > 1 ? "s" : ""}` : `overrules the answers of ${listed(names)}`;
}

/**
 * @param {{ list: () => readonly Overruling[], onClear: () => void, mk?: typeof h }} o
 *   `list`: what the shown chat's next message overrules; `onClear`: the × was pressed
 */
export function createOverruleLine({ list, onClear, mk = h }) {
  const el = mk("div", { class: "ask-line over-line hidden", role: "status", "aria-live": "polite" });
  const paint = () => {
    const w = overruleWords(list());
    if (!w) {
      el.className = "ask-line over-line hidden";
      el.replaceChildren();
      return;
    }
    el.className = "ask-line over-line";
    el.replaceChildren(
      mk("span", { class: "ask-to" }, "Overruling "),
      mk("b", { class: "ask-who" }, w.whose),
      mk("span", { class: "ask-facts" }, `${w.quote ? `: “${w.quote}”` : ""} · to the main agent`),
      mk("button", { class: "over-x", type: "button", title: "Do not overrule: your draft stays", "aria-label": "Do not overrule", html: ICONS.x, onclick: onClear }));
  };
  return { el, paint };
}
