// @ts-check
// The chat's status, in one of two places (Appearance › Chat status, the pref `statusPanel`; proposal_ux D3, M4).
//
// The status capsule under the message box (§4.2; in the header until the owner's word of 10-29, where it was easy to
// miss), the default: the chat's state in words, always in the same spot, first in the composer's strip — Working ·
// 17m | round 75 in blue, Needs you · 1 | 3 working in orange, Making room · 62% in teal, Stopped · 529 overloaded in
// red — and hidden while nothing runs or waits (`capsuleWords`). A press opens its popover: the goal and the
// progress, the agents at work (each with Stop), the coding agent's own tasks, the commands its agents run in the
// background (each with Stop: HarnessV4_Background_Plan E38), what else is still open for its agent — a sub-agent's
// change that waits for it, one that failed (the owner's plan of 11-02, Phase 4) —, the come-back its agent set (with
// Cancel: the Designer's of 10-27), the changes, the terminals, and at its foot Open Sub Agents ›, with when the turn
// reached a coding agent. Nothing floats over the transcript. A come-back alone keeps the capsule, grey: Comes back |
// 14:32; so does what is still open: Still open | 2.
//
// The floating status panel, kept as Appearance's other choice: a 34px capsule over the chat that expands to a 320px
// card, opening as agents start, always open or always folded. Sections are Goal, Progress, Sub-agents, the coding
// agent's own tasks, Git and Terminals — each rendered only when it has something to say. A section with no data is
// absent, never faked. The agent's tasks are the ones Claude runs beside its work — its sub-agents, its shells — while
// they run, a turn or none (HarnessV4_Tasks U1; lib/agent-tasks.js): the chat looks idle while a background one works
// on, and this is where it shows. The session's sub-agents stay listed after they end (the registry keeps them), so
// the panel is where a finished one's conversation is opened again. A team's workers are the Team tab's: neither
// lists them nor opens over the conversation as one starts (HarnessV3-Views V3).
import { h, morphChildren } from "../../lib/dom.js";
import { prefs } from "../prefs.js";
import { ICONS } from "../lib/icons.js";
import { menu, popover } from "../lib/ui.js";
import { keepingFocus } from "../lib/keep-focus.js";
import { rowWords, statusWord, statusTone, tookOf } from "../lib/subagents.js";
import { agentTaskRows, agentTasksWord } from "../lib/agent-tasks.js";
import { commandRows, commandsWord } from "../lib/commands.js";
import { cancelTitle, comeBackClock, comeBackFact, comeBackIn, comeBackRow, comeBackTitle, comeBackWord, idleWakeFact, idleWakeRow } from "../lib/come-back.js";
import { yourAsk } from "../lib/team.js";
import { agentFailure } from "../lib/now.js";
import { failureSeen } from "../lib/failures-seen.js";
import { agoShort } from "../../lib/format.js";
import { branchWords, placeName } from "../lib/labels.js";
import { ranFor } from "./compacting.js";

/** Sub-agent rows the panel lists: every running one, then the newest ended ones up to this many rows in all. */
const SUBAGENT_ROWS = 5;
/** The agent's own tasks the panel lists, the oldest first; the rest are counted under them. */
const AGENT_TASK_ROWS = 6;
/** Where the capsule's popover opens: above it, from its left edge, as it stands first in the strip under the box. */
export const CAPSULE_POP = Object.freeze({ side: "top", align: "start", width: 340 });

/**
 * Where the chat's status shows, as Appearance offers it: the capsule under the message box (the default), or the
 * panel floating over the chat in one of its three modes.
 */
export const STATUS_PLACES = Object.freeze([
  { value: "composer", label: "Under the message box" },
  { value: "auto", label: "Floating over the chat, opening as agents start" },
  { value: "expanded", label: "Floating over the chat, always open" },
  { value: "collapsed", label: "Floating over the chat, always folded" },
]);

/** Whether the status floats over the chat, else the capsule under the box says it. @param {unknown} mode the pref */
export const floats = (mode) => mode === "auto" || mode === "expanded" || mode === "collapsed";

/**
 * What the status reads of the chat, as the page hands it: the floating panel's model, and the capsule's facts.
 * @typedef {{ plan?: any[], subagents?: any[], subagentsQueued?: number, agentTasks?: { who: string, tasks: any[] } | null,
 *   goal?: any, git?: any, terminals?: any[],
 *   turn?: { phase: string, startedAt: number | null, round: number, error: string } | null,
 *   compacting?: { since?: number, percent?: number | null } | null,
 *   coder?: { name: string, sentAt: number | null } | null,
 *   commands?: import("../lib/commands.js").CommandRow[], cwd?: string, nameOf?: (agent: string) => string,
 *   comeBack?: import("../lib/come-back.js").ComeBack | null, idleWake?: import("../lib/come-back.js").IdleWake | null }} StatusModel
 *   `turn`: what the chat's turn does now (lib/overview.js `turnNow`); `compacting`: the compaction running for it, as
 *   the server last said; `coder`: the coding agent that runs it, and when the running turn reached it; `commands`: the
 *   commands its agents run in the background (HarnessV4_Background_Plan E38), `cwd` the chat's folder and `nameOf` a
 *   sub-agent's name, for their rows; `comeBack`: the come-back its agent set, while it waits (the Designer's of 10-27);
 *   `idleWake`: Filament's check-in on its agent idle while its command runs (app/sessions/idle-wake.js, 11-08)
 */

/** A span of time in a capsule's few words: "45s", "17m", "1h 05m". @param {number} ms */
const spanWords = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

/** An error's first words, as the capsule has room for: its first line, cut at 40. @param {string} text */
const errorWords = (text) => {
  const line = String(text || "").split("\n")[0].replace(/^(error|upstream error)\s*:\s*/i, "").trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
};

/** @param {number} n @param {string} one */
const counted = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What is still open in the chat past what runs (the owner's plan of 11-02, Phase 4): its sub-agents whose change waits
 * for its agent to apply (`waits`) — as the registry's `openWork` says them to the agent — and those that failed or were
 * cut off whose thread you have not opened since (`failed`, lib/now.js `agentFailure`, as Now says one; the agent is told
 * of those since its chat's newest summary, a cut of its own). Never the person's own kept aside, a graph task's, one
 * that started by itself, or a team's worker, whom the Agents tab's team shows. Those at work, the agent's own tasks and
 * the commands have their own sections.
 * @param {readonly any[]} rows  the chat's sub-agents, as the page lists them @param {(r: any) => boolean} [seen]
 * @returns {{ row: any, fact: string, tone: "warn" | "error", kind: "waits" | "failed" }[]}
 */
export function stillOpenRows(rows, seen = failureSeen) {
  /** @type {{ row: any, fact: string, tone: "warn" | "error", kind: "waits" | "failed" }[]} */
  const out = [];
  for (const r of rows) {
    if (r.status === "running" || r.origin === "self" || r.aside || r.task || r.team) continue;
    const files = Number(r.work?.pending) || 0;
    if (files > 0) {
      out.push({ row: r, fact: `its change waits for the agent to apply it — ${files} file${files === 1 ? "" : "s"}`, tone: "warn", kind: "waits" });
      continue;
    }
    const failed = agentFailure(r);
    if (failed && !seen(r)) out.push({ row: r, fact: `${failed} — open its thread to try again`, tone: "error", kind: "failed" });
  }
  return out;
}
/**
 * How many of each are still open (`stillOpenRows`), as the capsule counts them.
 * @param {readonly { kind: "waits" | "failed" }[]} open @returns {{ waits: number, failed: number }}
 */
export const openCounts = (open) => ({ waits: open.filter((o) => o.kind === "waits").length, failed: open.filter((o) => o.kind === "failed").length });

/**
 * What is still open in the chat (`stillOpenRows`): a row each — who, what waits or how it failed — whose name opens its
 * thread, where its change is applied or its Retry is.
 * @param {StatusIO} cb @param {{ row: any, fact: string, tone: "warn" | "error" }[]} open
 */
function stillOpenSection(cb, open) {
  return h("section", { class: "sp-section", "data-key": "open" },
    h("div", { class: "sp-section-head" }, "Still open", h("span", { class: "sp-count" }, String(open.length))),
    ...open.map((o) => {
      const w = rowWords(o.row);
      return h("div", { class: "sp-task", "data-key": String(o.row.id) },
        h("div", { class: `sp-agent sp-sub tone-${o.tone}` },
          h("span", { class: "sp-sub-dot" }),
          h("button", { class: "sp-agent-name ghost", type: "button", "data-key": "name", title: w.title, onclick: () => cb.onOpenSubagent?.(o.row.id) }, w.name)),
        h("div", { class: "sp-task-meta" }, o.fact));
    }));
}

/**
 * What the capsule says (proposal_ux §4.2): what waits for you first — the turn's question and the agents' — then a
 * compaction making room, the work, an error the newest turn stopped on, the come-back its agent set (the Designer's of
 * 10-27: Comes back | 14:32, grey), and what is still open (Still open | 2, grey); hidden while nothing runs or waits. A
 * come-back beside any other state keeps that state's capsule, and its title says when it comes back. `lead` and `more`
 * are its two parts, a rule between them.
 * @param {{ turn: { phase: string, startedAt: number | null, round: number, error: string } | null,
 *   compacting: { since?: number, percent?: number | null } | null, working: number, asking: number, tasks: number, commands?: number,
 *   comeBack?: import("../lib/come-back.js").ComeBack | null, idleWake?: import("../lib/come-back.js").IdleWake | null,
 *   open?: { waits: number, failed: number }, now: number }} s
 *   `working`, `asking`: the chat's agents at work and those of them that ask you; `tasks`: its coding agent's own
 *   tasks running; `commands`: the commands its agents run in the background (HarnessV4_Background_Plan E38-D1);
 *   `comeBack`: the come-back its agent set, while it waits; `idleWake`: Filament's check-in on the idle agent, said on
 *   the title while its commands run; `open`: its sub-agents' changes that wait for its agent, and
 *   its failed ones you have not opened (`openCounts`)
 * @returns {{ state: "idle" | "working" | "asks" | "room" | "stopped" | "later", lead: string, more: string, title: string }}
 */
export function capsuleWords(s) {
  const phase = s.turn?.phase || "none";
  const commands = s.commands || 0;
  const busy = s.working + s.tasks + commands;
  const asks = (phase === "asks" ? 1 : 0) + s.asking;
  const back = s.comeBack ? ` · ${comeBackFact(s.comeBack)}` : "";
  if (asks)
    return { state: "asks", lead: `Needs you · ${asks}`, more: busy ? `${busy} working` : "", title: `${counted(asks, "question")} for you${busy ? `, ${busy} at work` : ""}${back}` };
  if (s.compacting) {
    const p = s.compacting.percent;
    const how = p != null && Number.isFinite(Number(p)) ? `${Math.round(Number(p))}%` : ranFor(s.now - (Number(s.compacting.since) || s.now));
    return { state: "room", lead: "Making room", more: how, title: `A compaction makes room in the context window${back}` };
  }
  // The turn's clock is the live line's under it, alone (the Designer's review of 10-24: four "Working"s, their clocks
  // a second apart): the capsule says its step, and how long on hover.
  if (phase === "running") {
    const took = s.turn?.startedAt ? spanWords(s.now - s.turn.startedAt) : "";
    const step = s.turn?.round ? `step ${s.turn.round}` : "";
    return { state: "working", lead: "Working", more: step, title: `${["The agent works on your message", step, took ? `${took} so far` : "", busy ? `${busy} at work beside it` : ""].filter(Boolean).join(" · ")}${back}` };
  }
  if (busy) {
    const more = [s.working ? counted(s.working, "agent") : "", s.tasks ? counted(s.tasks, "task") : "", commands ? counted(commands, "command") : ""].filter(Boolean).join(" · ");
    const idle = s.idleWake ? ` · Filament ${idleWakeFact(s.idleWake)} if nothing else comes` : "";
    return { state: "working", lead: "Working", more, title: `The turn is over; ${more} still at work${idle}${back}` };
  }
  if (phase === "failed") return { state: "stopped", lead: "Stopped", more: errorWords(s.turn?.error || ""), title: `${s.turn?.error || "The newest turn stopped with an error"}${back}` };
  if (s.comeBack) return { state: "later", lead: "Comes back", more: comeBackClock(s.comeBack), title: comeBackTitle(s.comeBack) };
  const open = (s.open?.waits || 0) + (s.open?.failed || 0);
  if (open) {
    const w = s.open?.waits || 0;
    const f = s.open?.failed || 0;
    const said = [
      w ? (w === 1 ? "A sub-agent's change waits for the agent to apply it" : `${w} sub-agents' changes wait for the agent to apply them`) : "",
      f ? (f === 1 ? "a sub-agent failed, and you have not opened its thread yet" : `${f} sub-agents failed, and you have not opened their threads yet`) : "",
    ].filter(Boolean);
    const title = said.join("; ");
    return { state: "later", lead: "Still open", more: String(open), title: `${title.charAt(0).toUpperCase()}${title.slice(1)}` };
  }
  return { state: "idle", lead: "", more: "", title: "" };
}

/**
 * @typedef {{ name: string, branch: string, files: number | null, home: boolean }} GitRow  one place the Git section
 *   names: its folder's name, its branch, how many files git status lists (null where git could not tell), and
 *   whether it is the chat's own folder
 */

/**
 * The places the Git section names, from a `/git/place` answer: the chat's folder first, then each place its agents
 * also wrote in (HarnessV4_Git_Plan GW-D55). A place git could not read is left out, as the sidebar's line leaves it
 * (GWC-55, GWC-56); the header's card says why.
 * @param {any} p @returns {GitRow[]}
 */
export function gitRows(p) {
  if (!p) return [];
  return [{ ...p, home: true }, ...(p.also || []).map((/** @type {any} */ a) => ({ ...a, home: false }))]
    .filter((x) => x.ok)
    .map((x) => ({ name: placeName(x.place || x.cwd), branch: branchWords(x), files: x.uncommitted ? x.uncommitted.files : null, home: x.home }));
}

/** The capsule's word for where the chat works: the first place's branch, `+N` for the others (GW-D55). @param {GitRow[]} rows */
export function gitWord(rows) {
  if (!rows.length) return "";
  return `${rows[0].branch || "git"}${rows.length > 1 ? ` +${rows.length - 1}` : ""}`;
}

/**
 * What the status's sections do: open the plan, the changes, a terminal, an agent's thread; write the goal command
 * into the box; stop a terminal, an agent or a coding agent's task; let a launch go.
 * @typedef {{ onOpenPlan: () => void, onOpenChanges?: () => void, onGoal: (command: string) => void, onGoalHold?: () => void, onOpenTerminal?: () => void, onStopTerminal?: (id: string) => void,
 *   onOpenSubagent?: (id: string) => void, onStopSubagent?: (id: string) => void, onDetachSubagent?: (id: string) => void,
 *   onStopAgentTask?: (id: string) => void, onOpenSide?: () => void,
 *   onStopCommand?: (id: string, command: string) => void, onCopyCommandOutput?: (path: string) => void, onCommandsTick?: () => void,
 *   onCancelComeBack?: () => void }} StatusIO
 *   `onOpenSide`: the Sub Agents tab, the capsule's foot; `onStopCommand`, `onCopyCommandOutput`: a running command's
 *   Stop and its output's file (HarnessV4_Background_Plan E38-D2, D3); `onCommandsTick`: read the commands' newest lines
 *   again, every 2 s while their rows show (E38-D4); `onCancelComeBack`: the come-back's Cancel (the Designer's of 10-27)
 */

/** @typedef {import("../lib/commands.js").CommandRow} CommandRow */

/** The running commands the status lists; the rest are counted under them. */
const COMMAND_ROWS = 5;
/** How often their newest lines are read while their rows show (E38-D4). */
export const COMMANDS_TICK_MS = 2000;

/**
 * The commands the chat's agents run in the background (HarnessV4_Background_Plan E38-D2): a row each, the oldest
 * first — the command, how long it has run, the machine it runs on where that is another (the remote-agents plan's
 * c-tools), who started it and where where that is not the chat's, its newest line — with Stop, and the file with all
 * of its output where one is kept.
 * @param {StatusIO} cb @param {StatusModel} m
 */
function commandsSection(cb, m) {
  const rows = commandRows(m.commands, { cwd: m.cwd, now: Date.now(), nameOf: m.nameOf });
  const shown = rows.slice(0, COMMAND_ROWS);
  return h("section", { class: "sp-section sp-commands", "data-key": "commands" },
    h("div", { class: "sp-section-head" }, "Commands", h("span", { class: "sp-count" }, `${rows.length} running`)),
    ...shown.map((r) => h("div", { class: "sp-task sp-command", "data-key": r.id, "data-command": r.id, title: r.title },
      h("div", { class: `sp-agent sp-sub tone-${statusTone("running")}` },
        h("span", { class: "sp-sub-dot" }),
        h("span", { class: "sp-agent-name sp-command-name" }, r.command),
        cb.onStopCommand ? h("button", { class: "ghost sm", type: "button", "data-key": "stop", title: r.machine ? `Stop this command on ${r.machine}, with what it started there; its agent is told with its next turn` : "Stop this command, with what it started; its agent is told with its next turn", onclick: () => cb.onStopCommand?.(r.id, r.command) }, "Stop") : null),
      h("div", { class: "sp-task-meta" }, r.facts),
      h("div", { class: `sp-command-line${r.quiet ? " is-quiet" : ""}` }, r.line),
      r.logPath && cb.onCopyCommandOutput
        ? h("button", { class: "ghost sm sp-command-file", type: "button", "data-key": "file", title: r.logPath, onclick: () => cb.onCopyCommandOutput?.(/** @type {string} */ (r.logPath)) }, "Copy its output's path")
        : null)),
    rows.length > shown.length ? h("div", { class: "sp-more" }, `and ${rows.length - shown.length} more`) : null);
}

/**
 * A timer that reads the commands again while their rows show (E38-D4), and none while they do not.
 * @param {StatusIO} cb
 */
function commandsTicker(cb) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let t = null;
  return {
    /** @param {boolean} on */
    set(on) {
      if (on && !t && cb.onCommandsTick) t = setInterval(() => cb.onCommandsTick?.(), COMMANDS_TICK_MS);
      else if (!on && t) {
        clearInterval(t);
        t = null;
      }
    },
  };
}

/**
 * The commands' moving words — how long each has run, its newest line — laid into the section shown, in place: the
 * 2 s re-read (E38-D4) drew the popover whole under the pointer, and a press on Stop could land on a row just replaced
 * (E38's live look). False where the commands are not the ones shown — one started or ended, one more is counted: the
 * status is drawn again then, in place, its rows that stay kept.
 * @param {Element | null} shown @param {HTMLElement} fresh
 */
function patchCommands(shown, fresh) {
  if (!shown) return false;
  const rowsOf = (/** @type {Element} */ el) => Array.from(el.querySelectorAll(".sp-command"));
  const sign = (/** @type {Element} */ el) =>
    `${rowsOf(el).map((r) => `${r.getAttribute("data-command")}:${r.querySelector(".sp-command-file") ? 1 : 0}`).join(",")}|${el.querySelector(".sp-more")?.textContent || ""}`;
  if (sign(shown) !== sign(fresh)) return false;
  const was = rowsOf(shown);
  rowsOf(fresh).forEach((r, i) => {
    for (const sel of [".sp-task-meta", ".sp-command-line"]) {
      const a = was[i].querySelector(sel);
      const b = r.querySelector(sel);
      if (!a || !b) continue;
      if (a.textContent !== b.textContent) a.textContent = b.textContent;
      if (a.className !== b.className) a.className = b.className;
    }
  });
  return true;
}

/**
 * The come-back the chat's agent set (the Designer's of 10-27): when, its note cut to the row's room — whole on hover —
 * with Cancel, one press and no question, its title saying what the press does; under it how long until it.
 * @param {StatusIO} cb @param {import("../lib/come-back.js").ComeBack} c
 */
function comeBackSection(cb, c) {
  const r = comeBackRow(c, Date.now());
  return h("section", { class: "sp-section sp-comeback", "data-key": "comeback" },
    h("div", { class: "sp-section-head" }, "Comes back", h("span", { class: "sp-count" }, r.at)),
    h("div", { class: "sp-task" },
      h("div", { class: "sp-agent" },
        h("span", { class: "sp-agent-name sp-comeback-note", title: r.title }, r.note),
        cb.onCancelComeBack ? h("button", { class: "ghost sm", type: "button", title: cancelTitle(c), onclick: () => cb.onCancelComeBack?.() }, "Cancel") : null),
      h("div", { class: "sp-task-meta sp-comeback-in" }, r.left)));
}

/**
 * Filament's check-in on the chat's agent idle while its command runs (app/sessions/idle-wake.js, the owner's of 11-08):
 * when, what happens then, and how long until it — nothing to press: any turn drops it, and Settings › Agent loop sets
 * its minutes. @param {import("../lib/come-back.js").IdleWake} w
 */
function idleWakeSection(w) {
  const r = idleWakeRow(w, Date.now());
  return h("section", { class: "sp-section sp-idlewake", "data-key": "idlewake" },
    h("div", { class: "sp-section-head" }, "Checks in", h("span", { class: "sp-count" }, r.at)),
    h("div", { class: "sp-task", title: r.title },
      h("div", { class: "sp-agent" }, h("span", { class: "sp-agent-name" }, r.words)),
      h("div", { class: "sp-task-meta" }, r.left)));
}

/** How often the come-back's "in 18 min" is said again while its row shows. */
export const COME_BACK_TICK_MS = 15_000;

/**
 * A timer that says again how long until the come-back while its row shows — in place, nothing else drawn, so a press on
 * Cancel never lands on a row just replaced — and none while it does not.
 * @param {() => Element | null} host  where the row is drawn, while it is
 */
function comeBackTicker(host) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let t = null;
  /** @type {import("../lib/come-back.js").ComeBack | null} */
  let shown = null;
  return {
    /** @param {import("../lib/come-back.js").ComeBack | null} c  the come-back whose row shows, null for none */
    set(c) {
      shown = c;
      if (c && !t) {
        t = setInterval(() => {
          const el = host()?.querySelector(".sp-comeback-in");
          if (el && shown) el.textContent = comeBackIn(shown, Date.now());
        }, COME_BACK_TICK_MS);
      } else if (!c && t) {
        clearInterval(t);
        t = null;
      }
    },
  };
}

/** @param {StatusIO} cb @param {any} goal */
function goalSection(cb, goal) {
  return h("section", { class: "sp-section", "data-key": "goal" },
    h("div", { class: "sp-section-head" }, "Goal", h("span", { class: `sp-pill ${goal.status || "active"}` }, goal.status || "Active")),
    h("div", { class: "sp-goal-text" }, goal.text || ""),
    // Its drive (core/goal-drive.js): its round, or why it halted, with what goes on from there.
    goal.drive?.words ? h("div", { class: "sp-spend", "data-key": "drive" }, goal.drive.words) : null,
    h("div", { class: "sp-actions" },
      goal.status === "proposed" ? h("button", { class: "primary sm", type: "button", "data-key": "accept", onclick: () => cb.onGoal("/goal accept") }, "Accept") : null,
      goal.drive?.halted ? h("button", { class: "primary sm", type: "button", "data-key": "go", title: "Drive the goal on: its next round starts now", onclick: () => cb.onGoal("/goal go") }, "Go on") : null,
      goal.drive && !goal.drive.halted ? h("button", { class: "ghost sm", type: "button", "data-key": "hold", title: "Hold the goal: no round starts by itself until Go on", onclick: () => (cb.onGoalHold ? cb.onGoalHold() : cb.onGoal("/goal hold")) }, "Hold") : null,
      h("button", { class: "ghost sm", type: "button", "data-key": "clear", title: "Clear goal", onclick: () => cb.onGoal("/goal abandon") }, "Clear")));
}

/** The plan's progress: its step in progress a spinner, turning while the turn runs (`live`, the owner's of 11-10). @param {StatusIO} cb @param {any[]} plan @param {boolean} [live] */
function planSection(cb, plan, live = false) {
  const done = plan.filter((p) => p.status === "done").length;
  return h("section", { class: "sp-section", "data-key": "plan" },
    h("div", { class: "sp-section-head" }, "Progress", h("span", { class: "sp-count" }, `${done}/${plan.length}`)),
    h("div", { class: "sp-plan" },
      ...plan.slice(0, 6).map((p) => h("div", { class: `sp-plan-item ${p.status || "pending"}` },
        h("span", { class: `sp-plan-ic${p.status === "doing" ? ` doing${live ? " is-live" : ""}` : ""}`, html: p.status === "done" ? ICONS.circleCheck : p.status === "doing" ? ICONS.loader : ICONS.circle }),
        h("span", {}, p.text)))),
    h("button", { class: "ghost sm", type: "button", onclick: cb.onOpenPlan }, "Open plan"));
}

/** Terminals the pane owns, alive in the background (§5.6/B4): one row each, Stop ends the process. @param {StatusIO} cb @param {any[]} terms */
function terminalsSection(cb, terms) {
  const age = (/** @type {number} */ at) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`; };
  return h("section", { class: "sp-section", "data-key": "terminals" },
    h("div", { class: "sp-section-head" }, "Terminals", h("span", { class: "sp-count" }, `${terms.length} running`)),
    ...terms.map((t) => h("div", { class: "sp-agent", "data-key": String(t.id) },
      h("button", { class: "sp-agent-name ghost", type: "button", onclick: () => cb.onOpenTerminal?.() },
        placeName(t.cwd || "") || "terminal"),
      h("span", { class: "sp-agent-time" }, age(t.createdAt || Date.now())),
      h("button", { class: "ghost sm", type: "button", "data-key": "stop", title: "Stop this terminal", onclick: () => cb.onStopTerminal?.(t.id) }, "Stop"))),
    cb.onOpenTerminal ? h("button", { class: "ghost sm", type: "button", "data-key": "open", onclick: () => cb.onOpenTerminal?.() }, "Open terminal") : null);
}

/**
 * Where the chat works, read-only, counts only. Its own folder alone keeps the short form, the branch in the head;
 * any other place lists each by its folder's name, so a chat whose agent works in a worktree says so (GW-D55). The
 * capsule's popover titles it Changes, the panel Git.
 * @param {StatusIO} cb @param {GitRow[]} rows @param {string} [title]
 */
function gitSection(cb, rows, title = "Git") {
  const changed = (/** @type {GitRow} */ r, clean = "clean") =>
    r.files === null ? "git could not tell what is uncommitted" : r.files ? `${r.files} file${r.files === 1 ? "" : "s"} changed` : clean;
  const open = h("button", { class: "ghost sm", type: "button", "data-key": "open", onclick: cb.onOpenChanges }, "Open changes");
  if (rows.length === 1 && rows[0].home)
    return h("section", { class: "sp-section", "data-key": "git" },
      h("div", { class: "sp-section-head" }, title, h("span", { class: "sp-count" }, rows[0].branch)),
      h("div", { class: "sp-goal-text" }, changed(rows[0], "Clean working tree")),
      open);
  return h("section", { class: "sp-section", "data-key": "git" },
    h("div", { class: "sp-section-head" }, title, h("span", { class: "sp-count" }, `${rows.length} folder${rows.length === 1 ? "" : "s"}`)),
    ...rows.map((r) => h("div", { class: "sp-git-place", "data-key": r.name, title: r.home ? "This chat's folder" : "Its agents also wrote here" },
      h("span", { class: "sp-git-name" }, r.name),
      r.branch ? h("span", { class: "sp-git-branch" }, h("span", { class: "sp-git-ic", html: ICONS.gitBranch }), r.branch) : null,
      h("span", { class: "sp-git-state" }, changed(r)))),
    open);
}

/**
 * The session's sub-agents: each row opens its conversation; a running one can be stopped here. `queued` counts
 * the reports (and launch notices) waiting for the next message, when no turn runs to take them. `atWork`: the
 * capsule's — those at work alone, the ones that ask you first, the rest in the Sub Agents tab.
 * @param {StatusIO} cb @param {import("../lib/subagents.js").SubagentRow[]} rows @param {number} queued @param {boolean} [atWork]
 */
function subagentsSection(cb, rows, queued, atWork = false) {
  const running = rows.filter((r) => r.status === "running");
  const asking = running.filter((r) => yourAsk(r.progress));
  const shown = atWork
    ? [...asking, ...running.filter((r) => !asking.includes(r))]
    : [...running, ...rows.filter((r) => r.status !== "running").slice(0, Math.max(0, SUBAGENT_ROWS - running.length))];
  return h("section", { class: "sp-section", "data-key": "agents" },
    h("div", { class: "sp-section-head" }, atWork ? "Agents at work" : "Sub-agents", h("span", { class: "sp-count" }, running.length ? `${running.length} running` : String(rows.length))),
    ...shown.map((r) => {
      const took = r.status === "running" ? "" : tookOf(r);
      const w = rowWords(r);
      const asks = !!yourAsk(r.progress);
      return h("div", { class: `sp-agent sp-sub tone-${asks ? "warn" : statusTone(r.status)}`, "data-key": r.id },
        h("span", { class: "sp-sub-dot", title: asks ? "asks you" : statusWord(r.status) }),
        h("button", { class: "sp-agent-name ghost", type: "button", "data-key": "name", title: w.title, onclick: () => cb.onOpenSubagent?.(r.id) }, w.name),
        h("span", { class: "sp-agent-time" }, [asks ? "asks you" : r.status === "running" ? r.model : statusWord(r.status), took, w.followUp ? "follow-up" : ""].filter(Boolean).join(" · ")),
        // A launch the main agent waits on can be let go from here, not only from its window (the UI/UX review,
        // 2026-09-30): the row the developer watches is where the friction was.
        r.status === "running" && !r.background && r.origin === "agent" && cb.onDetachSubagent
          ? h("button", { class: "ghost sm", type: "button", "data-key": "detach", title: "Free the main agent now — it keeps running in the background; its report reaches the main agent when it finishes. To take its report yourself, open its thread and choose Run in background — report to me.", onclick: () => cb.onDetachSubagent?.(r.id) }, "Run in background")
          : null,
        r.status === "running" ? h("button", { class: "ghost sm", type: "button", "data-key": "stop", title: "Stop it now — what it finished is kept as its report", onclick: () => cb.onStopSubagent?.(r.id) }, "Stop") : null);
    }),
    !atWork && rows.length > shown.length ? h("div", { class: "sp-more" }, `${rows.length - shown.length} earlier — see the Agents tab`) : null,
    queued ? h("div", { class: "sp-more" }, `${queued} message${queued === 1 ? "" : "s"} from agents open${queued === 1 ? "s" : ""} your next turn`) : null);
}

/**
 * The coding agent's own tasks while they run (HarnessV4_Tasks U1): a row each — what it is, how long it has run,
 * its kind and whether it runs in the background, what it has used and its last tool — and under it its own word
 * on how it goes. A sub-agent its agent lets Filament stop alone has its Stop (HarnessV4_Tasks E6): that one ends, and
 * the agent and its other work go on. The rest are the agent's to stop: its shells, its workflows.
 * @param {StatusIO} cb @param {{ who: string, tasks: import("../lib/agent-tasks.js").AgentTask[] }} a
 */
function agentTasksSection(cb, a) {
  const rows = agentTaskRows(a.tasks, Date.now());
  const shown = rows.slice(0, AGENT_TASK_ROWS);
  return h("section", { class: "sp-section", "data-key": "tasks" },
    h("div", { class: "sp-section-head" }, `${a.who}'s tasks`, h("span", { class: "sp-count" }, `${rows.length} running`)),
    ...shown.map((r) => h("div", { class: "sp-task", "data-key": String(r.id), title: [r.name, r.meta, r.said].filter(Boolean).join("\n") },
      h("div", { class: `sp-agent sp-sub tone-${statusTone("running")}` },
        h("span", { class: "sp-sub-dot" }),
        h("span", { class: "sp-agent-name" }, r.name),
        h("span", { class: "sp-agent-time" }, r.age),
        r.stop && cb.onStopAgentTask ? h("button", { class: "ghost sm", type: "button", "data-key": "stop", title: `Stop this agent now — ${a.who} and its other work go on`, onclick: () => cb.onStopAgentTask?.(r.id) }, "Stop") : null),
      h("div", { class: "sp-task-meta" }, r.meta),
      r.said ? h("div", { class: "sp-task-said" }, r.said) : null)),
    rows.length > shown.length ? h("div", { class: "sp-more" }, `${rows.length - shown.length} more`) : null);
}

/** The model as the sections read it: a team's workers are the Team tab's (HarnessV3-Views V3). @param {StatusModel | null | undefined} m @returns {StatusModel} */
const withoutWorkers = (m) => ({ ...(m || {}), subagents: (m?.subagents || []).filter((/** @type {any} */ r) => !r.team) });

/**
 * The status capsule under the message box (proposal_ux §4.2): the chat's state in words (`capsuleWords`), hidden
 * while nothing runs or waits, and while the status floats over the chat instead (Appearance). A press opens its
 * popover above it (`CAPSULE_POP`); it follows the chat while it is open.
 * @param {StatusIO} cb
 * @returns {{ el: HTMLElement, set: (model: StatusModel) => void, commands: (list: CommandRow[]) => void }}
 */
export function createStatusCapsule(cb) {
  /** @type {StatusModel} */
  let model = {};
  const dot = h("span", { class: "sc-dot", "aria-hidden": "true" });
  const lead = h("span", { class: "sc-lead" });
  const rule = h("span", { class: "sc-rule", "aria-hidden": "true" });
  const more = h("span", { class: "sc-more" });
  const el = h("button", { class: "status-capsule hidden", type: "button", "aria-haspopup": "dialog" }, dot, lead, rule, more);
  /** The popover while it is open, and its body. @type {{ close: () => void, place?: () => void } | null} */
  let pop = null;
  const body = h("div", { class: "sc-pop" });

  /** The popover's sections: the floating panel's, the agents at work alone, the changes as Changes. */
  const sections = () => {
    const m = withoutWorkers(model);
    const git = gitRows(m.git);
    const running = (m.subagents || []).filter((r) => r.status === "running");
    const open = stillOpenRows(m.subagents || []);
    return [
      m.goal ? goalSection(cb, m.goal) : null,
      m.plan?.length ? planSection(cb, m.plan, m.turn?.phase === "running") : null,
      running.length || m.subagentsQueued ? subagentsSection(cb, m.subagents || [], m.subagentsQueued || 0, true) : null,
      m.agentTasks?.tasks.length ? agentTasksSection(cb, m.agentTasks) : null,
      m.commands?.length ? commandsSection(cb, m) : null,
      m.idleWake ? idleWakeSection(m.idleWake) : null,
      open.length ? stillOpenSection(cb, open) : null,
      m.comeBack ? comeBackSection(cb, m.comeBack) : null,
      git.length ? gitSection(cb, git, "Changes") : null,
      m.terminals?.length ? terminalsSection(cb, m.terminals) : null,
    ].filter((x) => x != null);
  };
  /** Its foot: the way to every agent, and when the running turn reached its coding agent. */
  const foot = () => {
    const c = model.coder;
    const reached = c?.name && c.sentAt && model.turn?.phase === "running" ? `the turn reached ${c.name} ${agoShort(c.sentAt, Date.now()).replace(/^now$/, "just now")}` : "";
    return h("div", { class: "sc-foot", "data-key": "foot" },
      reached ? h("span", { class: "sc-reached" }, reached) : h("span", { class: "sc-gap" }),
      cb.onOpenSide ? h("button", { class: "sc-side", type: "button", onclick: () => { pop?.close(); cb.onOpenSide?.(); } }, "Open Agents", h("span", { class: "sc-caret", html: ICONS.chevronRight })) : null);
  };
  // Drawn again in place at each word of the chat's state while it shows — its Stops and the agents' names under a
  // resting pointer stay the elements they were (the owner's of 11-01: buttons blinking, clicks lost).
  const paintBody = () => keepingFocus(body, () => {
    const s = sections();
    morphChildren(body, [...(s.length ? s : [h("p", { class: "sc-none", "data-key": "none" }, "Nothing else runs for this chat now.")]), foot()]);
  });

  // The commands' newest lines are read again while the popover shows them (E38-D4), and how long until the come-back
  // is said again.
  const ticker = commandsTicker(cb);
  const backTicker = comeBackTicker(() => body);
  el.addEventListener("click", () => {
    if (pop) return pop.close();
    paintBody();
    pop = popover(el, body, { ...CAPSULE_POP, label: "What this chat is doing", onClose: () => { pop = null; ticker.set(false); backTicker.set(null); } });
    ticker.set(!!model.commands?.length);
    backTicker.set(model.comeBack || null);
  });

  const capsule = {
    el,
    /** @param {StatusModel} m */
    set(m) {
      model = m || {};
      const rows = withoutWorkers(model).subagents || [];
      const running = rows.filter((r) => r.status === "running");
      const w = capsuleWords({
        turn: model.turn || null,
        compacting: model.compacting || null,
        working: running.length,
        asking: running.filter((r) => yourAsk(r.progress)).length,
        tasks: model.agentTasks?.tasks.length || 0,
        commands: model.commands?.length || 0,
        comeBack: model.comeBack || null,
        idleWake: model.idleWake || null,
        open: openCounts(stillOpenRows(rows)),
        now: Date.now(),
      });
      const hide = w.state === "idle" || floats(prefs.get("statusPanel"));
      el.classList.toggle("hidden", hide);
      for (const s of ["working", "asks", "room", "stopped", "later"]) el.classList.toggle(`is-${s}`, w.state === s);
      lead.textContent = w.lead;
      more.textContent = w.more;
      rule.classList.toggle("hidden", !w.more);
      more.classList.toggle("hidden", !w.more);
      el.setAttribute("title", w.title);
      el.setAttribute("aria-label", [w.lead, w.more].filter(Boolean).join(", ") || "Status");
      if (hide) pop?.close();
      else if (pop) {
        paintBody();
        pop.place?.();
      }
      ticker.set(!!pop && !!model.commands?.length);
      backTicker.set(pop ? model.comeBack || null : null);
    },
    /**
     * The commands read again (E38-D4): where the same ones show, their moving words change in place and nothing else
     * is drawn; else the status is drawn again, in place. @param {CommandRow[]} list
     */
    commands(list) {
      const m = { ...model, commands: list };
      if (pop && list.length && patchCommands(body.querySelector(".sp-commands"), commandsSection(cb, m))) model = m;
      else capsule.set(m);
    },
  };
  // Appearance moves the status between here and over the chat: the capsule follows at once.
  prefs.onChange((key) => { if (key === "statusPanel") capsule.set(model); });
  return capsule;
}

/**
 * The floating status panel (Appearance's "Floating over the chat"): hidden while the capsule under the message box
 * says the status.
 * @param {StatusIO} cb
 * @returns {{ el: HTMLElement, set: (model: StatusModel) => void, commands: (list: CommandRow[]) => void }}
 */
export function createStatusPanel(cb) {
  /** @type {string} */
  let mode = prefs.get("statusPanel") || "composer";
  let expanded = mode === "expanded";
  /** @type {any} */
  let model = {};
  /** Running sub-agents — and the agent's own tasks — at the last look: Auto expand opens the card when one more
   *  starts, not on every repaint. */
  let subRunning = 0;
  /** Auto expand opened the card (not a click): it folds back to the capsule once the sub-agents it opened for end. */
  let autoOpened = false;

  const capsule = h("button", { class: "sp-capsule", type: "button" });
  const body = h("div", { class: "sp-body" });
  // The commands' newest lines are read again while the card shows them (E38-D4), and how long until the come-back is
  // said again.
  const ticker = commandsTicker(cb);
  const backTicker = comeBackTicker(() => body);
  const el = h("div", { class: "status-panel hidden" }, capsule, body);

  capsule.addEventListener("click", () => { expanded = true; autoOpened = false; paint(); });

  const setMode = (m) => { mode = m; prefs.set("statusPanel", m); expanded = m === "expanded"; paint(); };

  // The Appearance row and the panel's own menu change the same pref; either repaints the other.
  prefs.onChange((key, value) => {
    if (key !== "statusPanel") return;
    mode = value;
    expanded = mode === "expanded";
    paint();
  });

  function paint() {
    // The branch alone is the header's to name (beside the folder); the capsule opens for work in flight, and for a
    // come-back that waits.
    const has = floats(mode) && !!(model.goal || model.plan?.length || model.subagents?.length || model.agentTasks?.tasks.length || model.commands?.length || model.terminals?.length || model.comeBack);
    el.classList.toggle("hidden", !has);
    el.classList.toggle("expanded", expanded && mode !== "collapsed");
    ticker.set(has && expanded && mode !== "collapsed" && !!model.commands?.length);
    backTicker.set(has && expanded && mode !== "collapsed" ? model.comeBack || null : null);
    if (!has) return;

    const bits = [];
    if (model.goal) bits.push("Goal");
    if (model.plan?.length) {
      const done = model.plan.filter((/** @type {any} */ p) => p.status === "done").length;
      bits.push(`${done}/${model.plan.length}`);
    }
    if (model.subagents?.length) {
      const running = model.subagents.filter((/** @type {any} */ r) => r.status === "running").length;
      const n = running || model.subagents.length;
      bits.push(`${n} agent${n === 1 ? "" : "s"}${running ? " running" : ""}`);
    }
    if (model.agentTasks?.tasks.length) bits.push(agentTasksWord(model.agentTasks.tasks));
    if (model.commands?.length) bits.push(commandsWord(model.commands));
    const open = stillOpenRows(model.subagents || []);
    if (open.length) bits.push(`${open.length} still open`);
    if (model.comeBack) bits.push(comeBackWord(model.comeBack));
    const git = gitRows(model.git);
    if (git.length) bits.push(gitWord(git));
    if (model.terminals?.length) bits.push(`${model.terminals.length} term${model.terminals.length === 1 ? "" : "s"}`);
    capsule.textContent = bits.join(" · ") || "status";

    if (!(expanded && mode !== "collapsed")) { morphChildren(body, []); return; }

    const sections = [];
    if (model.goal) sections.push(goalSection(cb, model.goal));
    if (model.plan?.length) sections.push(planSection(cb, model.plan, model.turn?.phase === "running"));
    if (model.subagents?.length) sections.push(subagentsSection(cb, model.subagents, model.subagentsQueued || 0));
    if (model.agentTasks?.tasks.length) sections.push(agentTasksSection(cb, model.agentTasks));
    if (model.commands?.length) sections.push(commandsSection(cb, model));
    if (model.idleWake) sections.push(idleWakeSection(model.idleWake));
    if (open.length) sections.push(stillOpenSection(cb, open));
    if (model.comeBack) sections.push(comeBackSection(cb, model.comeBack));
    if (git.length) sections.push(gitSection(cb, git));
    if (model.terminals?.length) sections.push(terminalsSection(cb, model.terminals));

    const modeBtn = h("button", {
      class: "ghost icon sp-mode", type: "button", "data-key": "mode", title: "Display mode", html: ICONS.ellipsis,
      onclick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        menu([
          { type: "radio", label: "Auto expand", checked: mode === "auto", onClick: () => setMode("auto") },
          { type: "radio", label: "Always expanded", checked: mode === "expanded", onClick: () => setMode("expanded") },
          { type: "radio", label: "Always collapsed", checked: mode === "collapsed", onClick: () => setMode("collapsed") },
          { type: "separator" },
          { type: "radio", label: "Under the message box", desc: "The status capsule under the box; nothing over the chat", checked: mode === "composer", onClick: () => setMode("composer") },
        ], { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "end", width: 220 });
      },
    });
    const collapse = h("button", { class: "ghost sm", type: "button", "data-key": "collapse", onclick: () => { expanded = false; autoOpened = false; paint(); } }, "Collapse");
    // In place, as the capsule's popover (`paintBody`).
    morphChildren(body, [
      h("div", { class: "sp-top", "data-key": "top" }, modeBtn, collapse),
      ...sections,
    ]);
  }

  const panel = {
    el,
    /** @param {StatusModel} m */
    set(m) {
      model = withoutWorkers(m);
      const running = (model.subagents || []).filter((/** @type {any} */ r) => r.status === "running").length + (model.agentTasks?.tasks.length || 0) + (model.commands?.length || 0);
      if (mode === "auto" && (model.goal || running > subRunning)) { if (!expanded) autoOpened = true; expanded = true; }
      else if (mode === "auto" && autoOpened && !running && subRunning > 0) { expanded = false; autoOpened = false; }
      subRunning = running;
      paint();
    },
    /** The commands read again (E38-D4), as the capsule's: their moving words in place where the same ones show. @param {CommandRow[]} list */
    commands(list) {
      const m = { ...model, commands: list };
      if (list.length && patchCommands(body.querySelector(".sp-commands"), commandsSection(cb, m))) model = m;
      else panel.set(m);
    },
  };
  return panel;
}
