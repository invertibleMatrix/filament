// @ts-check
// A coding agent's own agents, as rows of the session's list (HarnessV4_Tasks E15 step 5; E12 step 3, V4-D280).
// Claude Code, Codex and Cursor start agents of their own — Claude's Agent tool, Codex's child thread, Cursor's task.
// Filament did not launch them and holds none of their conversation: it hears of them through the coding agent's turn,
// whose run keeps what it heard (app/agent-run.js: `subagent-start`, their calls, their words, `subagent-end`). This
// reads them back out of those runs, so the Sub Agents tab lists them beside Filament's own, under whose they are. A guest
// has a row and a thread to read; it takes no follow-up, no stop of its own and no apply, and it never counts toward
// the session's limit: all of that is its agent's.
//
// A run that ended says the same for good, so its rows are folded once and remembered; a running one is folded on at
// each look, from the event it was last read to. The newest GUESTS_KEPT are listed, from the session's newest
// GUEST_TURNS turns (AG-152): a run is kept for its retention days, and a guest goes with its turn's run.

/** How many of a session's guests are listed, the newest first. */
export const GUESTS_KEPT = 30;
/** How many of the session's newest turns are looked at for them. */
export const GUEST_TURNS = 50;
/** How many ended runs' rows are remembered. */
const REMEMBERED = 500;
/** How many of a run's events are read at once. */
const PAGE = 5000;

/**
 * @typedef {object} GuestRow
 * @property {string} id  the turn's run and the card it hangs off there, as `<run>~<stub>`
 * @property {true} guest
 * @property {string} of  the coding agent whose it is, as its run names it ("" where it names none)
 * @property {string} run  the turn's run: where its thread reads it
 * @property {string} stub  its card's id on that run (`subagent-*` events' `parent`)
 * @property {string} description
 * @property {string} agent  the kind its agent gives it (Cursor's explore, Claude's Explore), "" where none
 * @property {string} model  "" where its agent names none
 * @property {string} prompt  what it was told, as the run kept it
 * @property {"running" | "done" | "failed" | "stopped" | "aborted"} status  aborted: its run ended, or was cut, with
 *   no word of its end
 * @property {number} startedAt
 * @property {number | null} endedAt
 * @property {number | null} ms
 * @property {number} toolCalls
 * @property {number | null} tokens  what it holds, as its agent last said (`subagent-held`); null where it said none
 * @property {string} report  its last words, "" while it works or where it said none
 * @property {string} error
 */

/** A sub-agent's end as the run says it (`subagent-end`'s status), as a guest row's status. */
const ENDED = /** @type {Record<string, GuestRow["status"]>} */ ({ done: "done", stopped: "stopped", "budget-stopped": "stopped", aborted: "aborted", failed: "failed" });

/** @typedef {{ id: string, kind?: string, status?: string, endedAt?: number | null, meta?: any }} GuestRun */

/** Whether a run is over: ended, and not only paused. @param {GuestRun} run */
const isOver = (run) => run.endedAt != null && run.status !== "paused" && run.status !== "running";

/**
 * More of a run's events, onto the rows they tell of: each `subagent-start` that names no agent of Filament's own
 * (`agentId`) begins one, the calls under it are counted, and its end closes it.
 * @param {Map<string, GuestRow>} rows  by stub, in the order they began
 * @param {GuestRun} run @param {readonly Record<string, any>[]} events
 */
function fold(rows, run, events) {
  const of = String(run.meta?.agent || "");
  for (const e of events) {
    const stub = String(e.parent || "");
    if (e.type === "subagent-start") {
      if (e.agentId || !stub || rows.has(stub)) continue;
      rows.set(stub, {
        id: `${run.id}~${stub}`,
        guest: true,
        of,
        run: run.id,
        stub,
        description: String(e.description || ""),
        agent: String(e.agent || ""),
        model: String(e.model || ""),
        prompt: String(e.prompt || ""),
        status: "running",
        startedAt: Number(e.ts) || 0,
        endedAt: null,
        ms: null,
        toolCalls: 0,
        tokens: null,
        report: "",
        error: "",
      });
      continue;
    }
    const row = rows.get(stub);
    if (!row) continue;
    if (e.type === "subagent-tool-start") row.toolCalls++;
    else if (e.type === "subagent-held") row.tokens = Number(e.tokens) > 0 ? Number(e.tokens) : row.tokens;
    else if (e.type === "subagent-end") {
      row.status = ENDED[String(e.status)] || (e.ok ? "done" : "failed");
      row.endedAt = Number(e.ts) || null;
      row.ms = Number.isFinite(Number(e.ms)) ? Number(e.ms) : row.endedAt != null ? Math.max(0, row.endedAt - row.startedAt) : null;
      if (Number.isInteger(e.toolCalls)) row.toolCalls = e.toolCalls;
      if (e.model && !row.model) row.model = String(e.model);
      row.report = String(e.report || "");
      row.error = String(e.error || "");
    }
  }
}

/**
 * The rows as they stand, oldest first, each a copy. One the run's end left open is aborted; a paused run's stay
 * running, as its cards do.
 * @param {Map<string, GuestRow>} rows @param {GuestRun} run
 * @returns {GuestRow[]}
 */
function standing(rows, run) {
  const endedAt = isOver(run) ? Number(run.endedAt) || null : null;
  return [...rows.values()].map((row) =>
    isOver(run) && row.status === "running" ? { ...row, status: /** @type {const} */ ("aborted"), endedAt, ms: endedAt != null ? Math.max(0, endedAt - row.startedAt) : null } : { ...row });
}

/**
 * The guests one coding agent's turn started, oldest first, as its run's events tell them.
 * @param {GuestRun | null} run @param {readonly Record<string, any>[]} events
 * @returns {GuestRow[]}
 */
export function guestsOfRun(run, events) {
  if (!run || run.kind !== "coding-agent") return [];
  /** @type {Map<string, GuestRow>} */
  const rows = new Map();
  fold(rows, run, events);
  return standing(rows, run);
}

/**
 * The session's guests, read from its turns' runs.
 * @param {object} o
 * @param {{ getRun: (id: string) => any, events: (id: string, o?: { since?: number, limit?: number }) => { run: any, events: any[] } | null, hasRun: (id: string) => boolean }} o.runs
 * @param {(chainId: string, limit: number) => string[]} o.turnRuns  the session's newest turns' runs, newest first
 * @returns {{ list: (chainId: string) => GuestRow[] }}
 */
export function createGuests({ runs, turnRuns }) {
  /** An ended run's rows: it says the same for good. @type {Map<string, GuestRow[]>} */
  const ended = new Map();
  /** A running run's rows so far, and the last of its events folded into them. @type {Map<string, { last: number, rows: Map<string, GuestRow> }>} */
  const open = new Map();
  /** @param {string} runId @returns {GuestRow[]} */
  const ofRun = (runId) => {
    const known = ended.get(runId);
    if (known) return known;
    if (!runs.hasRun(runId)) return [];
    const meta = runs.getRun(runId);
    if (!meta) return [];
    /** @type {GuestRow[]} */
    let rows = [];
    if (meta.kind === "coding-agent") {
      const state = open.get(runId) || { last: 0, rows: new Map() };
      for (;;) {
        const events = runs.events(runId, { since: state.last, limit: PAGE })?.events || [];
        fold(state.rows, meta, events);
        if (events.length) state.last = Number(events[events.length - 1].n) || state.last;
        if (events.length < PAGE) break;
      }
      open.set(runId, state);
      rows = standing(state.rows, meta);
    }
    if (isOver(meta)) {
      open.delete(runId);
      if (ended.size >= REMEMBERED) ended.delete(/** @type {string} */ (ended.keys().next().value));
      ended.set(runId, rows);
    }
    return rows;
  };
  return {
    list(chainId) {
      /** @type {GuestRow[]} */
      const out = [];
      for (const runId of turnRuns(chainId, GUEST_TURNS)) {
        // A turn's own are oldest first; the list is newest first.
        out.push(...[...ofRun(runId)].reverse());
        if (out.length >= GUESTS_KEPT) break;
      }
      return out.slice(0, GUESTS_KEPT);
    },
  };
}
