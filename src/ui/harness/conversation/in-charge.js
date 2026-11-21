// @ts-check
// A team in charge, visible (team_v2_plan §10 O4; HarnessV4_Tasks U13 W3, mock-v3-chat): while a team's lead runs the
// chat, a band stands at the top of it, over every tab — the team's crowned portrait, "Builders is running this chat
// · its workers are on the Agents tab" (which opens the team there), and Back to your agent, which the host confirms on its
// sheet. A switch that must wait (lib/team.js's switchWait: a turn running, a question waiting, workers at work) leaves
// Back to your agent standing, greyed, its reason on its tip. Nothing shows while your agent leads; the Agents tab's
// pane of the team in charge says it all itself, so the band gives way there (side.css). A team's own chat keeps its
// team: there the band names it, with no Back to your agent.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { leadingTeam } from "../lib/team.js";
import { leadLook } from "../lib/brief.js";

/**
 * @typedef {{ open: () => void, back: () => void, wait: (chat: any) => string | null, own?: (chat: any) => boolean }} ChargeIO
 *   `open`: the Agents tab on the team in charge; `back`: Back to your agent, through the host's sheet; `wait`: why a
 *   switch must wait now; `own`: the chat is a team's own, beside its main chat
 */

/**
 * @param {ChargeIO} io @param {{ h?: typeof h }} [o]  the tests' fake DOM
 * @returns {{ el: any, paint: (chat: any) => void }}
 */
export function createChargeBand(io, o = {}) {
  const mk = o.h || h;
  /** @param {string} name @param {string} cls */
  const glyph = (name, cls) => mk("span", { class: cls, "aria-hidden": "true", html: /** @type {any} */ (ICONS)[name] || "" });
  const face = mk("span", { class: "pf s24 ich-face", "aria-hidden": "true" });
  const who = mk("b", { class: "ich-who" });
  const crew = mk("button", { class: "ich-crew", type: "button", onclick: () => io.open() }, "its workers are on the Agents tab");
  const words = mk("span", { class: "ich-words" }, who, mk("span", { class: "ich-dot", "aria-hidden": "true" }, "·"), crew);
  /** Why Back to your agent waits now, else null. @type {string | null} */
  let wait = null;
  /** The team whose face the band wears: drawn again only when another leads. */
  let faceOf = "";
  const back = mk("button", { class: "inst-btn ich-back", type: "button", onclick: () => { if (!wait) io.back(); } }, glyph("arrowLeft", "inst-ic"), "Back to your agent");
  const el = mk("div", { class: "ich-band hidden", role: "region", "aria-label": "Who runs this chat" }, face, words, mk("span", { class: "ich-sp" }), back);
  return {
    el,
    paint(chat) {
      const team = chat?.chainId ? leadingTeam(chat?.view?.settings?.engine) : null;
      el.classList.toggle("hidden", !team);
      if (!team) return;
      // Painted at every view of the chat: its face only as another team leads, so the band under a resting pointer
      // keeps its elements (the owner's of 11-01: buttons blinking, clicks lost).
      if (faceOf !== team.key) {
        faceOf = team.key;
        const look = leadLook(team.key);
        face.setAttribute("class", `pf s24 t-${look.tone} ich-face`);
        face.replaceChildren(glyph(look.icon, "pf-ic"), glyph("crown", "pf-crown"));
      }
      el.classList.toggle("is-problem", !!team.problem);
      who.replaceChildren(team.problem ? `${team.name} cannot run this chat now` : `${team.name} is running this chat`);
      who.setAttribute("title", team.problem
        ? `${team.problem[0].toUpperCase()}${team.problem.slice(1)}: its turns go to the model meanwhile`
        : `${team.lead.name} answers your messages${team.members.length ? `, ${team.members.map((m) => m.name).join(", ")} under it` : ""}`);
      crew.setAttribute("title", "The team in charge on the Agents tab: its lead, its workers at work, its plan");
      const own = !!io.own?.(chat);
      back.classList.toggle("hidden", own);
      wait = io.wait(chat);
      back.toggleAttribute("disabled", !!wait);
      back.setAttribute("aria-disabled", wait ? "true" : "false");
      back.setAttribute("title", wait || "Your own agent answers from your next message; the whole conversation stays");
    },
  };
}
