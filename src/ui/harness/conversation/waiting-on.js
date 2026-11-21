// @ts-check
// The line after a chat's last turn while its work goes on without a turn (the owner's of 10-29: "it has become a
// really confusion for me thinking if agent has finished it's work or not" — a turn that ended on "the suite is still
// running" read as done, and what Filament started by itself after it went unseen). While the turn is over and what
// the agent waits on still runs — a command it started in the background, an agent of its at work, the time it set to
// come back — the transcript says so where the eye is, with the clock, and that the chat goes on by itself: every one
// of them wakes the chat as it ends (app/sessions/wake.js). After the person pressed Stop, nothing wakes it (FO-D50):
// the line says their next message tells the agent.
import { h as pageH } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { commandShort, ranWords } from "../lib/commands.js";
import { comeBackClock } from "../lib/come-back.js";

/**
 * What the chat waits on now.
 * @typedef {{ commands: { id: string, command: string, startedAt: number }[], agents: number,
 *   comeBack: import("../lib/come-back.js").ComeBack | null, stopped: boolean }} WaitingOn
 */

/** @param {number} n @param {string} one */
const counted = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Whether the line stands, and what it waits on: the chat's newest turn has ended (none runs, none asks, no compaction)
 * and its own agent's commands run in the background, its agents are at work, or its come-back is set. A command a
 * sub-agent started is that agent's work, counted with it; the coding agent's own tasks wake nothing of Filament's.
 * @param {{ phase: string, compacting: boolean, commands: readonly { id: string, command: string, startedAt: number, agent: string | null }[],
 *   agents: number, comeBack: import("../lib/come-back.js").ComeBack | null, stopped: boolean }} s
 *   `phase`: the turn's (lib/overview.js `turnNow`); `stopped`: the person stopped the newest turn
 * @returns {WaitingOn | null}
 */
export function waitingOn(s) {
  if (s.phase !== "ended" && s.phase !== "failed") return null;
  if (s.compacting) return null;
  const commands = s.commands.filter((c) => !c.agent).map((c) => ({ id: c.id, command: c.command, startedAt: c.startedAt }));
  if (!commands.length && !s.agents && !s.comeBack) return null;
  return { commands, agents: s.agents, comeBack: s.comeBack, stopped: s.stopped };
}

/**
 * The line's words: `lead`, what runs (the one command by its words and how long it has run, else how many), and
 * `then`, what happens when it ends. A come-back alone says when.
 * @param {WaitingOn} w @param {number} now
 * @returns {{ lead: string, what: string, then: string, title: string }}
 */
export function waitingOnWords(w, now) {
  const c = w.commands;
  const oldest = c.length ? Math.min(...c.map((x) => x.startedAt)) : now;
  const ran = ranWords(now - oldest);
  const runs = [
    c.length === 1 ? `${commandShort(c[0].command)} · ${ran}` : c.length ? `${counted(c.length, "command")} · the oldest ${ran}` : "",
    w.agents ? `${counted(w.agents, "agent")} at work` : "",
  ].filter(Boolean);
  const many = c.length + w.agents > 1;
  const title = c.map((x) => x.command).join("\n");
  if (w.stopped) {
    const what = runs.join(" · ") || (w.comeBack ? `the come-back at ${comeBackClock(w.comeBack)}` : "");
    return { lead: "Still running", what, then: "You stopped the turn: your next message tells the agent how it ended.", title };
  }
  if (!runs.length && w.comeBack) return { lead: "Not done yet", what: `back at ${comeBackClock(w.comeBack)}`, then: "The chat goes on here by itself then, with the agent's note.", title };
  const back = w.comeBack ? ` It also comes back at ${comeBackClock(w.comeBack)}.` : "";
  const then = many ? `The chat goes on here by itself as each ends.${back}` : `The chat goes on here by itself when it ends.${back}`;
  return { lead: "Not done yet", what: `waiting on ${runs.join(" · ")}`, then, title };
}

/**
 * The line's row, after the last turn, drawn as the live line under a running turn is (live-line.js) — still at work,
 * not done: its words, its clock moved by `tick`, and Stop where one command of the chat's own runs alone.
 * @param {{ h?: typeof pageH, onStop?: (id: string, command: string) => void }} [o]
 */
export function waitingOnRow({ h = pageH, onStop } = {}) {
  /** @type {WaitingOn | null} */
  let said = null;
  const lead = h("span", { class: "turn-live-lead" });
  const what = h("span", { class: "waiting-on-what" });
  const then = h("span", { class: "waiting-on-then" });
  const stop = h("button", {
    class: "boundary-toggle waiting-on-stop hidden", type: "button",
    title: "Stop this command, with what it started; its agent is told with its next turn",
    onclick: () => {
      const one = said?.commands.length === 1 ? said.commands[0] : null;
      if (one && onStop) onStop(one.id, one.command);
    },
  }, "Stop");
  const el = h("div", { class: "waiting-on-row", role: "status" },
    h("span", { class: "turn-live-spin", "aria-hidden": "true", html: ICONS.loader }), h("span", { class: "waiting-on-label" }, lead, what, " ", then), stop);
  /** @param {number} [now] */
  const tick = (now = Date.now()) => {
    if (!said) return;
    const w = waitingOnWords(said, now);
    lead.replaceChildren(w.lead);
    what.replaceChildren(w.what ? ` · ${w.what}.` : ".");
    then.replaceChildren(w.then);
    el.setAttribute("title", w.title);
  };
  return {
    el,
    /** @param {WaitingOn} w @param {number} [now] */
    set(w, now = Date.now()) {
      said = w;
      stop.classList.toggle("hidden", !(onStop && w.commands.length === 1 && !w.agents));
      tick(now);
    },
    tick,
  };
}
