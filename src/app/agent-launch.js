// @ts-check
// A coding agent's own chat launching Filament's sub-agents and asking the saved agents its session names
// (HarnessV4_Tasks E12 step 2, E15 step 3): the loop's agent and wait, in the agent's terms. The two tools reach it
// over Filament's MCP server (or as the Cursor SDK's custom tools) and go through the door its harness turn opens in the
// registry — the loop's own door, so a launch, its count, its limit and its card are the loop's. What differs is the
// agent. It cuts a call that runs too long: a launch that outlasts its call runs on, and its report comes as a message
// (AG-68). It reads nothing between its prompts: a report lands in its running turn where the agent takes words there,
// else as its next prompt within the same harness turn (agent-inbox.js). Builder and Reviewer run on the model a launch
// names, else on this chat's and their cards' models, else on the agent's own model and account — a card's "Same as the
// main agent" holds here too (the owner's of 11-06, where V4-D276 and AG-66 had kept them off the agent's model).
import { LAUNCH_TOOL } from "../adapters/agents/context.js";
import { PROMPT } from "./agent/prompt.js";
import { ENVELOPE } from "./agent/tools.js";
import { waitedCommands } from "./agent/commands.js";
import { MCP_PATIENCE_MS, createAgentInbox, heldFor } from "./agent-inbox.js";

/** @typedef {import("./agent/tools.js").LaunchOffer} LaunchOffer */

/** The block of Filament's context that says the tool: it stands in a session given it. */
export const LAUNCH_BLOCK = "agents";

/**
 * What stands in the agent's session beside the tool's own text (AG-67): that the tool is Filament's, and whether the
 * agent's own sub-agent tool stands beside it or is held back (`held`), when its sub-agents pay and three ways they do
 * (step 4), when to ask a saved agent (the loop's words), and how a late report reaches it. What a launch runs on is
 * the tool's model field's to say.
 * @param {LaunchOffer} offer
 * @returns {string}
 */
export function launchWords({ asks, held = false }) {
  // That Filament's context blocks are instructions is the head's to say (adapters/agents/context.js `CONTEXT_HEAD`);
  // whether the agent's own sub-agent tool stands beside Filament's is its offer's (`held`, the owner's prompt pass of
  // 11-08).
  const lines = [held ? PROMPT.coderAgentHeld : PROMPT.coderAgent, held ? PROMPT.coderAgentModelHeld : PROMPT.coderAgentModel, PROMPT.agentRecipes, asks.length ? PROMPT.askFirst : "", asks.length ? PROMPT.agentAsk : "", PROMPT.coderAgentRules];
  return `<filament-context kind="${LAUNCH_BLOCK}">\n${lines.filter(Boolean).join("\n")}\n</filament-context>`;
}
/** The tool gone from the session: a team's lead took its place, its own agent tool in its hands. */
export const LAUNCH_GONE = "Filament's agent tool is gone from this session for now.";

/**
 * The agent's turn, over the door its harness turn opened in the registry.
 * @param {{
 *   registry: import("./agent/subagents.js").SubagentRegistry,
 *   door: { subagents: import("./agent/subagents.js").Subagents, inbox: import("./agent/subagents.js").Inbox, close: () => any },
 *   chainId: string,
 *   emit: (evt: any) => void,
 *   note: (text: string) => void,
 *   mailbox: () => import("../services/runs.js").Mailbox | null,
 *   reach?: (m: import("../services/runs.js").SteerMessage) => import("./agent-inbox.js").Reach,
 *   handOver?: (m: import("../services/runs.js").SteerMessage) => Promise<void>,
 *   wrote?: (writes?: import("./turn-tree.js").Writes | null) => void,
 *   signal: AbortSignal,
 *   stopSignal: AbortSignal,
 *   callOf?: (name: string) => Promise<import("./agent-run.js").OwnCall | null>,
 *   opens?: () => boolean,
 *   onTask?: (() => string | null) | null,
 *   ownWork?: (() => string | null) | null,
 * }} o  `emit`: an event on the agent's run, at its round; `note`: the record's line; `reach`: how a message of the
 *   developer's reaches the agent, which ends its wait (TG2-D43; where nothing says, none does); `handOver`: such a
 *   message, at its next step, goes to the agent before the wait answers (HarnessV4_Tasks C34); `wrote`: a sub-agent changed the
 *   folder, which the run snapshots, with the files it names; `signal`: the turn's hang-up, which a foreground
 *   sub-agent dies with; `stopSignal`: the developer's stop, which stops one through its own run, its report kept;
 *   `callOf`: the agent's own call a tool
 *   call came in, on its run, once the agent has said it — the sub-agent's card hangs off it; `opens`: whether the
 *   agent can open an envelope now — Filament's tools reach its session (agent-inbox.js); `onTask`: the line behind what
 *   lands while a task of its own runs on its graph (E41 P1 case 7); `ownWork`: its own running tasks, which a wait
 *   that finds none of Filament's sub-agents running names (E41 P5's measure)
 * @returns {import("./agent-inbox.js").AgentTurn}  its `call` takes agent, wait and envelope; it owes its background
 *   launches' reports
 */
export function createLaunchTurn({ registry, door, chainId, emit, note, mailbox, reach = () => null, handOver = async () => {}, wrote = () => {}, signal, stopSignal, callOf = async () => null, opens = () => false, onTask = null, ownWork = null }) {
  // Its wait waits for the chat's background commands too (the gap of 11-10).
  const box = createAgentInbox({ door, emit, note, mailbox, reach, handOver, wrote, signal: AbortSignal.any([signal, stopSignal]), reader: "the agent", opens, onTask, commands: waitedCommands(chainId) });
  let n = 0;
  /** What the launches whose report was their call's answer spent. */
  let spent = 0;
  return {
    async call(name, input, { patienceMs = MCP_PATIENCE_MS } = {}) {
      if (name === "wait") {
        const got = await box.wait(input?.seconds, patienceMs, { who: "Filament's sub-agents" });
        if (got) return { text: got.said };
        const own = ownWork?.() || "";
        return { text: `Nothing to wait for: none of Filament's sub-agents you launched is still running, no agent you asked is still thinking, and none of your background commands runs.${own ? ` ${own}` : ""} A report that already arrived reaches you as a message from Filament.` };
      }
      if (name === ENVELOPE) return { text: box.open(input, (await callOf(name))?.id ?? null) };
      if (name !== LAUNCH_TOOL) return { text: `Not run: Filament has no ${name} tool for this session.`, isError: true };
      // What the session names is read at each call, in the registry: a launch that names no model runs on this chat's
      // and its card's models, else the agent's own.
      const own = await callOf(name);
      try {
        const r = await door.subagents.run({
          id: own ? own.id : `mcp:${++n}`,
          input,
          // The sub-agent's events keep the round of the call that launched it, however late it reports.
          emit: (e) => emit(own ? { ...e, round: own.round } : e),
          signal,
          stopSignal,
          withinMs: heldFor(patienceMs),
          coder: true,
        });
        note(r.note);
        spent += r.spentUsd;
        if (r.wrote) wrote(r.writes || null);
        return { text: r.text, ...(r.ok ? {} : { isError: true }) };
      } catch (/** @type {any} */ e) {
        return { text: `Error: ${e?.message || e}`, isError: true };
      }
    },
    take: box.take,
    unheard: box.unheard,
    owes: () => door.inbox.owed(),
    why: () => door.inbox.owedWhy?.() || null,
    arrival: box.arrival,
    waiting: box.waiting,
    spentUsd: () => spent + box.spentUsd(),
    close: box.close,
    remind: box.remind,
  };
}
