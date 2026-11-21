// @ts-check
// A coding agent making room in its own session, asked by Filament: writing Filament's summary of it (HarnessV3-ACP
// AC5-4: Self), or compacting it its own way (AC5-5: own). The session service knows a session by its chain and its
// model; the agent's bridge knows a conversation by its upstream, its folder and its id — a harness chat's is
// `chain:<id>`, as the chat's turns name it (acp-turn.js). This asks the bridge the session's upstream runs on what its
// agent can do now, and has it do it.
import { findUpstream } from "../core/routing.js";

/**
 * A session's chat with its agent: the upstream it runs on, its chain, the folder its turns name, and the chat's newest
 * compaction (`base`), as its next turn names it.
 * @typedef {{ upstream: string, chainId: string, cwd: string, base: number }} AgentSessionRef
 */

/**
 * @param {{ config: { get: () => any }, destination: (u: any) => import("../core/ports.js").Destination | null }} deps
 */
export function createAgentSelf({ config, destination }) {
  /**
   * The session's agent bridge and the chat as it keys it; null for an upstream gone, or one that runs no agent.
   * @param {AgentSessionRef} o
   */
  const chatOf = ({ upstream, chainId, cwd, base }) => {
    const u = findUpstream(config.get(), upstream);
    const bridge = u ? destination(u)?.agent : null;
    return bridge ? { bridge, where: { upstream: u, cwdHint: cwd, conversationId: `chain:${chainId}`, base } } : null;
  };
  return {
    /**
     * Whether the agent's bridge keeps a session for the chat, the one its next turn goes on in (HarnessV4_Tasks
     * C26); false where it keeps none, so that turn starts a new one from Filament's copy of the chat. Null where
     * nothing can say: the upstream is gone, or runs no agent.
     * @param {AgentSessionRef} o
     * @returns {boolean | null}
     */
    holds(o) {
      const c = chatOf(o);
      return c?.bridge.holds ? c.bridge.holds(c.where) : null;
    },
    /**
     * Let go of the session the agent's bridge keeps for the chat, as `/new` does (commands/acp.js): the chat's next
     * turn starts a new one from Filament's copy of the chat. After a rewind of turns the session holds (rewind.js).
     * @param {AgentSessionRef} o
     */
    forget(o) {
      const c = chatOf(o);
      return c?.bridge.forgetByRequest ? !!c.bridge.forgetByRequest({ ...c.where, format: "anthropic", body: { messages: [] } }) : false;
    },
    /**
     * How the session's agent can write the summary now: in a fork of the session it holds open, or in that session
     * itself; null when it holds none open (its process let go of it), the chat's next turn leaves it, or it writes
     * none.
     * @param {AgentSessionRef} o
     * @returns {"fork" | "session" | null}
     */
    how(o) {
      const c = chatOf(o);
      return c?.bridge.summarizes ? c.bridge.summarizes(c.where) : null;
    },
    /**
     * The summary the session's agent writes, prompted with `instruction`: ended by `signal`, never by a clock
     * (HarnessV3-FailurePoints §4 B).
     * @param {AgentSessionRef & { instruction: string, signal?: AbortSignal | null }} o
     * @returns {Promise<import("../core/ports.js").AgentSummary>}
     */
    async write({ instruction, signal = null, ...ref }) {
      const c = chatOf(ref);
      if (!c?.bridge.summarize) throw new Error("its agent writes no summary for Filament");
      return c.bridge.summarize({ ...c.where, instruction, signal });
    },
    /**
     * Whether the session's agent compacts its session its own way now (AC5-5): keeping a fork of it from before, for
     * Undo, or not; null when it holds none open, the chat's next turn leaves it, or it has no compaction of its own.
     * @param {AgentSessionRef} o
     * @returns {"fork" | "session" | null}
     */
    compacts(o) {
      const c = chatOf(o);
      return c?.bridge.compacts ? c.bridge.compacts(c.where) : null;
    },
    /**
     * Whether a way of the agent's own opens the chat's session first (HarnessV4_Tasks C33): no process holds it now —
     * Filament restarted, or the idle agent was let go — or the agent lost it under a prompt, and its bridge can open it
     * again.
     * @param {AgentSessionRef} o
     * @returns {boolean}
     */
    closed(o) {
      const c = chatOf(o);
      return c?.bridge.closed ? c.bridge.closed(c.where) === true : false;
    },
    /**
     * The agent compacts its session its own way (AC5-5): with what to keep, forked first where `fork` asks and it can;
     * `record` lists the compaction once the agent says it compacted. Ended by `signal`, never by a clock.
     * @param {AgentSessionRef & { keep: string, fork: boolean, record: (facts: import("../core/ports.js").AgentOwnCompaction) => number,
     *   signal?: AbortSignal | null, onEvent?: ((ev: any) => void) | null }} o
     * @returns {Promise<import("../core/ports.js").AgentOwnCompaction>}
     */
    async compact({ keep, fork, record, signal = null, onEvent = null, ...ref }) {
      const c = chatOf(ref);
      if (!c?.bridge.compactOwn) throw new Error("its agent has no compaction of its own that Filament can ask for");
      return c.bridge.compactOwn({ ...c.where, keep, fork, record, signal, onEvent });
    },
  };
}
