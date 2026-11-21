// @ts-check
// Overview's figures (proposal_ux §4.6, phase 4), pure: what a chat's turns, its session view and its agents add up to,
// for the tiles of Right now and This chat so far. No DOM, no fetch — the tiles (widgets/overview-*.js) draw what
// these say, and every figure is one the page already holds: a turn's facts (core/turn-facts.js), its tally of tool
// calls, its rows between turns (compactions, settings changes), the live turn's aligned run.
import { askWaitWords, callWords } from "./labels.js";
import { hitOf } from "../../lib/cache-facts.js";

/** The most columns a per-turn chart draws (§5.3 rule 4): older turns are grouped, so a year-long chat still fits. */
export const CHART_COLUMNS = 24;

/** The turns that ran on a model: a turn once its facts are written; a command Filament answered made no request. @param {readonly any[]} turns */
export const ranTurns = (turns) => (turns || []).filter((t) => t && t.facts && !t.command);

/**
 * A per-turn series folded to at most `max` columns (§5.3 rule 4): the newest turns one column each, and as many of
 * the oldest as it takes summed into groups ("turns 1–40"), so the chart keeps its width whatever the chat's age.
 * @param {readonly { n: number, value: number }[]} items  oldest first
 * @param {number} [max]
 * @returns {{ value: number, label: string, from: number, to: number }[]}
 */
export function foldColumns(items, max = CHART_COLUMNS) {
  const list = items.filter((i) => i && Number.isFinite(i.value));
  if (list.length <= max) return list.map((i) => ({ value: i.value, label: `turn ${i.n}`, from: i.n, to: i.n }));
  // The columns' turns, evenly: each group is `size` turns, the last groups one fewer where it does not divide.
  const size = Math.ceil(list.length / max);
  /** @type {{ value: number, label: string, from: number, to: number }[]} */
  const out = [];
  for (let at = 0; at < list.length; at += size) {
    const part = list.slice(at, at + size);
    const from = part[0].n;
    const to = part[part.length - 1].n;
    out.push({ value: part.reduce((s, i) => s + i.value, 0), label: from === to ? `turn ${from}` : `turns ${from}–${to}`, from, to });
  }
  return out;
}

/**
 * Activity (§4.6): the chat's turns, its main agent's rounds (a round is one model call of its loop: each call that
 * ran tools, and the one that answered), its tool calls and its failed requests, and the tool calls of each turn.
 * A turn read before its tally was kept counts no rounds or calls (`counted` says how many were).
 * @param {readonly any[]} turns
 * @returns {{ turns: number, rounds: number, calls: number, failed: number, counted: number, perTurn: { n: number, value: number }[] }}
 */
export function activityOf(turns) {
  const ran = ranTurns(turns);
  let rounds = 0, calls = 0, failed = 0, counted = 0;
  /** @type {{ n: number, value: number }[]} */
  const perTurn = [];
  for (const t of ran) {
    failed += Number(t.facts?.errors) || 0;
    const legs = Number(t.toolLegs);
    const made = Number(t.toolCalls);
    if (Number.isFinite(legs) && Number.isFinite(made)) {
      counted++;
      rounds += legs + 1;
      calls += made;
    }
    perTurn.push({ n: Number(t.n) || 0, value: Number.isFinite(made) ? made : 0 });
  }
  return { turns: ran.length, rounds, calls, failed, counted, perTurn };
}

/**
 * Tokens processed (§4.6): the session's own ledger (`settings.usage`, every request that booked on it) — read back
 * from the cache, written to it, new in and out — and how much of what was read came back from the cache: of the
 * requests whose usage said its cache numbers (lib/cache-facts.js), null where none did.
 * @param {any} usage  the session view's `settings.usage`, or null
 * @returns {{ total: number, cacheRead: number, cacheWrite: number, input: number, output: number, readShare: number | null, requests: number } | null}
 */
export function tokensOf(usage) {
  if (!usage) return null;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const input = Number(usage.input) || 0;
  const output = Number(usage.output) || 0;
  const read = cacheRead + cacheWrite + input;
  return { total: read + output, cacheRead, cacheWrite, input, output, readShare: hitOf(usage), requests: Number(usage.requests) || 0 };
}

/**
 * How models did (§4.6): each model that answered, with its calls, what it wrote and its failures — the main agent's
 * turns by the model each ran on (a coding agent that answered on several models names each, by what it wrote), then
 * the agents on the side by the model each ran on. Most calls first in each group.
 * @param {readonly any[]} turns
 * @param {readonly any[]} rows  the session's agents on the side (lib/subagents.js rows)
 * @returns {{ model: string, who: "agent" | "side", calls: number, output: number, failed: number }[]}
 */
export function modelsOf(turns, rows) {
  /** @type {Map<string, { model: string, who: "agent" | "side", calls: number, output: number, failed: number }>} */
  const by = new Map();
  /** @param {string} model @param {"agent" | "side"} who */
  const at = (model, who) => {
    const key = `${who}:${model}`;
    let m = by.get(key);
    if (!m) by.set(key, (m = { model, who, calls: 0, output: 0, failed: 0 }));
    return m;
  };
  for (const t of ranTurns(turns)) {
    const f = t.facts;
    const counted = Array.isArray(f.models) ? f.models.filter((/** @type {any} */ m) => m?.model) : [];
    if (counted.length) {
      for (const c of counted) at(String(c.model), "agent").output += Number(c.output) || 0;
      at(String(counted[0].model), "agent").calls += Number(f.calls) || 0;
      at(String(counted[0].model), "agent").failed += Number(f.errors) || 0;
      continue;
    }
    if (!f.model) continue;
    const m = at(String(f.model), "agent");
    m.calls += Number(f.calls) || 0;
    m.output += Number(f.tokens?.output) || 0;
    m.failed += Number(f.errors) || 0;
  }
  for (const r of rows || []) {
    const model = String(r?.model || "");
    if (!model) continue;
    const m = at(model, "side");
    m.calls += 1;
    if (r.status === "failed" || r.status === "aborted") m.failed += 1;
  }
  const list = [...by.values()];
  const byCalls = (/** @type {{ calls: number }} */ a, /** @type {{ calls: number }} */ b) => b.calls - a.calls;
  return [...list.filter((m) => m.who === "agent").sort(byCalls), ...list.filter((m) => m.who === "side").sort(byCalls)];
}

/**
 * The compactions the chat's turns hold (§4.6 Compactions), oldest first, each once: Compact now's and the line's,
 * a coding agent's own, Filament's copy — wherever the page placed its row.
 * @param {readonly any[]} turns
 * @returns {any[]}
 */
export function compactionsOf(turns) {
  /** @type {Map<string, any>} */
  const seen = new Map();
  for (const t of turns || [])
    for (const b of [...(t?.boundaries || []), ...(t?.compactions || []), ...(t?.boundariesAfter || [])])
      if (b?.type === "compaction") seen.set(String(b.id ?? `${b.fromTurn}-${b.toTurn}-${b.at}`), b);
  return [...seen.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}

/**
 * The chat's settings changes (§4.6 Changes to its settings), oldest first: each row between two turns where its
 * settings moved, with what moved where the operation log said it.
 * @param {readonly any[]} turns
 * @returns {{ at: number, changes: { path: string, to?: any }[] }[]}
 */
export function settingsChangesOf(turns) {
  /** @type {Map<string, { at: number, changes: { path: string, to?: any }[] }>} */
  const seen = new Map();
  for (const t of turns || [])
    for (const b of t?.boundaries || [])
      if (b?.type === "settings") seen.set(`${b.beforeTurn}:${b.to}`, { at: Number(b.at) || 0, changes: Array.isArray(b.changes) ? b.changes : [] });
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

/** The loop's states as This turn's chips name them, in the order a round goes through them. */
export const TURN_STATES = Object.freeze([
  { id: "waiting", words: "waiting" },
  { id: "planning", words: "thinking" },
  { id: "acting", words: "acting" },
  { id: "observing", words: "reading results" },
]);

/**
 * Whether a turn waits for the person — paused for their answer, or a question, a permission, a lead's plan of its
 * waiting —, its work not going on. One rule for what turns while a turn works: the transcript's plan card and This
 * turn's phase, which the status panel's Progress reads (the review of 67038d835: the card turned while the turn waited
 * for the person, the panel's did not).
 * @param {any} turn  a chat's turn
 */
export const waitsForYou = (turn) => !!(turn?.paused || turn?.aligned?.waiting?.length);

/**
 * This turn (§4.6): the chat's running turn — its round, when it started, the loop's state, the call running now —,
 * or the newest turn that ended, or nothing yet.
 * - `running`: a turn works; `asks`: it waits for your answer (a question, a permission); `failed`: the newest turn
 *   ended in an error (the API's words); `ended`: the newest turn ended well; `none`: no turn yet.
 * @param {any} chat  the open chat (state.js `Chat`)
 * @returns {{ phase: "running" | "asks" | "failed" | "ended" | "none", round: number, startedAt: number | null, endedAt: number | null,
 *   state: string | null, doing: string, asks: string, error: string, n: number }}
 */
export function turnNow(chat) {
  const live = chat?.live || null;
  const turn = live?.turn || null;
  if (turn) {
    const al = turn.aligned || null;
    const waiting = al?.waiting?.length ? al.waiting : null;
    // What it waits on, in the dock's words without their "below": a question, a permission, a lead's plan.
    const asks = waiting ? askWaitWords(waiting).replace(/, below$/, "") : turn.paused ? "Waiting for your answer" : "";
    const running = [...(al?.byRound?.values() || [])]
      .flatMap((c) => c.order.map((/** @type {string} */ id) => c.tools.get(id)))
      .filter((t) => t?.state === "running");
    return {
      phase: asks || waitsForYou(turn) ? "asks" : "running",
      round: Number(al?.maxRound) || (al?.byRound?.size ?? 0) || 1,
      startedAt: Number(live.startedAt || turn.startedAt) || null,
      endedAt: null,
      state: al?.turnState?.to || null,
      doing: running.length === 1 ? callWords(running[0]) : running.length > 1 ? `running ${running.length} tool calls` : "",
      asks,
      error: "",
      n: Number(turn.n) || 0,
    };
  }
  const last = [...(chat?.turns || [])].reverse().find((t) => t && !t.rewound && (t.facts || t.status === "error"));
  if (!last) return { phase: "none", round: 0, startedAt: null, endedAt: null, state: null, doing: "", asks: "", error: "", n: 0 };
  // A message stopped to ask before it was sent (its size, a cold cache, what the chat sends ahead changed, a switch:
  // history.js `stoppedToAsk`) failed nothing: its card waits for your answer.
  const b = last.status === "error" ? last.reply?.errorBody : null;
  const asked = !!(b?.switchQuestion || b?.resumeQuestion || b?.needsCompaction);
  const failed = last.status === "error" && !asked;
  return {
    phase: asked ? "asks" : failed ? "failed" : "ended",
    round: Number.isFinite(Number(last.toolLegs)) ? Number(last.toolLegs) + 1 : 0,
    startedAt: Number(last.startedAt ?? last.facts?.startedAt) || null,
    endedAt: Number(last.endedAt ?? last.facts?.endedAt) || null,
    state: null,
    doing: "",
    asks: asked ? "Waiting for your answer" : "",
    error: failed ? String(last.error || last.facts?.error || "it stopped with an error") : "",
    n: Number(last.n) || 0,
  };
}

/**
 * Agents for this chat (§4.6): how many work and how many ended, and the newest of those working (else the newest).
 * @param {readonly any[]} rows  the session's agents on the side, newest first
 */
export function agentsNow(rows) {
  const list = rows || [];
  const working = list.filter((r) => r?.status === "running");
  const done = list.filter((r) => r && r.status !== "running");
  return { working: working.length, done: done.length, newest: working[0] || list[0] || null };
}
