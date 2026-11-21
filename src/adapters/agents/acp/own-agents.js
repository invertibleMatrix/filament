// @ts-check
/**
 * A coding agent's own sub-agent tool, off in the processes Filament starts for it (the owner's of 11-10: "have other
 * agents stop from spawning their sub agents"), as Claude Code's is per session (toolset.js `CLAUDE_OWN_AGENTS`):
 * Filament's agent tool and its team stand in for it, and the helpers an agent's own tool starts are no sub-agent of
 * Filament's — its page shows nothing of them, its wait knows nothing of them, and no apply holds their work. Where an
 * agent takes the switch only as it starts (`ownOffAtStart`), a turn that hands it Filament's agent tool or its team runs
 * in a process of its own started so (acp/bridge.js `getProcess`, its key's `|own`); any other keeps its own.
 *
 * Qoder (read in qodercli 1.1.50): `--disallowed-tools`, repeated, takes a tool out of what the model sees — its `Agent`,
 * and `Workflow`, which runs sub-agents from a script where its server switches it on. Others take no such switch at
 * start: Codex and Cursor's SDK per session (codex/bridge.js, cursor-sdk.js); Cursor's CLI and Antigravity none Filament
 * knows, so they are asked in words. Antigravity 1.4.5 (read signed in): its `invoke_subagent`, `define_subagent`,
 * `manage_subagents`, `send_message` and `run_workflow` stay whatever its settings say, which take `auth` and `gcp` alone.
 */
import { agentKey } from "../../../core/catalogues.js";

/** Qoder's own sub-agent tools, by the names its `--disallowed-tools` takes. */
export const QODER_OWN_AGENTS = Object.freeze(["Agent", "Workflow"]);

/**
 * Whether the upstream's agent takes the switch only as its process starts: Qoder's.
 * @param {any} upstream
 */
export const ownOffAtStart = (upstream) => agentKey(upstream) === "qoder";

/**
 * What a process of the upstream's agent starts with so that its own sub-agent tool is off: arguments after its own,
 * variables over its environment, and the record's line. `held` false where the agent takes no such switch at start.
 * @param {any} upstream
 * @returns {{ held: boolean, args: string[], env: Record<string, string>, words: string }}
 */
export function ownAgentsOff(upstream) {
  if (!ownOffAtStart(upstream)) return { held: false, args: [], env: {}, words: "" };
  return { held: true, args: QODER_OWN_AGENTS.flatMap((t) => ["--disallowed-tools", t]), env: {}, words: `acp: Qoder's own sub-agent tools (${QODER_OWN_AGENTS.join(", ")}) are off in this process: Filament's agent tool stands in for them` };
}
