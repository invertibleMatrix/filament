// @ts-check
// The conversation under a team (HarnessV3-Views VW-D8): a divider where the turns' engine changes — "Builders's lead
// took over this chat", "Your agent has this chat again" — and the lead's launches as order rows under its reply: the member's glyph, its
// seat, the task and its live state, the worker's id in the row's tip; a click brings the worker's card in the Team view. The fold keeps the calls
// themselves, for whoever opens it. And the lead's signature at the head of each reply it gives while its team is in
// charge (U13-D6, W3). The words are lib/team.js's.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { messageTimeLabel, possessive } from "../lib/labels.js";
import { STATE_WORDS, teamIcon, teamTone } from "../lib/team.js";

/**
 * The divider before the turn the engine changed at, with the turns a team's lead took over (team_v2_plan §10 O4) and
 * the time that turn began. A team's is gold, as everything in charge is.
 * @param {import("../lib/team.js").Divider} d @param {number | null | undefined} at @param {typeof h} [mk]
 */
export function engineDivider(d, at, mk = h) {
  const time = at ? messageTimeLabel(at) : "";
  const after = d.after ? `after ${d.after} ${d.after === 1 ? "turn" : "turns"}` : "";
  const facts = [after, time].filter(Boolean).join(" · ");
  return mk("div", { class: `eng-divider${d.to === "agent" ? " is-agent" : ""}`, role: "separator", "aria-label": facts ? `${d.words}, ${facts}` : d.words },
    mk("span", { class: "eng-divider-pill" },
      d.to === "team" ? mk("span", { class: "team-tile is-xs", html: ICONS[/** @type {keyof typeof ICONS} */ (teamIcon(String(d.key || "")))] || "" }) : null,
      d.words,
      facts ? mk("span", { class: "eng-divider-time" }, facts) : null));
}

/**
 * The lead's orders under its reply, one row each.
 * @param {import("../lib/team.js").OrderRow[]} orders @param {(agentId: string) => void} onOpen @param {typeof h} [mk]
 */
export function orderRowsEl(orders, onOpen, mk = h) {
  return mk("div", { class: "od-rows", role: "group", "aria-label": "The lead's orders" }, ...orders.map((o) =>
    mk("button", { class: `od-row is-${o.state}`, type: "button", title: `${o.agentId}: its card on the Agents tab`, onclick: () => onOpen(o.agentId) },
      mk("span", { class: "role-tile is-sm", html: ICONS[/** @type {keyof typeof ICONS} */ (o.icon)] || "" }),
      mk("span", { class: "od-role" }, o.word),
      mk("span", { class: "od-name" }, o.task),
      mk("span", { class: `tg-badge is-${o.state}` }, STATE_WORDS[o.state]))));
}

/**
 * The lead's signature at the head of its reply (U13-D6, W3): its team's crowned portrait, the team's name, "lead" —
 * who is talking, before a word of it is read; the footer's tag shows only on a hover. Nothing for your agent.
 * @param {any} engine  the turn's stamp @param {typeof h} [mk]
 */
export function engineSig(engine, mk = h) {
  if (engine?.kind !== "team") return null;
  const key = String(engine.team || "");
  const name = String(engine.name || key);
  return mk("div", { class: "a-sig", title: `${possessive(name)} lead answers in this chat while its team is in charge` },
    mk("span", { class: `pf s24 t-${teamTone(key)}`, "aria-hidden": "true" },
      mk("span", { class: "pf-ic", html: ICONS[/** @type {keyof typeof ICONS} */ (teamIcon(key))] || "" }),
      mk("span", { class: "pf-crown", html: ICONS.crown })),
    mk("b", { class: "a-sig-name" }, name),
    mk("span", { class: "a-sig-role" }, "· lead"));
}

/**
 * Who answered a turn, for its footer (VW-D8): a team's lead, named; nothing for your agent.
 * @param {any} engine  the turn's stamp @param {typeof h} [mk]
 */
export function engineTag(engine, mk = h) {
  if (engine?.kind !== "team") return null;
  const name = String(engine.name || engine.team || "");
  return mk("span", { class: "eng-tag", title: `Answered by the ${name} team's lead` },
    mk("span", { class: "team-tile is-xxs", html: ICONS[/** @type {keyof typeof ICONS} */ (teamIcon(String(engine.team || "")))] || "" }),
    `${possessive(name)} lead`);
}
