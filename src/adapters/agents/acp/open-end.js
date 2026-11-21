// @ts-check
// A turn its agent's adapter failed over calls left unanswered, though the agent had ended it (HarnessV4_Tasks B15).
//
// Claude's adapter (claude-agent-acp, `settleActive`) checks a turn that ended (`end_turn`) for calls it had sent on
// and heard no result of. It fails each such call, then the prompt: an internal error of kind `incomplete_tool_call`,
// "Claude ended the turn without returning results for tool calls: …". Work Claude left running behind its turn — its
// Workflow tool's, a background sub-agent's — is counted so, and a turn Claude had answered came back as a failure:
// its reply and its work dropped, a red error and a Retry over a finished answer (76 such calls on 2026-10-10).
//
// The turn's own thread tells the two apart. Where its last word is a reply, said after its newest call began, the
// agent ended its turn: the prompt is answered as ended, and the adapter's complaint is the turn's note. Where it
// ended on a call, with no reply after it, nothing answered the person, and the failure stands.

/** The kind Claude's adapter gives the failure. */
const OPEN_END = "incomplete_tool_call";

/**
 * One turn's reading of its thread, and its answer for a prompt the adapter failed that way.
 * @param {{ notes: string[], who: string }} o  the turn's notes; the agent's name
 */
export function createOpenEnd({ notes, who }) {
  let replied = false;
  /** The calls of the agent's own thread seen so far. @type {Set<string>} */
  const calls = new Set();
  return {
    /**
     * One event of the turn: the agent's own thread's words, and its calls as each begins. A sub-agent's are its own.
     * @param {any} ev
     */
    heard(ev) {
      if (!ev || ev.subagent || ev.parentToolCallId) return;
      if (ev.type === "text" && !ev.own && String(ev.text || "").trim()) replied = true;
      else if (ev.type === "tool" && ev.id && !calls.has(String(ev.id))) {
        calls.add(String(ev.id));
        replied = false;
      }
    },
    /**
     * The answer of a prompt that failed: its turn's end where the agent had ended it, else the failure, thrown on.
     * @param {any} e @returns {{ stopReason: "end_turn" }}
     */
    answer(e) {
      if (e?.data?.errorKind !== OPEN_END || !replied) throw e;
      const named = String(e.message || "").split(/tool calls?:/i)[1] || "";
      const n = named.split(",").filter((id) => id.trim()).length;
      notes.push(
        `acp: ${who}'s adapter failed this prompt after ${who} had answered: ${n ? `${n} tool call${n === 1 ? "" : "s"}` : "tool calls"} had no result when the turn ended, which is how it counts work left running behind a turn. The turn is kept as ${who} ended it, with its reply and its work; those calls read as the adapter closed them, and the turn's token counts are Filament's estimate, the failed prompt having carried none`,
      );
      return { stopReason: "end_turn" };
    },
  };
}
