// @ts-check
// A coding agent's own tasks while they run (HarnessV4_Tasks U1; HarnessV3-FailurePoints §5.1 item 2, §14.3): the
// sub-agents, shells and workflows Claude starts beside its work — some in the background, running on after its turn
// ended, when the chat looks idle. The server says the whole list at every change (`agent-tasks` on the events feed,
// with the chat's id) and with the transcript (`agentTasks`), so a page that opens the chat later has it too; the status
// panel lists them (conversation/status-panel.js), each sub-agent its agent lets Filament stop alone with its Stop
// (HarnessV4_Tasks E6). Pure: the rows' words.

/**
 * A task as the server says it (adapters/agents/acp/bridge.js `AgentTask`).
 * @typedef {{ id: string, kind: string, description: string, background: boolean, call: string | null,
 *   subagent: string | null, since: number, tokens: number | null, tools: number | null, lastTool: string | null,
 *   summary: string | null, stop?: boolean }} AgentTask
 */

/** A task's kind in a word; a kind this page does not know reads as its SDK names it, spaced. */
const KIND_WORDS = /** @type {Record<string, string>} */ ({ local_agent: "agent", local_bash: "shell", local_workflow: "workflow", remote_agent: "remote agent" });

/** How long ago, short: "just now", "4m", "2h". @param {number} ms */
const since = (ms) => {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
};

/** A token count, short: "840", "12.3k". @param {number} n */
const short = (n) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`);

/**
 * The tasks as rows, the oldest first: what each is (its description, else its kind), the facts of it — its kind and
 * the sub-agent's type, whether it runs in the background, what it has used so far and its last tool — how long it
 * has run, and its own words on how it goes; whether Filament can stop it alone (`stop`).
 * @param {AgentTask[] | null | undefined} tasks @param {number} now
 * @returns {{ id: string, name: string, meta: string, age: string, said: string, stop: boolean }[]}
 */
export function agentTaskRows(tasks, now) {
  return [...(Array.isArray(tasks) ? tasks : [])]
    .sort((a, b) => (Number(a.since) || 0) - (Number(b.since) || 0))
    .map((t) => {
      const kind = KIND_WORDS[t.kind] || String(t.kind || "task").replace(/_/g, " ");
      const tokens = Number(t.tokens) || 0;
      const tools = Number(t.tools) || 0;
      return {
        id: String(t.id),
        name: String(t.description || "").replace(/\s+/g, " ").trim() || kind,
        meta: [
          t.subagent && t.kind === "local_agent" ? `${kind} (${t.subagent})` : kind,
          t.background ? "in the background" : "",
          tokens ? `${short(tokens)} tokens` : "",
          tools ? `${tools} tool call${tools === 1 ? "" : "s"}` : "",
          t.lastTool ? `last: ${t.lastTool}` : "",
        ].filter(Boolean).join(" · "),
        age: Number(t.since) > 0 ? since(now - Number(t.since)) : "",
        said: String(t.summary || "").replace(/\s+/g, " ").trim(),
        stop: t.stop === true,
      };
    });
}

/** The capsule's word for them: "2 tasks running"; "" for none. @param {AgentTask[] | null | undefined} tasks */
export const agentTasksWord = (tasks) => {
  const n = Array.isArray(tasks) ? tasks.length : 0;
  return n ? `${n} task${n === 1 ? "" : "s"} running` : "";
};
