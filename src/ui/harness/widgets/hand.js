// @ts-check
// Hand it to a team (proposal_ux R4, Phase 5): the teams a chat can be handed to, each with its lead and members and
// Put in charge…, ending with New team — on Overview's "Who runs this chat" sheet, where who runs the chat is
// answered. While a team leads, the sheet's cards switch to another. A press on Put in charge… opens the team's Brief
// (views/brief.js, team_v2_plan §10 O1), In charge: your first words to its lead, what it reads and costs; its Send
// hands over — once a running turn ends, where one runs. The lead answers your words. A team that changes no file
// says on its card what the server holds the chat to while it leads (lib/team.js `readsOnlyAhead`).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { leadsWords, memberIcon, readsOnly, readsOnlyAhead, teamOf } from "../lib/team.js";
import { possessive } from "../lib/labels.js";

/**
 * @typedef {{ team: import("../lib/team.js").Leading | null, teams: readonly any[], wait: string | null,
 *   lead: (team: import("../lib/team.js").Leading) => void, newTeam: () => void }} HandIO
 *   `team`: the team that leads now, or null; `teams`: the session's teams as its engine lists them; `wait`: why a
 *   switch must wait now, else null; `lead`: a switch, which the app confirms; `newTeam`: Settings › Agents, on a new
 *   team's editor
 */

/**
 * The section: its head, a card per team, New team.
 * @param {HandIO} o @param {typeof h} [mk]  the page's `h`; the tests' fake DOM
 */
export function handSection(o, mk = h) {
  /** @param {string} name @param {string} cls */
  const glyph = (name, cls) => mk("span", { class: cls, html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  const { team, wait } = o;
  return mk("section", { class: "tv-section hand" },
    mk("div", { class: "hand-head" },
      glyph(team ? "repeat" : "users", "team-tile hand-tile"),
      mk("div", {},
        mk("h3", { class: "tv-h is-big" }, team ? "Switch team" : "Hand it to a team"),
        mk("p", { class: "hand-line" }, team
          ? "Another team's lead takes over from your next message. The whole conversation carries over."
          : "A lead plans the work and gives it out to its workers; one that changes files works in its own worktree. Its orders go out at once."))),
    mk("div", { class: "hand-grid" }, ...o.teams.map((x) => {
      const on = team?.key === x.key;
      const other = teamOf(x, String(x.key));
      const btn = on ? mk("span", { class: "hand-on" }, glyph("check", "inst-ic"), "Leading") : mk("button", {
        class: "inst-btn",
        type: "button",
        title: wait || `Open the ${possessive(other.name)} Brief, In charge: your first words to its lead; Send hands this chat over`,
        ...(wait ? { disabled: "", "aria-disabled": "true" } : {}),
        onclick: () => { if (!wait) o.lead(other); },
      }, "Put in charge…");
      return mk("section", { class: `hand-card${on ? " is-on" : ""}`, "aria-label": `${other.name} team` },
        mk("div", { class: "hand-card-top" }, glyph(other.icon, "team-tile hand-card-tile"), mk("div", { class: "hand-card-name" }, other.name)),
        other.line ? mk("p", { class: "hand-card-line" }, other.line) : null,
        mk("p", { class: "hand-card-who" }, leadsWords(other)),
        // A team that changes no file says what In charge means for it over the press (d-side, 11-12).
        readsOnly(x) ? mk("p", { class: "hand-card-who hand-card-reads" }, readsOnlyAhead(other.name)) : null,
        mk("div", { class: "hand-card-foot" },
          mk("span", { class: "hand-roles", "aria-hidden": "true" }, ...other.members.map((m) => mk("span", { class: "hand-role", title: m.name, html: ICONS[/** @type {keyof typeof ICONS} */ (memberIcon(m))] || "" }))),
          btn));
    }),
    mk("button", { class: "hand-card hand-new", type: "button", title: "Make a team of your own in Library › Agents and teams", onclick: () => o.newTeam() },
      mk("div", { class: "hand-card-top" }, glyph("plus", "team-tile hand-card-tile"), mk("div", { class: "hand-card-name" }, "New team")),
      mk("p", { class: "hand-card-line" }, "A lead of your own in charge, and the workers it hands work to."))));
}
