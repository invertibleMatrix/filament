// @ts-check
// The turns a restart cut off, kept (HarnessV4_Tasks A2). A turn's work reaches the archive at its end. One whose
// process died has no end: only its message stood in the archive, so the model's history, a compaction's summary, what
// memory learns and a fresh agent session's seed never saw what it did — and what its coding agent's context holds was
// read off the turn before it. Its run log has all of that. At start, as memory opens and before any request reads a
// session, each turn's run the last process left open gives its turn the work it logged (core/run-work.js) and a `cut`
// mark, then has its end written, so a later start finds nothing to do.
import { workOfRun } from "../../core/run-work.js";

/** How a run the last process left open ends: a turn's here, a sub-agent's in server.js. */
export const LEFT_OPEN = "Filament stopped before it finished (found open at the next start)";

/** The kinds of run a session's turn makes: Filament's loop's, a coding agent's. */
export const TURN_RUNS = Object.freeze(["agent-turn", "coding-agent"]);
/** The run log hands out a run's events this many at a time. */
const PAGE = 50_000;

/**
 * Every event of a run, oldest first.
 * @param {import("../../services/runs.js").RunLog} runs @param {string} id
 */
export function eventsOf(runs, id) {
  /** @type {any[]} */
  const all = [];
  for (let since = 0; ; ) {
    const page = runs.events(id, { since, limit: PAGE })?.events || [];
    all.push(...page);
    if (page.length < PAGE) return all;
    since = page[page.length - 1].n;
  }
}

/**
 * What a turn's `meta.cut` says (the archive keeps it; `app/sessions/shapes.js` and `agent-line.js` read it).
 * @typedef {object} CutMark
 * @property {string} run  the run whose log the work came from: the newest, where a retried turn was cut again
 * @property {number} at  that run's newest event: when the turn was last alive
 * @property {number} rounds  the rounds its log shows
 * @property {number} tools  its calls
 * @property {number} logged  the messages of the turn's work rebuilt from run logs; where any, the turn never rides raw
 * @property {{ upstream: string | null, tokens: number, window: number | null, exact: boolean }} [held]  a coding
 *   agent's newest count of what its context held, and whose agent it was; an earlier cut's where this run said none
 */

/**
 * Give each turn a restart cut off the work its run log holds, and write the end of every turn's run left open.
 *
 * A turn is one of them when the archive has it under the run's session (`meta.chain`) and request, the harness ran it
 * (an outside client's conversation is the client's own), a request still ran it when the process died (its
 * `running` mark, which makes it cut off: `cutOffBefore`), and it has no reply and no failure. Its rebuilt work
 * follows whatever the archive already holds of it: an earlier leg's, or an earlier cut's where the turn was retried
 * and cut again. A turn the archive could not be written for keeps its run open: the next start tries again, and a
 * message it had already written is not written twice (`addWork`).
 * @param {{ runs: import("../../services/runs.js").RunLog, archive: any, log?: (level: string, msg: string) => void, onKept?: ((k: KeptTurn) => void) | null, stop?: () => boolean }} deps
 *   `archive`: null where there is none — the runs are still ended. `onKept` hears each turn given its work: the turns
 *   Filament may go on with once memory has opened (resume-cut.js, HarnessV3-TaskGraph-v2 TG2-D83). `stop`: asked
 *   before each turn, true once no turn may be kept any more (the server's stop closing memory): the turns not kept
 *   stay open on disk, for the next start
 * @returns {Promise<{ kept: number, closed: number }>}  the turns given their work; the runs whose end was written
 */
export async function keepCutTurns({ runs, archive, log = () => {}, onKept = null, stop = () => false }) {
  let kept = 0;
  let closed = 0;
  for (const kind of TURN_RUNS)
    for (const o of await runs.openOnDisk(kind)) {
      if (stop()) return { kept, closed };
      try {
        const k = archive ? keep(runs, archive, o) : null;
        if (k) {
          kept++;
          onKept?.(k);
        }
      } catch (e) {
        log("warn", `sessions: the work of the turn a restart cut off (run ${o.id}) could not be kept: ${/** @type {any} */ (e)?.message || e}`);
        continue;
      }
      if (runs.closeOnDisk(o.id, { status: "aborted", summary: { error: LEFT_OPEN } })) closed++;
    }
  return { kept, closed };
}

/**
 * A turn given its work: its chat, its row, and the calls its run's log shows (a resumed turn cut again before it ran
 * one does not go on a second time, resume-cut.js).
 * @typedef {{ chainId: string, turnId: number, run: string, tools: number }} KeptTurn
 */

/**
 * One open run's turn, given its work and its mark; null where the run's turn is not one a restart cut off.
 * @param {import("../../services/runs.js").RunLog} runs @param {any} archive @param {import("../../services/runs.js").OpenRun} o
 * @returns {KeptTurn | null}
 */
function keep(runs, archive, o) {
  const turnId = archive.turnOfRequest(String(o.meta?.chain ?? ""), o.id);
  const turn = turnId == null ? null : archive.getTurn(turnId);
  const meta = turn?.meta || {};
  if (!turn || turn.final_hash || meta.window !== "harness" || !(Number(meta.running) > 0) || meta.failed) return null;
  const w = workOfRun(eventsOf(runs, o.id));
  archive.addWork(turnId, w.work);
  const held = w.held ? { upstream: o.meta?.upstream ? String(o.meta.upstream) : null, ...w.held } : meta.cut?.held;
  /** @type {CutMark} */
  const cut = { run: o.id, at: o.lastAt, rounds: w.rounds, tools: w.tools, logged: (Number(meta.cut?.logged) || 0) + w.work.length, ...(held ? { held } : {}) };
  archive.mergeTurnMeta(turnId, { cut });
  return { chainId: String(o.meta?.chain ?? ""), turnId, run: o.id, tools: w.tools };
}
