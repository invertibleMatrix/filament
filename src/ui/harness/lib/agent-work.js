// @ts-check
// Your agent's own work, drawn as a flow (HarnessV4_OneAgent_Plan L47, §16; the owner's word of 10-23: "A flow view of
// what your main agent did with its sub-agents on its own. this needs to be done. do it"). The agents your main agent
// sent off by itself — the task graph's tasks with them, and a coding agent's own agents — as a flow's steps: a step is
// what one reply of your agent sent, side by side; a step below came later, and its line says what had happened by
// then. Here, without a document: the boxes from the chat's threads, the steps, their lines, the totals and the words
// the Agents tab's row and the pane's head say. It is a picture of what happened: nothing here runs or acts
// (L47-D1). The pane is views/agent-work.js.
import { prettyModel } from "./families.js";
import { formatWorkedFor } from "./labels.js";
import { yourAsk } from "./team.js";
import { lineOf, money } from "./flow.js";

/** The Agents tab's row for your agent's own work: a team's part of the list (lib/side.js `isTeamItem`), its pane the picture. */
export const WORK_ITEM = "team:work";
/** How close together two launches with no recorded reply start to stand side by side (L47-D5). */
export const TOGETHER_MS = 3_000;
/** How many steps show before the earlier ones fold. */
export const STEPS_SHOWN = 12;

/** @typedef {"working" | "asking" | "done" | "failed" | "stopped" | "cut"} WorkState */
/**
 * One ask your agent made of one agent: its thread (`thread`) and which exchange of it (`n`, from 1); its card's tag
 * (none for a coding agent's own), a graph task's id, whose own agent it is where a coding agent's (`of`); what it was
 * asked in a line (`task`) and as the list carries it (`asked`), its answer or why it has none; the reply that sent it
 * (`run`, `round`), null where none was recorded; `cut`: the list carries its asking or its answer clipped (the list's
 * heads, `publicOf` `head`), read whole where the box is picked.
 * @typedef {{ id: string, thread: string, n: number, name: string, tag: string, task: string, graph: string | null, of: string | null,
 *   asked: string, answer: string, error: string, state: WorkState, model: string, startedAt: number, endedAt: number | null,
 *   usd: number, run: string | null, round: number | null, cut: boolean }} WorkBox
 */
/**
 * A step: the boxes one reply sent, side by side, and the line that says what had happened before it.
 * @typedef {{ boxes: WorkBox[], run: string | null, round: number | null, why: string }} WorkStep
 */
/**
 * The picture: its steps, oldest first; how many agents and asks; how many at work and asking you now; what it cost.
 * @typedef {{ steps: WorkStep[], agents: number, asks: number, working: number, asking: number, usd: number }} Work
 */

/** Each state's badge, in the flow's colours. @type {Readonly<Record<WorkState, { cls: string, words: string }>>} */
export const WORK_BADGE = Object.freeze({
  working: { cls: "is-running", words: "At work" },
  asking: { cls: "is-asking", words: "Asks you" },
  done: { cls: "is-done", words: "Done" },
  failed: { cls: "is-failed", words: "Failed" },
  stopped: { cls: "is-stopped", words: "Stopped" },
  cut: { cls: "is-stopped", words: "Cut off" },
});

/** "2nd", "3rd", "11th". @param {number} n */
const ordinal = (n) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${tail}`;
};
/** An ended exchange's state. @param {string} status @returns {WorkState} */
const endedState = (status) => (status === "done" ? "done" : status === "failed" ? "failed" : status === "aborted" ? "cut" : "stopped");
/** The reply a kept exchange names, or nulls. @param {any} v */
const sentOf = (v) => (v && typeof v.run === "string" && v.run ? { run: v.run, round: Number.isInteger(v.round) ? v.round : null } : { run: null, round: null });

/**
 * The boxes: each ask your agent made — an exchange by "agent" of a thread no team runs (L47-D4); one of yours, one that
 * started by itself and a flow's box are not its own — and each of a coding agent's own agents.
 * @param {readonly import("./subagents.js").SubagentRow[]} rows @param {readonly import("./subagents.js").GuestRow[]} own
 * @returns {WorkBox[]}
 */
export function workBoxes(rows, own) {
  /** @type {WorkBox[]} */
  const out = [];
  for (const r of rows) {
    if (r.team) continue;
    const name = String(r.card?.name || r.description || "Agent");
    r.exchanges.forEach((x, i) => {
      if (x.by !== "agent") return;
      const live = x.status === "running" && r.status === "running";
      const sent = sentOf(x.sentIn);
      out.push({
        id: `${r.id}#${i}`,
        thread: r.id,
        n: i + 1,
        name: i ? `${name} · ${ordinal(i + 1)} ask` : name,
        tag: String(r.card?.tag || ""),
        task: lineOf(x.description || r.description, 120),
        graph: r.task || null,
        of: null,
        asked: String(x.prompt || ""),
        answer: live ? "" : String(x.report || ""),
        error: live ? "" : String(x.error || x.failure?.head || ""),
        state: live ? (yourAsk(r.progress) ? "asking" : "working") : endedState(x.status),
        model: String(r.model || ""),
        startedAt: Number(x.startedAt) || 0,
        endedAt: live ? null : x.endedAt ?? null,
        usd: live ? Number(r.progress?.spent) || 0 : Number(x.spentUsd) || 0,
        run: sent.run,
        round: sent.round,
        cut: !!x.promptHead || (!live && !!x.reportHead),
      });
    });
  }
  for (const g of own) {
    const live = g.status === "running";
    out.push({
      id: g.id,
      thread: g.id,
      n: 1,
      name: String(g.agent || "Agent"),
      tag: "",
      task: lineOf(g.description, 120),
      graph: null,
      of: String(g.of || "its coding agent"),
      asked: String(g.prompt || ""),
      answer: live ? "" : String(g.report || ""),
      error: live ? "" : String(g.error || ""),
      state: live ? "working" : endedState(g.status),
      model: String(g.model || ""),
      startedAt: Number(g.startedAt) || 0,
      endedAt: live ? null : g.endedAt ?? null,
      usd: 0,
      run: g.run || null,
      round: null,
      cut: false,
    });
  }
  return out;
}

/**
 * Whether a box stands beside a step's (L47-D2, D5): the same reply where both name one; with neither naming its round,
 * the same turn (or none), started within `TOGETHER_MS` of the step's first box, and nothing of the step ended before it.
 * @param {WorkStep} step @param {WorkBox} b
 */
const together = (step, b) => {
  if (b.round != null || step.round != null) return b.round === step.round && b.run === step.run;
  if (b.run !== step.run) return false;
  return b.startedAt - step.boxes[0].startedAt <= TOGETHER_MS && !step.boxes.some((x) => x.endedAt != null && x.endedAt <= b.startedAt);
};

/** Some parts in a line: "a", "a and b", "a, b and c". @param {string[]} parts */
const andOf = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "");
/** Names in a line, three at most: "Reviewer", "Reviewer and Builder", "Reviewer, Builder and 2 more". @param {string[]} names */
const namesOf = (names) => {
  const u = [...new Set(names)];
  return u.length <= 3 ? andOf(u) : `${u.slice(0, 2).join(", ")} and ${u.length - 2} more`;
};
/** How an ended box ended, as a step's line says it. @param {WorkState} s */
const endVerb = (s) => (s === "done" ? "answered" : s === "failed" ? "failed" : s === "cut" ? "was cut off" : "stopped");

/**
 * What had happened before a step (L47-D2), true by the clock: your message, where it is the first of its turn; else
 * which boxes of the step above ended before it started, and which earlier ones of its turn still worked.
 * @param {WorkStep[]} steps @param {number} i @param {Map<string, { n: number, text: string }>} turns
 */
function whyOf(steps, i, turns) {
  const step = steps[i];
  const start = step.boxes[0].startedAt;
  const prev = steps[i - 1];
  const turn = step.run ? turns.get(step.run) : null;
  if (!prev || (step.run && prev.run !== step.run)) {
    if (turn) return `After your message ${turn.n}: “${lineOf(turn.text, 80)}”`;
    return prev ? "Later, in another turn" : "";
  }
  const ended = prev.boxes.filter((x) => x.endedAt != null && x.endedAt <= start);
  const still = steps.slice(0, i).flatMap((s) => s.boxes).filter((x) => x.startedAt < start && (x.endedAt == null || x.endedAt > start));
  /** @type {string[]} */
  const parts = [];
  if (ended.length) {
    const verbs = [...new Set(ended.map((x) => endVerb(x.state)))];
    parts.push(verbs.length === 1 ? `${namesOf(ended.map((x) => x.name))} ${verbs[0]}` : andOf(ended.map((x) => `${x.name} ${endVerb(x.state)}`)));
  }
  const after = parts.length ? `After ${parts[0]}` : "";
  const during = still.length ? `${namesOf(still.map((x) => x.name))} still worked` : "";
  if (after && during) return `${after}, while ${during}`;
  if (during) return `While ${during}`;
  return after || "Later";
}

/**
 * The picture (HarnessV4_OneAgent_Plan L47): the boxes in steps, oldest first, each step with its line, and the totals.
 * @param {{ rows: readonly import("./subagents.js").SubagentRow[], own?: readonly import("./subagents.js").GuestRow[],
 *   turns?: readonly { runId?: string | null, n?: number, userText?: string }[] }} o  `turns`: the chat's turns, which
 *   name your message a step's reply answered
 * @returns {Work}
 */
export function workOf({ rows, own = [], turns = [] }) {
  const boxes = workBoxes(rows, own).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  /** @type {WorkStep[]} */
  const steps = [];
  for (const b of boxes) {
    const same = b.round != null ? steps.find((s) => s.round === b.round && s.run === b.run) : null;
    const last = steps.at(-1);
    if (same) same.boxes.push(b);
    else if (last && together(last, b)) last.boxes.push(b);
    else steps.push({ boxes: [b], run: b.run, round: b.round, why: "" });
  }
  /** @type {Map<string, { n: number, text: string }>} */
  const byRun = new Map();
  turns.forEach((t, i) => {
    if (t?.runId) byRun.set(String(t.runId), { n: Number(t.n) || i + 1, text: String(t.userText || "") });
  });
  steps.forEach((_, i) => {
    steps[i].why = whyOf(steps, i, byRun);
  });
  return {
    steps,
    agents: new Set(boxes.map((b) => b.thread)).size,
    asks: boxes.length,
    working: boxes.filter((b) => b.state === "working" || b.state === "asking").length,
    asking: boxes.filter((b) => b.state === "asking").length,
    usd: boxes.reduce((n, b) => n + b.usd, 0),
  };
}

/**
 * The picture in a line, for the Agents tab's row and the pane's head: "3 agents in 2 steps · 1 at work · $0.04"; null
 * where your agent sent none (L47 case 10).
 * @param {Work} w @returns {string | null}
 */
export function workWords(w) {
  if (!w.asks) return null;
  const agents = `${w.agents} agent${w.agents === 1 ? "" : "s"}`;
  const asks = w.asks > w.agents ? `, ${w.asks} asks` : "";
  const steps = `${w.steps.length} step${w.steps.length === 1 ? "" : "s"}`;
  return [`${agents}${asks} in ${steps}`, w.asking ? `${w.asking} ${w.asking === 1 ? "asks" : "ask"} you` : "", w.working > w.asking ? `${w.working - w.asking} at work` : "", money(w.usd)].filter(Boolean).join(" · ");
}

/**
 * A box's line under its name: its model, how long it took or has run, what it cost — "GLM-5.3 Flash · 2m 4s · $0.03".
 * @param {WorkBox} b @param {number} now
 */
export function boxWords(b, now) {
  const ms = (b.endedAt ?? now) - b.startedAt;
  return [b.model ? prettyModel(b.model) : "", b.startedAt ? formatWorkedFor(Math.max(0, ms)) : "", money(b.usd)].filter(Boolean).join(" · ");
}

/** Who sent a box, as its detail says it. @param {WorkBox} b */
export const sentWords = (b) => (b.of ? `${b.of}'s own agent` : b.graph ? `task ${b.graph} of your agent's graph` : "sent by your agent");
