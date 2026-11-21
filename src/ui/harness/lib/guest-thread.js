// @ts-check
// A coding agent's own agent, read out of its turn's run (HarnessV4_Tasks E15 step 5, AG-153). Claude Code, Codex and
// Cursor start agents of their own. Filament launched none of them and holds no conversation of theirs: it has what
// the coding agent's turn said of each on its run — that it began (`subagent-start`), its calls (`subagent-tool-start`
// and `-end`), its plan, what it wrote as it wrote it (`subagent-words`) and its end. Here, without a document, one
// such agent's part of that run becomes what a thread draws: who it is and how it stands, and its work as rounds — a
// message's thinking and words, then the calls that followed — in the shapes a run of Filament's own agent has
// (`round-start`, `round-thinking`, `round-text`, `tool-start`, `tool-end`, `plan`, and the words as they stream), so
// the part that draws an agent's thread draws this one too (subagent-viewer.js). Its own agents stay calls on it.

/**
 * What a thread is handed for one of the run's events: an event of its rounds, or a frame of the words as they stream
 * (lib/stream.js `applyWords`).
 * @typedef {{ event: any } | { words: { piece: { block: number, type: "thinking" | "text", text: string } } }} ThreadItem
 */
/**
 * The agent as its run tells it. `known`: the run said it began; `of`: the coding agent whose it is, "" where the run
 * names none; `agent`: the kind its agent gives it; `status` aborted: its run ended with no word of its end.
 * @typedef {{ known: boolean, of: string, description: string, agent: string, model: string, prompt: string,
 *   status: "running" | "done" | "failed" | "stopped" | "aborted", startedAt: number, endedAt: number | null,
 *   ms: number | null, toolCalls: number, tokens: number | null, report: string, error: string }} GuestFacts  `tokens`:
 *   what it holds, as its agent last said (`subagent-held`), null where it said none
 */

/** An agent's end as its run says it (`subagent-end`'s status), as the thread's. */
const ENDED = /** @type {Record<string, GuestFacts["status"]>} */ ({ done: "done", stopped: "stopped", "budget-stopped": "stopped", aborted: "aborted", failed: "failed" });

/** A thread's id for one of them: its turn's run and its card there (app/agent-guests.js). @param {string} run @param {string} stub */
export const guestId = (run, stub) => `${run}~${stub}`;
/**
 * The run and the card a thread's id names, or null for the id of an agent of Filament's own.
 * @param {string} id @returns {{ run: string, stub: string } | null}
 */
export function guestOf(id) {
  const at = String(id || "").indexOf("~");
  return at > 0 && at < id.length - 1 ? { run: id.slice(0, at), stub: id.slice(at + 1) } : null;
}

/**
 * Whose agent a thread is, as a name: the coding agent's, as its run names it.
 * @param {string} of
 */
export const guestOwner = (of) => of || "The coding agent";

/**
 * Why its thread has no box (AG-153, AG-155): it is its coding agent's to continue and to stop.
 * @param {string} of @param {boolean} running
 */
export function guestWhy(of, running) {
  const who = guestOwner(of);
  return running
    ? `${who}'s own agent: ${who} continues it, and it stops with the main agent's turn. To change what it does, tell the main agent.`
    : `${who}'s own agent: only ${who} can ask it more. To go on with its work, tell the main agent.`;
}

/**
 * One of a coding agent's own agents, followed through its turn's run.
 * @param {string} stub  its card's id on that run (`subagent-*` events' `parent`)
 */
export function guestThread(stub) {
  /** @type {GuestFacts} */
  const facts = { known: false, of: "", description: "", agent: "", model: "", prompt: "", status: "running", startedAt: 0, endedAt: null, ms: null, toolCalls: 0, tokens: null, report: "", error: "" };
  let round = 0;
  /** How many blocks of words streamed so far: the next one's place. */
  let blocks = 0;
  /**
   * The round being written: the message its words belong to, where each kind's block stands among the streamed ones
   * (-1: none yet), the words so far, and whether they are over — a call followed them.
   * @type {{ msg: string, thinking: number, text: number, thought: string, said: string, closed: boolean } | null}
   */
  let cur = null;
  /** The round each of its calls began in. @type {Map<string, number>} */
  const callRound = new Map();
  /** When the run ended, where it said. @type {number | null} */
  let runEndedAt = null;

  /** @returns {ThreadItem} */
  const begin = () => {
    round++;
    cur = { msg: "", thinking: -1, text: -1, thought: "", said: "", closed: false };
    return { event: { type: "round-start", round, blocksBefore: blocks } };
  };
  /** The round's words are over: they go whole, as a run's log has a round's. @returns {ThreadItem[]} */
  const closeWords = () => {
    if (!cur || cur.closed) return [];
    cur.closed = true;
    return [
      ...(cur.thought ? [{ event: { type: "round-thinking", round, thinking: cur.thought } }] : []),
      ...(cur.said ? [{ event: { type: "round-text", round, text: cur.said } }] : []),
    ];
  };

  return {
    facts: () => facts,
    /** The run it is read from, as its stream names it. @param {any} run */
    run(run) {
      facts.of = String(run?.meta?.agent || "");
      if (run?.endedAt != null) runEndedAt = Number(run.endedAt) || null;
    },
    /**
     * One of the run's events: what the thread draws of it — nothing, for an event that is not this agent's.
     * @param {any} e @returns {ThreadItem[]}
     */
    take(e) {
      if (e?.type === "run-end") {
        runEndedAt = Number(e.ts) || runEndedAt;
        return [];
      }
      if (!e || String(e.parent || "") !== stub) return [];
      switch (e.type) {
        case "subagent-start":
          if (facts.known) return [];
          Object.assign(facts, { known: true, description: String(e.description || ""), agent: String(e.agent || ""), model: String(e.model || ""), prompt: String(e.prompt || ""), startedAt: Number(e.ts) || 0 });
          return [];
        case "subagent-words": {
          const kind = e.thinking ? "thinking" : "text";
          const msg = String(e.msg || "");
          const piece = String(e.text || "");
          if (!piece) return [];
          /** @type {ThreadItem[]} */
          const out = [];
          // Another message's words, words after a call, and thinking after words each begin the next round.
          if (!cur || cur.closed || (msg && cur.msg && msg !== cur.msg) || (kind === "thinking" && cur.text >= 0)) out.push(...closeWords(), begin());
          const now = /** @type {NonNullable<typeof cur>} */ (cur);
          if (msg) now.msg = msg;
          if (now[kind] < 0) now[kind] = blocks++;
          if (kind === "thinking") now.thought += piece;
          else now.said += piece;
          out.push({ words: { piece: { block: now[kind], type: kind, text: piece } } });
          return out;
        }
        case "subagent-tool-start": {
          /** @type {ThreadItem[]} */
          const out = cur ? closeWords() : [begin()];
          /** @type {NonNullable<typeof cur>} */ (cur).closed = true;
          facts.toolCalls++;
          callRound.set(String(e.id), round);
          out.push({ event: { ...e, type: "tool-start", round } });
          return out;
        }
        case "subagent-tool-end": {
          const began = callRound.get(String(e.id));
          return began == null ? [] : [{ event: { ...e, type: "tool-end", round: began } }];
        }
        case "subagent-held":
          if (Number(e.tokens) > 0) facts.tokens = Number(e.tokens);
          return [];
        case "subagent-plan":
          return [...(cur ? [] : [begin()]), { event: { type: "plan", round, items: Array.isArray(e.items) ? e.items : [] } }];
        case "subagent-end": {
          const out = closeWords();
          const endedAt = Number(e.ts) || null;
          Object.assign(facts, {
            status: ENDED[String(e.status)] || (e.ok ? "done" : "failed"),
            endedAt,
            ms: Number.isFinite(Number(e.ms)) ? Number(e.ms) : endedAt != null ? Math.max(0, endedAt - facts.startedAt) : null,
            ...(Number.isInteger(e.toolCalls) ? { toolCalls: e.toolCalls } : {}),
            ...(e.model && !facts.model ? { model: String(e.model) } : {}),
            report: String(e.report || ""),
            error: String(e.error || ""),
          });
          return out;
        }
        default:
          return [];
      }
    },
    /**
     * The run's end was reached: an agent it left open was cut off with it. A paused run's stays running, as its
     * card does.
     * @param {string} status  how the run ended @returns {ThreadItem[]}
     */
    over(status) {
      if (!facts.known || facts.status !== "running" || status === "paused") return [];
      const out = closeWords();
      const endedAt = runEndedAt;
      Object.assign(facts, { status: "aborted", endedAt, ms: endedAt != null ? Math.max(0, endedAt - facts.startedAt) : null });
      return out;
    },
  };
}
