// @ts-check
// The Team widget (HarnessV3-Views VW-D7): who answers, by the composer — "who answers?" is a question about what you
// write, so it is answered where you write it. Its pill, after the context ring, shows only while a team leads: the
// team's glyph on purple and its name. Its popover holds the team and who runs it — its lead, with its members
// (HarnessV4_Tasks E15 step 6, AG-174); who is at work; Back to your agent, which the app confirms on its sheet and
// which waits while the session is busy; and Open Team, the view with room for the rest. Its crew runs on the chat's
// list (U13-D14), set on the Agents tab. Choosing a team is the Team view's, where there is room to show them.
import { h, morphChildren } from "../../lib/dom.js";
import { formatWorkedFor } from "../lib/labels.js";
import { leadingSince, leadingTeam, runByLine, runByWords, teamWork, yourAsk } from "../lib/team.js";
import { actions, group, head, icon, link, row, usd } from "./kit.js";

/**
 * Who is at work, in words: the team's running workers and the graph's agents (`teamWork`: an agent on the side is the
 * Sub Agents tab's), and how many of them wait for you — a worker's question to its lead is its lead's (HarnessV3-TaskGraph-v2
 * TG2-D49).
 * @param {readonly any[]} rows
 */
export function atWorkWords(rows) {
  const live = teamWork(rows).filter((r) => r.status === "running");
  const asks = live.filter((r) => yourAsk(r.progress)).length;
  if (!live.length) return "Nobody yet";
  return [`${live.length} at work`, asks ? `${asks} ${asks === 1 ? "asks" : "ask"} you` : ""].filter(Boolean).join(" · ");
}

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @param {{ now?: () => number }} [o]  the tests' clock
 * @returns {import("./frame.js").WidgetSpec}
 */
export function teamWidget(ctx, io = {}, o = {}) {
  const mk = io.h || h;
  // The open popover is drawn again at every move of the team's agents: in place, Back to your agent the button that
  // stood under the pointer (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
  const drawIn = io.drawIn || morphChildren;
  const now = o.now || Date.now;
  const settings = () => ctx.view()?.settings || {};
  const team = () => leadingTeam(settings().engine);
  /** @type {null | (() => void)} the open popover's live parts, drawn again */
  let painter = null;

  /** @param {typeof h} m @param {() => void} close */
  const panel = (m, close) => {
    const t = team();
    const atWork = m("span", {});
    const backBox = m("div", {});
    const foot = m("span", { class: "inst-foot-note" });
    painter = () => {
      drawIn(atWork, [atWorkWords(ctx.subagents.rows())]);
      const wait = ctx.team.wait();
      drawIn(backBox, [actions(m, [{
        label: "Back to your agent",
        title: wait || "Your own agent answers from your next message; the whole conversation stays",
        disabled: !!wait,
        onClick: () => { close(); ctx.team.back(); },
      }])]);
      const lead = team();
      const since = lead ? leadingSince(ctx.turns(), lead.key) : null;
      const spent = Number(settings().usage?.usd);
      drawIn(foot, [[since ? `Leading for ${formatWorkedFor(now() - since)}` : "Leads from your next message", Number.isFinite(spent) && spent > 0 ? `${usd(spent)} this session` : ""].filter(Boolean).join(" · ")]);
    };
    painter();
    return m("div", { class: "inst inst-team" },
      head(m, { icon: t?.icon || "users", title: t ? `${t.name} team` : "Team", sub: t ? runByLine(t) : "A lead plans the work and gives it out to its workers." }),
      group(m,
        row(m, { label: "At work", value: atWork })),
      backBox,
      m("div", { class: "inst-foot" }, foot, link(m, "Open Team", () => { close(); ctx.team.open(); })));
  };

  return {
    id: "team",
    label: "Team",
    width: 340,
    visible: () => ctx.hasSession() && !!team(),
    state: () => team()?.name || "",
    tone: () => (team()?.problem ? "warn" : ""),
    title: () => {
      const t = team();
      if (!t) return "";
      if (t.problem) return `The ${t.name} team cannot lead now: ${t.problem}. Its turns go to the model meanwhile.`;
      return `The ${t.name} team answers — ${runByWords(t).replace(/^Run/, "run")}: its lead reads your messages`;
    },
    // A worker that waits for you marks the pill, as the Team tab's dot does — not one whose question is its lead's.
    marks: () => ({ asks: teamWork(ctx.subagents.rows()).some((r) => r.status === "running" && !!yourAsk(r.progress)) }),
    // The crown and the team's name, in gold: a team in charge looks the same everywhere (team_v2_plan §10 O4).
    face: (m) => {
      const t = team();
      return t ? m("span", { class: "inst-pill-face" }, icon(m, "crown", "wt-crown"), m("span", { class: "widget-value" }, t.name)) : null;
    },
    panel,
    repaint: () => painter?.(),
  };
}
