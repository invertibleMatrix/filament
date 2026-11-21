// @ts-check
// The envelopes' line over the box (the owner's of 11-02: "when an agent receives an envelope it should also show some
// indicator that an unread envelope is there and as soon as an agent opens it then this indicator should simply
// disappear. this way users can know if an agent somehow might have missed opening an envelope"): while another agent's
// result waits sealed for the chat's agent (HarnessV4_Envelopes_Plan), a quiet line says how many and whose the oldest
// is — each one's sender and subject on hover — and it goes as the agent opens them. What it says comes from the session's
// sealed list (lib/subagents.js `envelopes`), which Filament says again at each seal and each opening.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { envelopeFrom } from "../lib/labels.js";

/** @typedef {import("../lib/subagents.js").SealedEnvelope} SealedEnvelope */
/** @typedef {{ words: string, title: string }} EnvelopeLine */

/** Whose an envelope is, in a few words: a letter by its sender — another chat, or the fork that weighed your message —
 *  else what its agent was asked, else who sent it. @param {SealedEnvelope} e */
const fromWords = (e) => (e.via === "chat" || e.via === "steer" ? envelopeFrom(e) : e.description ? `“${e.description}”` : e.sender || e.from || "another agent");

/**
 * The line while envelopes wait sealed for the chat's agent, or null with none.
 * @param {readonly SealedEnvelope[]} list  oldest first
 * @returns {EnvelopeLine | null}
 */
export function envelopeLineOf(list) {
  if (!list.length) return null;
  const [oldest] = list;
  const words = list.length === 1
    ? `An envelope waits unopened for your agent, from ${fromWords(oldest)}`
    : `${list.length} envelopes wait unopened for your agent, the oldest from ${fromWords(oldest)}`;
  const title = list.map((e) => `Envelope ${e.n}, from ${e.sender || e.from}: ${e.subject}`).join("\n");
  return { words, title };
}

/**
 * @param {{ mk?: typeof h }} [o]
 * @returns {{ el: HTMLElement, paint: (line: EnvelopeLine | null) => void }}
 */
export function createEnvelopeLine({ mk = h } = {}) {
  const words = mk("span", { class: "envelope-line-words" });
  const el = mk("div", { class: "envelope-line hidden", role: "status" }, mk("span", { class: "envelope-line-icon", html: ICONS.mail, "aria-hidden": "true" }), words);
  return {
    el,
    paint(line) {
      el.classList.toggle("hidden", !line);
      if (!line) return;
      words.textContent = line.words;
      el.setAttribute("title", line.title);
    },
  };
}
