// @ts-check
// What a turn gives a coding agent's session besides the person's words (HarnessV3-ACP AC4-1 to AC4-5), from the
// request memory prepared: the blocks memory placed, taken from the request so no agent reads them as its client's
// words — the system prompt's stand for the session (briefing, goal), the newest message's go with its
// prompt (recall) — and the task graph's words; a sub-agent's run stands on its
// part, which never leaves it (HarnessV3-ACP AC6-2); a plain chat given Filament's agent tool, the words that tell it
// from the agent's own (HarnessV4_Tasks E12 step 2); after its chat moved to another place, where it works now
// (HarnessV4_Git_Plan GW-D72); what of its services the chat's project uses, where a connector says (the owner's word
// of 10-26); the chat's skills, where its session has Filament's skill tool (HarnessV4_Skills_Plan S1-2). The bridges hand them over, each through the agent's own channel
// (adapters/agents/context.js).
import { ENVELOPES_TOOL, GRAPH_TOOL, LAUNCH_TOOL, SKILLS_TOOL } from "../adapters/agents/context.js";
import { pluginLine, skillLines } from "./agent/skills.js";
import { sealedListText } from "./agent/envelopes.js";
import { liftMemoryBlocks, memoryBlock } from "../services/memory/brain.js";
import { GOAL_BLOCK_KIND } from "../services/memory/goal.js";
import { LAUNCH_BLOCK, LAUNCH_GONE, launchWords } from "./agent-launch.js";
import { ROLE_BLOCK } from "./agent-worker.js";
import { PROMPT } from "./agent/prompt.js";
import { noteOf } from "../services/mcp-servers.js";
import { FILAMENT_TRAILER } from "../core/schema.js";

/** @typedef {import("../adapters/agents/context.js").ContextBlock} ContextBlock */
/** @typedef {import("../adapters/agents/context.js").AgentContext} AgentContext */

/** The task graph's words for a coding agent (HarnessV3-ACP AC4-5), standing while its session has the tasks tool. */
export const CODER_GRAPH_TEXT = [
  "Filament's tasks tool keeps work as a graph of tasks: Filament keeps their order, and the person sees the graph drawn live.",
  "- Before you start work that breaks into more than one step, plan it, and keep the plan up to date as it moves; only a question you answer straight, or a single step, needs none. Steps you take yourself one after another go on Filament's checklist tool, never as tasks you add: its items are tasks of yours on this graph, p1, p2, … in the order you first gave them, each moved by its status (doing starts it, done ends it), and tasks change adds what pays to one by its id (a check, needs). While a task you added with the tasks tool runs (start it first), a checklist that names it in task, or names none of the graph's tasks, is that task's steps instead: Filament says them on its box, and makes no task of them, so list only that task's steps there. Work that branches (a step with steps of its own) goes on this graph, its steps as sub-tasks under it, and so does work whose pieces need one another or can run side by side, that runs on over many turns or past a compaction, or whose tasks must keep what it needs to go on (a note, a file, a whole document: keep), which a compaction never loses. Never do work of more than one step with neither: the person follows your work by them. Asked for a plan alone (/plan, or words like \"plan it out\"), make it whole the same way, complex work's summary kept behind the graph (keep, titled \"Plan\"); end your reply with that summary, and start none of it until the person says go.",
  "- Complex work nobody asked you to plan: offer to plan it first, before you change anything (tasks offer, with a line on why), then end your reply; Filament shows the person a card, and the choice is theirs: a plan, or just do it. Just do it skips planning first, never the checklist or the graph: the work goes on them as you do it. Small work you just do, on the checklist where it takes more than one step. While you plan, the turn is read-only: you change nothing but the graph and its notes, and the plan waits for their Approve or Amend. Plan with Filament's tasks tool, never a plan mode of your own.",
  "- Add the tasks with the graph's goal. Start a task when work on it begins (several at once only where sub-agents or background commands work them meanwhile: a started task reads as at work), and mark it done with a line on what was done, and with evidence where it has acceptance and no check: what shows that holds. When the plan moves, change the tasks not yet finished, or drop the ones no longer needed with the reason; close the graph with its outcome when the work is done.",
  "- Filament refuses in words a start before a task's needs are done, a need that is no task, and needs that go round in a loop: fix the graph and go on. Plan by what each task needs, not by who owns a file: tasks that write the same file may still run at once. Your turn may end with tasks open: the graph waits for your next one, and tasks show reads it back.",
  "- Something that comes in while you are on a task and that you take up first: pause the task with its checkpoint, add the new work as tasks, and start it again once they are done; the answer hands the checkpoint back. Filament says where you stand on the graph at each turn's start and after a compaction, your checkpoints in it.",
].join("\n");
/**
 * The standing block on Parallelize tasks, its words as the switch stands: on, beside the graph's (the owner's of
 * 11-09); off, wherever the session has Filament's agent tool (the owner's of 11-14). A flip says it again whole.
 */
export const PARALLEL_BLOCK = "parallel";
/**
 * Parallelize tasks, on in Settings › Experimental, for a coding agent (the owner's of 11-09: "turning that on is
 * considered to be a consent"): the tasks of its graph that can run at once it starts on sub-agents itself, with
 * Filament's agent tool, as the loop's agent gives them to sub-agents on its graph (core/task-graph.js `PARALLEL_CONSENT`),
 * in the same fixed sentence on where they edit (the owner's of 11-09, D5): the same words whatever folder they work in.
 */
export const CODER_PARALLEL_TEXT =
  "Parallelize tasks is on: the person turned it on, and that is their consent. When tasks of your graph can run at once — truly independent: none needs another's work — start them on sub-agents yourself, now, without asking: Filament's agent tool, one call each, on your own model — name it in model, and the task in task. Each works in its own worktree, so they may share a file — unless the chat's sub-agents work in its folder: then tasks that share a file stay in order. Tasks that need each other stay in order.";
/** What an agent is told when the block goes while Parallelize tasks is on: its graph or Filament's agent tool went. */
const PARALLEL_GONE = "Parallelize tasks' consent is gone from this session: start no sub-agent on your graph's tasks unasked.";
/**
 * Parallelize tasks, off, for a coding agent given Filament's agent tool (the owner's of 11-14: no sub-agent that
 * changes files starts without the person's yes on a card): what it does itself, when a builder pays, and that
 * Filament holds each launch on the person's card, which starts them on Accept, or by itself after 60 seconds (the
 * owner's choice of 11-14: wherever each would work). The loop's agent reads it in its tools section (prompt.js
 * `parallelOff`).
 */
export const CODER_PARALLEL_OFF_TEXT =
  "Parallelize tasks is off: the person has not agreed to sub-agents that change files working beside you. What you can do yourself, do yourself, one piece after another. A builder pays only where two or more independent pieces run at once while you do another or check their work. When that pays, launch them in one reply: Filament holds each and asks the person on a card, which starts them on their Accept, or by itself after 60 seconds, and tells you which. Until then, do none of their work. A launch that names a task of your graph is held the same way. Only the card is their yes: \"go ahead\" or an approved plan is a yes to the work, not to who does it. On One at a time the work is yours for this turn: launch no builder for it again, one by one either, and start no other agent on it through a shell command or your client's own tools. A reviewer only reads and is never held.";
/**
 * What an agent is told when the off block goes: Filament's agent tool went, or Parallelize tasks was turned on — with
 * no graph, no block of the switch's comes in its place — so it names neither.
 */
const PARALLEL_OFF_GONE = "Filament no longer holds sub-agents that change files on a card in this session.";
/** The standing block that asks Filament's co-author line on a commit (Settings › Agent loop, the owner's of 11-10). */
export const TRAILER_BLOCK = "commits";
/** Its words: Filament's line, in place of the agent's own. */
export const CODER_TRAILER_TEXT = `<filament-context kind="commits">\nWhen you commit, end the message with the trailer ${FILAMENT_TRAILER}, and add no co-author line of your own.\n</filament-context>`;
/** What an agent is told when the switch is turned off. */
const TRAILER_GONE = "Filament's co-author line is no longer asked: write commit messages in the repository's own style.";
/** The prompt's block that tells an agent its chat moved to another place (HarnessV4_Git_Plan GW-D72). */
export const MOVED_BLOCK = "moved";
/** The prompt's block that says where the agent stands on its task graph (HarnessV4_TaskGraphPlus_Plan E41 P1). */
export const WHERE_BLOCK = "where";
/**
 * Where the agent stands on its task graph, for a turn's first prompt (E41 P1 case 1): the runner's words — its
 * running and paused tasks' checkpoints in them — after the developer's words, while the session has the tasks tool.
 * @param {string} text @returns {import("../adapters/agents/context.js").ContextBlock}
 */
export const whereBlock = (text) => ({ id: WHERE_BLOCK, text, tool: GRAPH_TOOL });
/** The prompt's block that lists the envelopes still sealed as a turn opens (HarnessV4_Envelopes_Plan EN-D6). */
export const ENVELOPES_BLOCK = "envelopes";
/**
 * The envelopes still sealed, a line each, for a turn's first prompt (case 12): after the developer's words, none
 * opened for it — in a session given the envelope tool alone, which can open them. @param {readonly import("./agent/subagents.js").Envelope[]} list
 * @returns {import("../adapters/agents/context.js").ContextBlock}
 */
export const envelopesBlock = (list) => ({ id: ENVELOPES_BLOCK, text: sealedListText(list), tool: ENVELOPES_TOOL });
/**
 * The blocks a coding agent's turn start composed (checkpoint.js `compose`: "turn-start", "switch"), each as its first
 * prompt carries it, by its id (sw-map): what comes back, what is still open and what is handed over as the list's block
 * (`open`), the envelopes still sealed (`sealed`), where it stands (`where`); any other in its own words, under its own
 * id — what changed in the files it read is no word of where it stands.
 * @param {readonly { id: string, text?: string }[]} blocks
 * @param {{ open: () => ContextBlock, sealed: () => ContextBlock, where: () => ContextBlock }} as
 * @returns {ContextBlock[]}
 */
export const startBlocks = (blocks, as) =>
  blocks.map((b) => (b.id === "back" || b.id === "still-open" || b.id === "handover" ? as.open() : b.id === "sealed" ? as.sealed() : b.id === "where" ? as.where() : { id: b.id, text: String(b.text ?? "") }));
/** What an agent is told when the task graph no longer stands for its session. */
const GRAPH_GONE = "Filament's task graph no longer stands for this session: the tasks tool is gone. Carry on as you see fit.";
/** The standing block that says what of its services the chat's place uses (the owner's word of 10-26). */
export const USES_BLOCK = "uses";
/** What an agent is told when no note stands any more. */
const USES_GONE = "What this project uses of its services no longer stands: its connectors reach what their accounts can.";

/**
 * What of its services the chat's place uses, one standing block for a coding agent, as Filament's own agent reads it
 * on each server's line (core/mcp-door.js): Slack's channels for this project, Linear's team. Null where no server of
 * the chat says any. @param {readonly Record<string, any>[] | null | undefined} servers
 * @returns {ContextBlock | null}
 */
export function usesBlock(servers) {
  const said = (servers || []).flatMap((s) => (noteOf(s) ? [`${s.name} — ${noteOf(s)}`] : []));
  if (!said.length) return null;
  return { id: USES_BLOCK, text: `<filament-context kind="uses">\nThis project uses only these parts of its services: ${said.join("; ")}. Keep to them unless the person asks for more.\n</filament-context>`, gone: USES_GONE };
}

/** The standing block that names the chat's skills (HarnessV4_Skills_Plan S1-2). */
export const SKILLS_BLOCK = "skills";
/** What an agent is told when the chat offers no skills any more. */
const SKILLS_GONE = "This chat offers no skills from Filament any more: its skill tool is gone.";

/**
 * The chat's skills for a coding agent, one standing block (S1-2): the lines Filament's own agent reads under # Skills
 * — in the same fixed budget however many are on (`skillLines`) — and # Plugins, told from the agent's own Skill tool,
 * whose skills are its own folders', left out of these. Null for none on: the skill tool still finds the Library's. @param {{ skills: readonly import("./agent/skills.js").Skill[], plugins: readonly import("./agent/skills.js").PluginSet[] } | null | undefined} set
 * @returns {ContextBlock | null}
 */
export function skillsBlock(set) {
  if (!set?.skills.length) return null;
  const own = set.skills.filter((s) => !s.plugin);
  const parts = ["This chat's skills, from Filament. Load one with Filament's `skill` tool — not your own Skill tool, which loads the skills of your own folders. When a request matches one's description or triggers, load it before you start that work, and follow it; its folder's references are listed, read and searched with the same tool. A $<name> in the person's message names one to load with it, listed here or not."];
  if (own.length) parts.push(skillLines(own).join("\n"));
  if (set.plugins.length)
    parts.push(
      `Plugins on here, one line each; what one holds is not loaded until you need it. Load a plugin by its name with Filament's skill tool: its skills and commands come back, each then loaded by its full name (<plugin>:<name>).\n${set.plugins
        .map((p) => pluginLine(p.name, p.description, { skills: p.skills.filter((s) => s.kind === "skill").length, commands: p.skills.filter((s) => s.kind === "command").length, servers: p.servers }))
        .join("\n")}`,
    );
  return { id: SKILLS_BLOCK, text: `<filament-context kind="skills">\n${parts.join("\n")}\n</filament-context>`, gone: SKILLS_GONE, tool: SKILLS_TOOL };
}

/** What an agent is told when a block of memory's leaves its session. @param {string} kind */
function goneOf(kind) {
  if (kind === GOAL_BLOCK_KIND) return "The session's goal no longer stands: it was finished or set aside.";
  if (kind === "briefing") return "Memory's briefing no longer stands for this session.";
  return `Memory's ${kind} block no longer stands for this session.`;
}

/**
 * The context of one turn to a coding agent. Memory's blocks are taken from `body` — none is left on any message.
 * `briefing`, `goal`: the briefing and the goal in force for the session, where memory gave the request them (brain.js
 * `briefingInForce`, `goalInForce`: the text, "" for none) — each stands in the agent's context, changed as it changes,
 * in place of the one memory's blocks carry: the system prompt keeps what stood at the chat's newest compaction, and
 * what came since rides a person's message once.
 * `graph`: the session has the task graph — a team's lead's graph words are the loop lead's (`lead`, HarnessV3-ACP
 * AC6-3). `role`: a sub-agent's, a worker's or a lead's part (agent-worker.js, agent-lead.js), first; `roleGone`, the
 * words for its going where the session goes on without it (a lead's). `launch`: what the session offers its agent of
 * Filament's sub-agents — the words stand while the session has the agent tool, and say its going once nothing is
 * offered. `parallel`: Parallelize tasks is on (the owner's of 11-09) — its block stands beside the graph's where the
 * session has the graph and Filament's agent tool, never a lead's. Off, the block says the hold on the person's card
 * wherever the session has Filament's agent tool, graph or none (the owner's of 11-14); a flip says it again whole.
 * `moved`: the chat moved to another place since its agent's last turn (core/move-note.js), said with this prompt.
 * `servers`: the chat's MCP servers, whose notes — what of each the place uses — stand as one block (`usesBlock`).
 * `skills`: the chat's skills for this agent, named in one block (`skillsBlock`) where its session has the skill tool;
 * a $<name> in the person's message is the agent's to load with it, the Library's off here too (the owner's of 11-07).
 * `trailer`: Filament's co-author line is on (Settings › Agent loop) — its block asks it of every commit, in place of
 * the agent's own line, and says its going once it is turned off.
 * @param {{ format: string, body: any, graph: boolean, trailer?: boolean, role?: string | null, roleGone?: string | null, lead?: boolean,
 *   launch?: import("./agent/tools.js").LaunchOffer | null, parallel?: boolean, moved?: string | null, servers?: readonly Record<string, any>[] | null,
 *   skills?: { skills: readonly import("./agent/skills.js").Skill[], plugins: readonly import("./agent/skills.js").PluginSet[] } | null,
 *   briefing?: string | null, goal?: string | null }} o
 * @returns {AgentContext}
 */
export function agentContext({ format, body, graph, trailer = false, role = null, roleGone = null, lead = false, launch = null, parallel = false, moved = null, servers = null, skills = null, briefing = null, goal = null }) {
  const lifted = liftMemoryBlocks(format, body);
  /** @type {[string, string][]} */
  const inForce = [];
  for (const [kind, text] of /** @type {[string, string | null][]} */ ([["briefing", briefing], [GOAL_BLOCK_KIND, goal]])) if (typeof text === "string") inForce.push([kind, text]);
  const given = new Set(inForce.map(([kind]) => kind));
  /** Memory's blocks, less those whose kind is given in force. @param {{ kind: string, text: string }[]} bs */
  const mine = (bs) => bs.filter((b) => !given.has(b.kind));
  const system = [...mine(lifted.system), ...inForce.filter(([, text]) => text).map(([kind, text]) => ({ kind, text }))];
  const newest = mine(lifted.newest);
  /** @type {ContextBlock[]} */
  const standing = [...(role ? [{ id: ROLE_BLOCK, text: role, ...(roleGone ? { gone: roleGone } : {}) }] : []), ...system.map((b) => ({ id: b.kind, text: memoryBlock(b.kind, b.text), gone: goneOf(b.kind) }))];
  if (graph) standing.push({ id: GRAPH_TOOL, text: `<filament-context kind="tasks">\n${lead ? PROMPT.leadGraph : CODER_GRAPH_TEXT}\n</filament-context>`, gone: GRAPH_GONE, tool: GRAPH_TOOL });
  if (graph && parallel && launch && !lead) standing.push({ id: PARALLEL_BLOCK, text: `<filament-context kind="parallel">\n${CODER_PARALLEL_TEXT}\n</filament-context>`, gone: PARALLEL_GONE, tool: GRAPH_TOOL });
  else if (!parallel && launch && !lead) standing.push({ id: PARALLEL_BLOCK, text: `<filament-context kind="parallel">\n${CODER_PARALLEL_OFF_TEXT}\n</filament-context>`, gone: PARALLEL_OFF_GONE, tool: LAUNCH_TOOL });
  if (launch) standing.push({ id: LAUNCH_BLOCK, text: launchWords({ ...launch, held: false }), held: launchWords({ ...launch, held: true }), gone: LAUNCH_GONE, tool: LAUNCH_TOOL });
  if (trailer) standing.push({ id: TRAILER_BLOCK, text: CODER_TRAILER_TEXT, gone: TRAILER_GONE });
  const uses = usesBlock(servers);
  if (uses) standing.push(uses);
  const offered = skillsBlock(skills);
  if (offered) standing.push(offered);
  return {
    standing,
    prompt: [...newest.map((b) => ({ id: b.kind, text: memoryBlock(b.kind, b.text) })), ...(moved ? [{ id: MOVED_BLOCK, text: moved }] : [])],
  };
}
