// @ts-check
// A coding agent serving a sub-agent's run (HarnessV3-ACP AC6-1, AC6-2): the registry launched the request and says
// what the run is (`hostOf`), and the agent path serves it as the loop's host mode does. Here: the words that tell the
// agent its part — through its standing context channel, since the agent keeps its own system prompt — the words a
// message to it goes in, the asker that puts a permission the session's switch asks about to the developer on its
// lead's timeline, and how its turn ended in the registry's words.
import { AGENT_HEAD, LEAD_HEAD, FILAMENT, FILAMENT_HEAD, STEERING_HEAD } from "./agent/loop.js";
import { PROMPT, readAlongReport } from "./agent/prompt.js";
import { unansweredAs, unattendedAsk } from "./agent/tools.js";
import { ALWAYS_REASON, nobodyAnswer } from "../adapters/agents/asks.js";
import { clip } from "../core/text.js";
import { WATCHER, guideBlock } from "../core/watchers.js";

/** The standing block that says the agent's part: it never leaves its session. */
export const ROLE_BLOCK = "role";
/**
 * Whose word a note is when Filament itself speaks to a worker's agent — why a call of its was refused, that it is stuck
 * (HarnessV3-TaskGraph-v2 TG2-D59) — and its head: the loop's own, so a worker hears it alike in either seat.
 */
export const SHIM = FILAMENT;
export const SHIM_HEAD = FILAMENT_HEAD;

/**
 * @typedef {{ id: string, card: { tag: string, name: string, thinks: string, asked?: boolean, toolsOff?: string[] }, readOnly: boolean, asks: boolean,
 *   team: { name: string, role: string, words: string } | null, task: { id: string, review: boolean } | null, supervise?: boolean, self?: boolean, may?: string }} WorkerHost
 *   what the agent path reads of `hostOf`: the card the run is, and whether Filament says for it that it only reads;
 *   `self`: it started by itself, so nobody is asked for it (HarnessV4_Tasks E15, AG-262);
 *   `supervise`: a worker whose lead reads along with it (HarnessV3-TaskGraph-v2 §12), or a graph task's sub-agent
 *   whose planner, the session's agent, does (TG2-D20)
 */

/**
 * The agent's part, in the loop's own words for a sub-agent's or a worker's run: who launched it and for what, how its
 * permissions go, what to do with nobody to ask, and how to report — a graph task's with the report tool. Its card's
 * own words follow its role (HarnessV4_Tasks E15): one asked by its tag reads who it answers as, and ends with its
 * answer (OA1). The words
 * that teach the loop's model to use its hands are left out: the agent has its own.
 * @param {WorkerHost} host @returns {string}
 */
export function workerWords(host) {
  const w = host.team;
  const words = String(w?.words || "").trim();
  const asked = host.card.asked ? host.card : null;
  const report = host.task?.review ? PROMPT.reviewReport : w ? (host.task ? PROMPT.workerTaskReport : PROMPT.workerReport) : host.task ? PROMPT.taskReport : asked ? PROMPT.cardAnswer : PROMPT.subagentReport;
  // Its lead reads along: it says its plan first (TG2-D18). Every team's worker asks its lead instead of guessing
  // (TG2-D49, TG2-D58): its ask_lead is there.
  const reads = !!w && host.supervise === true;
  // The session's agent reads along with the sub-agent of its graph's task: the same three lines, in its words.
  const taskReads = !w && !!host.task && host.supervise === true;
  const lines = [
    "These are Filament's instructions for this session, not background.",
    w ? PROMPT.workerRole : PROMPT.subagentRole,
    !asked && host.card.thinks,
    host.readOnly && PROMPT.subagentReadOnly,
    // One that may only read is told what runs, whatever its card says: its agent hears no reason for a refusal.
    host.may === "read" && PROMPT.subagentReadsRun,
    !!words && `Team ${w?.name} asks of you: ${words}`,
    !!asked && `You answer as ${asked.name}. ${PROMPT.cardAsked}`,
    !!asked && asked.thinks,
    w ? PROMPT.workerPermission : host.asks ? PROMPT.attendedPermission : PROMPT.subagentPermission,
    !!w && (reads ? PROMPT.workerReadAlong : PROMPT.workerSteering),
    taskReads && PROMPT.taskReadAlong,
    w ? PROMPT.workerAmbiguity : taskReads ? PROMPT.taskAmbiguity : PROMPT.subagentAmbiguity,
    PROMPT.subagentCareAsk,
    w ? readAlongReport(report, PROMPT.workerAsksLead) : taskReads ? readAlongReport(report) : report,
  ];
  return `<filament-context kind="${ROLE_BLOCK}">\n${lines.filter(Boolean).join("\n")}\n</filament-context>`;
}

/**
 * A message to the agent while it works, in the words the loop's worker reads one in: whose it is — its team's lead's,
 * the agent's that planned its task, or the developer's — relayed by Filament, as its part told it to expect. A
 * watcher's guidance is none of them: its own heading, and how to weigh it (core/watchers.js `guideBlock`).
 * @param {{ text: string, from: string, title?: string }} m
 */
export const workerNote = (m) => m.from === WATCHER ? guideBlock(m.title, [m.text]) : `${m.from === "lead" ? LEAD_HEAD : m.from === "agent" ? AGENT_HEAD : m.from === SHIM ? SHIM_HEAD : STEERING_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${m.text}`;

/**
 * A permission's answer: Allow, or Deny with words the agent reads — and, where nobody was asked, why (`reason`),
 * which the record and the call's row say in the person's place.
 * @param {string} [words] @param {string} [reason] @param {string} [by]  who answered, where it was a worker's lead
 */
const permission = (words, reason, by) => ({ outcome: /** @type {const} */ ("answered"), answers: { permission: words == null ? { chosen: ["allow"] } : { chosen: ["deny"], words } }, ...(reason ? { reason } : {}), ...(by ? { by } : {}) });
/**
 * Why a permission the mode asks about is refused with nobody asked: a team's worker in a session no page answers, a
 * sub-agent somebody launched, one that started by itself.
 * @type {Readonly<Record<import("./agent/tools.js").Unanswered, string>>}
 */
export const NOBODY_TO_ASK = Object.freeze({
  worker: "nobody can approve a worker's call in this session",
  subagent: "a sub-agent has nobody to ask",
  self: "it started by itself, and nobody is asked for it",
});
/** Why one is refused while the worker's question to its lead waits (TG2-D49), as the record says it. */
const LEAD_ASK_WAITS = "its question to its lead waits for its answer";

/**
 * How a sub-agent's agent asks (HarnessV3-ACP AC6-1). A permission the session's switch asks about waits for the
 * developer as a loop worker's call does — on its lead's timeline, answered there, the switch's move judging it again —
 * where the session's page can answer (`asks`: a team's worker, and a sub-agent the developer launched themselves);
 * elsewhere, for a sub-agent the session's agent launched and for one that started by itself, it is refused in the
 * loop's words. Anything else it
 * asks has nobody to answer it mid-task: a question is skipped, a link declined. Its lead answers it too (`by`,
 * HarnessV3-TaskGraph-v2 TG2-D41). The agent hears a no as a reject alone, so the words of one — the developer's or its
 * lead's — are told (`tell`), for the turn to say to it at its next step.
 * @param {{ ask: (id: string, q: import("./agent/loop.js").AskedCall, o?: { signal?: AbortSignal | null }) => Promise<import("./agent/loop.js").AskAnswer | null> }} registry
 * @param {WorkerHost} host
 * @param {((words: string, from: string) => void) | null} [tell]
 * @returns {import("../adapters/agents/turn-bridge.js").Asker}
 */
export function workerAsker(registry, host, tell = null) {
  return async (form, _id, signal) => {
    const j = form.judged;
    if (!j) return nobodyAnswer(form) ?? { outcome: "cancelled" };
    if (!host.asks) {
      const who = unansweredAs(host);
      return permission(unattendedAsk(j.tool, null, who), NOBODY_TO_ASK[who]);
    }
    // What it would do, on one line as the loop's worker shows a call: the command, or the files it changes.
    const what = j.command || [...j.changes.map((c) => c.file), ...(j.changesLeft ? [`${j.changesLeft} more`] : [])].join(", ");
    // One its agent offers only to always allow says so where it is drawn: a yes keeps that grant in the agent.
    const reason = [j.reason, j.always ? ALWAYS_REASON : ""].filter(Boolean).join("; ");
    const a = await registry.ask(host.id, { tool: j.tool, args: clip(what, 160), question: form.title, ...(j.command ? { command: j.command } : {}), ...(reason ? { reason } : {}), ...(j.offer ? { offer: j.offer } : {}), ...(j.always ? { always: /** @type {const} */ (true) } : {}) }, { signal });
    if (!a) return null;
    // Its question to its lead waits (HarnessV3-TaskGraph-v2 TG2-D49): Filament says not now, nobody asked.
    if (a.by === "filament") {
      tell?.(a.text, SHIM);
      return permission(a.text, LEAD_ASK_WAITS);
    }
    if (a.modeSwitch) return { outcome: "switched" };
    if (a.allow === true) return permission(undefined, undefined, a.by);
    tell?.(deniedWords(j.tool, what, a.text, a.by), a.by === "lead" ? "lead" : "developer");
    return permission(a.text, undefined, a.by);
  };
}

/**
 * What a worker's agent is told of a no to a call it asked permission for, whose words it would not hear otherwise.
 * @param {string} tool @param {string} what  the command, or the files it changes @param {string} words @param {string} [by]
 */
export const deniedWords = (tool, what, words, by) =>
  `${by === "lead" ? "Your lead said" : "The developer said"} no to your ${tool} call${what ? ` (${clip(what, 160)})` : ""}, so it was not run: ${words}`;

/**
 * How a sub-agent's agent turn ended, in the registry's words (`HostFinish`): stopped by whoever stopped it, cut by a
 * hang-up, failed, or done — a turn its agent ended for its own budget (`max_tokens`, `max_turn_requests`) is
 * budget-stopped, one it refused or cancelled by itself failed.
 * @param {{ stopped: boolean, hungUp: boolean, stopReason: string | null }} o
 * @returns {"done" | "stopped" | "aborted" | "failed" | "budget-stopped"}
 */
export function workerStatus({ stopped, hungUp, stopReason }) {
  if (stopped) return "stopped";
  if (hungUp) return "aborted";
  if (stopReason === "refusal" || stopReason === "cancelled") return "failed";
  if (stopReason === "max_tokens" || stopReason === "max_turn_requests") return "budget-stopped";
  return "done";
}
