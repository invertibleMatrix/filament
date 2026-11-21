// @ts-check
// Filament's copy of a coding agent's session follows the agent's own compactions (HarnessV4_Tasks C28). The agent
// holds its conversation in a session of its own and compacts it itself; Filament's copy of the chat is what a fresh
// agent session, or another model, starts from. Left alone, the copy keeps every turn while the agent's context starts
// over from a summary many times: the copy outgrows any window the agent ever filled. So where the agent hands its
// summary over as it compacts, the copy starts from that summary too — a compaction of the chat's, written with no
// model call: the summary as the copy's head, and the turn it fell in from the compaction on (`copyTurns`,
// compaction.js). The archive keeps every turn whole, for the page, the search and memory.
// Where the agent hands no summary over (Codex, Cursor; a session that held less than the chat), Filament writes the
// copy's summary itself, in the background (HarnessV4_Tasks C29: compactor.js `copy`); `copyBehind` says when.
import { compactionHead } from "./compaction.js";

/**
 * A coding agent compacted its own context in the middle of a turn and handed its summary over (`compacted`, as the
 * run kept it: app/agent-run.js): the chat's compaction that says so, its row's id. The summary stands for the turns
 * before this one, from where the copy started, and for this turn's work up to the compaction. The row moves no
 * session and is not one to undo (`madeDuring`). Null where there is no summary, or no such turn.
 * `blockAfter`: what comes back after it, as after a summary of Filament's (sessions/reattach.js `backAfterSummary`), of
 * the turns it stands for — kept with the row, for what starts from the copy: another model, or a
 * fresh session of the agent (the owner's of 11-08: after Claude's own summary none came back, its files, plan, task
 * graph and what was still open lost to the model the chat moved to).
 * @param {{ archive: any, chainId: string, turnId: number, by: string, model?: string | null,
 *   compacted: { summary: string, cutAfter: string | null, manual?: boolean, before?: number, after?: number, ms?: number },
 *   blockAfter?: ((toTurn: number, cut: { during: number, cutAfter: string | null, by: string }) => { text: string, files: readonly { shown: boolean }[], plan: boolean, graph?: boolean, tokens: number } | null) | null }} o
 * @returns {{ id: number } | null}
 */
export function followOwnCompaction({ archive, chainId, turnId, by, model = null, compacted, blockAfter = null }) {
  const text = String(compacted?.summary || "").trim();
  const turn = text ? archive?.getTurn?.(turnId) : null;
  const during = Number(turn?.n) || 0;
  if (!text || during < 1) return null;
  // Where the copy started: the head it stood on (a row with a summary; a preview no window adopted, door `now`, is none).
  /** @type {{ [k: string]: any, text: string | null }[]} */
  const rows = archive
    .getCompactions(chainId)
    .filter((/** @type {any} */ c) => c.detail?.door !== "now")
    .map((/** @type {any} */ c) => ({ ...c, text: c.summary_hash ? "" : null }));
  const head = compactionHead(rows);
  const { before = 0, after = 0, ms = 0 } = compacted;
  // Of the turns it stands for, as the row: the turn it fell in up to the compaction; from it on the copy keeps it, and
  // it says its own.
  const back = blockAfter ? blockAfter(during - 1, { during, cutAfter: compacted.cutAfter ?? null, by }) : null;
  const detail = { during, cutAfter: compacted.cutAfter ?? null, by, ...(before ? { before } : {}), ...(after ? { after } : {}), exact: true, ...(model ? { model } : {}), how: "agent-own", ...(ms ? { ms } : {}) };
  const { id } = archive.addCompaction(chainId, {
    fromTurn: head ? Number(head.from_turn) || 1 : 1,
    toTurn: during - 1,
    summaryText: text,
    kind: compacted.manual ? "manual" : "plain",
    window: "harness",
    method: "own",
    detail,
    attached: back?.text ? back : null,
  });
  return { id };
}

/**
 * Whether Filament's copy is behind the agent (HarnessV4_Tasks C29): the agent compacted its own context at a point the
 * copy's head has not reached, and handed no summary the copy could start from — in the middle of a turn (the turn's
 * `meta.ownCompaction`, which its run left: app/acp-turn.js), or on request, at the line (a row of the method own with
 * no text). The copy's own summary never takes the newest finished turn, so the copy has followed a compaction that
 * fell in or after turn N once its head reaches turn N − 1. `held`: the last turn of a summary the person stopped
 * (`chain.meta.copyHeld`) — nothing up to it asks again. The agent's name where the copy is behind, else null.
 * @param {{ turns: readonly { n: number, meta?: any }[], compactions: readonly any[], held?: number }} o
 * @returns {{ by: string | null } | null}
 */
export function copyBehind({ turns, compactions, held = 0 }) {
  const head = compactionHead(compactions);
  const from = Math.max(head ? Number(head.to_turn) || 0 : 0, Number(held) || 0);
  const turn = turns.findLast((t) => t.meta?.ownCompaction && t.n - 1 > from);
  // Asked of the rows past the copy's start alone: an earlier one's summary is never opened to know it had one.
  const row = compactions.findLast((c) => c.method === "own" && Number(c.to_turn) - 1 > from && c.text == null);
  if (!turn && !row) return null;
  return { by: String((turn ? turn.meta.ownCompaction.by : row.detail?.by) || "") || null };
}
