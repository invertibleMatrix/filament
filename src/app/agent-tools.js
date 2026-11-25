// @ts-check
// Filament's own tools for a coding agent's session (HarnessV3-ACP AC4-2, AC4-5): memory's while its tools are on — never
// in a chat Memory settings leave out (D4 of 11-01) — the task graph's `tasks` while the session has it, a graph task's
// `report` for a sub-agent working on one (AC6-1), a
// team's worker's `ask_lead` (HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58), a team's agent, worker and
// wait for an agent that leads one (AC6-3) — its tasks the lead's, as its team plans, each
// naming its team's members (HarnessV4_Tasks E15 step 6); a lead
// that reads along with its workers has the worker and the wait that say so (HarnessV3-TaskGraph-v2 V2-0b) — and,
// in a plain chat whose session names a model for Filament's sub-agents or saved agents to ask, Filament's agent and
// wait (HarnessV4_Tasks E12 step 2, E15 step 3); in a harness chat, the visual tools (HarnessV4_Visuals_Plan E16) and
// the artifact tool (HarnessV4_Artifacts_Plan E18); in a chat of a project, its Space's `space` (proposal_ux §4.14);
// to a harness chat's own agent, the `team` tool that fires teams beside its chat (team_v2_plan §5.5) and the `flow`
// tool that designs a flow beside it (HarnessV4_OneAgent_Plan OA3, L41); to the agents of a harness chat that drives
// a browser — its own and its sub-agents, each in tabs of its own — the `browser` tool (HarnessV4_AgentTools_Plan AT-D7);
// beside a lead's or a launch's envelope tool, and to a sub-agent (h1, the owner's of 11-08), `background_command`, which
// runs a long command while the agent works and hands its end back whole (HarnessV4_Background_Plan E34); to a
// sub-agent, the envelope tool that writes the
// agent that launched it and answers its letters (app/letters.js, the owner's of 11-04); and to the agents of a chat
// that offers skills, the `skill` tool (HarnessV4_Skills_Plan S1-1), its skills less those the agent loads from its own
// folders.
// One list and one way to call them, whatever the bridge: the ACP
// agents and Codex reach them over Filament's MCP server, Cursor's SDK as its custom tools. A call stands in the session
// and turn the agent runs in, as the loop's do: what memory shows it is logged there, what it remembers is filed on
// the turn, its tasks are the session's graph, and a launch goes through the door
// its turn holds in the registry.
import { ASK_LEAD_OWN_TOOL, CODER_CHECKLIST_TOOL, CODER_TASKS_TOOL, CODER_WAIT_TOOL, ENVELOPE_MAIN_TOOL, ENVELOPE_SUB_TOOL, ENVELOPE_TOOL, REPORT_TOOL, TEAM_AGENT_TOOL, TEAM_WAIT_OWN_TOOL, TEAM_WAIT_TOOL, WORKER_TOOL, checklistOf, coderAgentToolFor, keepsAgentsMachine, leadAnswerWords, leadQuestionOf, leadToolsOf, teamAgentToolFor } from "./agent/tools.js";
import { agentMemoryMcpTools, callAgentMemoryTool, isMemoryTool, isRecallTool, memoryToolDefs, recallToolDef } from "./memory-tools.js";
import { recall } from "./sessions/recall.js";
import { REPORT_IN, readReport, stepsRefused } from "../core/task-graph.js";
import { MCP_PATIENCE_MS, heldFor } from "./agent-inbox.js";
import { SHOW_VISUAL_TOOL, VISUALS_OFF, VISUAL_GUIDE_TOOL, showVisual, visualEvent, visualGuide, visualHome } from "./agent/visuals.js";
import { ARTIFACTS_OFF, ARTIFACT_TOOL, artifactCall, pinnedFor } from "./agent/artifacts.js";
import { SPACE_TOOL, spaceOffFor, spaceProjectOf, spaceRun } from "./agent/space.js";
import { BESIDE_OFF, BESIDE_TEAMS_OFF, BESIDE_TOOL, besideAtOf, besideCall } from "./agent/beside-tool.js";
import { THREAD_OFF, THREAD_TOOL, threadAtOf, threadCall, threadCtxOf } from "./agent/thread-tool.js";
import { FLOW_OFF, FLOW_TOOL, flowAtOf, flowCall } from "./agent/flow-tool.js";
import { BROWSER, BROWSER_READ_ONLY, BROWSER_TOOL, actingSite } from "./agent/browser-tool.js";
import { BACKGROUND_COMMAND_MACHINE_TOOL, BACKGROUND_COMMAND_TOOL } from "./agent/commands.js";
import { RUN_CHECK_OFF, RUN_CHECK_TOOL } from "./agent/run-check.js";
import { SKILL_TOOL, skillAnswer } from "./agent/skills.js";
import { CRAFT_OFF, CRAFT_TOOL, craftAtOf, craftCall } from "./agent/craft-tool.js";
import { dismissAnswer, dismisses, otherThanDismiss, writesLetter } from "./agent/envelopes.js";
import { browserArgWords } from "../core/browser.js";
import { readerNames } from "../core/space.js";
import { MediaResult } from "../core/media.js";
import { PIN_STOPPED } from "../core/web-pins.js";
import { randomBytes } from "node:crypto";

/** @typedef {import("../core/ports.js").AgentToolCtx} AgentToolCtx @typedef {import("./agent/space.js").SpaceDeps} SpaceDeps @typedef {import("./agent/beside-tool.js").BesideDeps} BesideDeps @typedef {import("./agent/thread-tool.js").ThreadDeps} ThreadDeps @typedef {import("./agent/flow-tool.js").FlowDeps} FlowDeps */

/**
 * One of the loop's tools as an agent's tool list names it. `upfront`: the session's words tell the agent to call it,
 * so a client that holds a server's tools by name until it looks one up must hold this one whole (AG-75).
 * @param {{ name: string, description: string, input_schema: any }} t @param {boolean} [upfront]
 */
const defOf = (t, upfront = false) => Object.freeze({ name: t.name, description: t.description, inputSchema: t.input_schema, ...(upfront ? { upfront: true } : {}) });
/** The tasks tool as an agent's tool list names it: loaded whole, as the session's graph words name it (the owner's tool plan of 11-08). */
const TASKS_DEF = defOf(CODER_TASKS_TOOL, true);
/** Filament's checklist (the owner's tool plan of 11-08): the session's graph words send a short job to it, so it loads whole. */
const CHECKLIST_DEF = defOf(CODER_CHECKLIST_TOOL, true);
/**
 * filament_recall, to a chat's agents (the owner's of 11-06): a fresh session's Words leave a turn's tool output out, and
 * the agent brought it back by running the tools again — five sub-agents launched a second time. It reads the chat's own
 * record alone, which the chat keeps whether or not memory works in it, so it is no memory tool here: listed and run in
 * any chat's session, as it rides the loop's requests (test/left-out-tools.test.js). A fresh session's words name it
 * (`filament_recall({ turn: n })`), so it loads whole (the hunt of carry-recall: Claude Code held it by name alone).
 */
const RECALL_DEF = defOf(/** @type {any} */ (recallToolDef("anthropic")), true);
/** A graph task's report, as the loop's sub-agent on one is offered it: loaded whole, as its brief names it. */
const REPORT_DEF = defOf(REPORT_TOOL, true);
/** A team's worker's question to its lead, whose call holds within the agent's patience; its words name it, so it loads whole. */
const ASK_LEAD_DEF = defOf(ASK_LEAD_OWN_TOOL, true);
/**
 * A team's lead's wait, as the loop's lead is offered it — and the wait of a lead that reads along with its workers
 * (`engine.supervise`), which answers with a look. Its agent, worker and tasks tools name its team's members, so
 * they are its team's (`leadToolsOf`).
 */
const TEAM_WAIT_DEF = defOf(TEAM_WAIT_TOOL, true);
const TEAM_WAIT_READS_DEF = defOf(TEAM_WAIT_OWN_TOOL, true);
/** A plain chat's wait for Filament's sub-agents. */
const CODER_WAIT_DEF = defOf(CODER_WAIT_TOOL, true);
/**
 * The envelope tool (HarnessV4_Envelopes_Plan EN3), beside the wait wherever a wait is (EN-D12): loaded whole (the owner's
 * tool plan of 11-08, in place of EN-D15's held name), as an envelope's line names it. A sub-agent's is the short one that
 * opens what reached it and writes the agent that launched it.
 */
const ENVELOPE_DEF = defOf(ENVELOPE_MAIN_TOOL, true);
const ENVELOPE_SUB_DEF = defOf(ENVELOPE_SUB_TOOL, true);
/** The visual tools, as the loop's are. */
const VISUAL_GUIDE_DEF = defOf(VISUAL_GUIDE_TOOL);
const SHOW_VISUAL_DEF = defOf(SHOW_VISUAL_TOOL);
/** The artifact tool, as the loop's is. */
const ARTIFACT_DEF = defOf(ARTIFACT_TOOL);
/** The project's Space, as the loop's is. */
const SPACE_DEF = defOf(SPACE_TOOL);
/** The team tool, as the loop's is. */
const BESIDE_DEF = defOf(BESIDE_TOOL);
/** The thread tool, as the loop's is: held by name as the team tool is (app/agent/thread-tool.js). */
const THREAD_DEF = defOf(THREAD_TOOL);
/** The flow tool, as the loop's is; held by name as the team tool is: it serves the one turn a /flow message opens,
 *  whose line names it, and loaded whole it would weigh on every request of the chat. */
const FLOW_DEF = defOf(FLOW_TOOL);
/** The browser, as the loop's is (AT-D7). */
const BROWSER_DEF = defOf(BROWSER_TOOL);
/**
 * A long command in the background (HarnessV4_Background_Plan BG-D1, BG-D7): loaded whole, so its words — use it for
 * any command that can take more than a minute — stand in front of the agent where its client holds a server's
 * tools by name.
 */
const BACKGROUND_DEF = defOf(BACKGROUND_COMMAND_TOOL, true);
/** The same with machine and cwd, where a plain chat's agent tool takes machine (the remote-agents plan's c-tools). */
const BACKGROUND_MACHINE_DEF = defOf(BACKGROUND_COMMAND_MACHINE_TOOL, true);
/** A sub-agent that only reads runs its graph task's check in a copy of the folder (agent/run-check.js, x20): loaded whole. */
const RUN_CHECK_DEF = defOf(RUN_CHECK_TOOL, true);
/**
 * The skill tool (HarnessV4_Skills_Plan S1-1), as the loop's is: loaded whole, as the session's words name it — beside
 * an agent's own Skill tool, a name held back would send it to that one.
 */
const SKILL_DEF = defOf(SKILL_TOOL, true);
/** The crafter's tool, in a crafter chat alone (agent/craft-tool.js): held by name (the owner's tool plan of 11-08); its first message names it. */
const CRAFT_DEF = defOf(CRAFT_TOOL);
/**
 * Memory's tools in the order a coding agent's list gives them (the owner's tool plan of 11-08): the reads, then the
 * writes, each loaded whole. The loop's requests keep their own order.
 */
const MEMORY_ORDER = ["search", "grep", "load", "sessions", "remember", "correct", "confirm", "close", "forget"].map((n) => `filament_memory_${n}`);
/** @template {{ name: string }} T @param {readonly T[]} defs @returns {T[]} */
const memoryOrdered = (defs) => [...defs].sort((a, b) => MEMORY_ORDER.indexOf(a.name) - MEMORY_ORDER.indexOf(b.name));
/**
 * Every Filament tool a coding agent's session may be offered, as this build defines it, in the order a session's list
 * gives them (`list`): the graph's and the checklist, the chat's recall, a team's, the waits and the envelopes, a command
 * in the background, a reviewer's run of its task's check, the skill, memory's, a report, ask_lead, then those held by name (the visuals, the artifact, the
 * Space, the team and flow tools, the browser and the crafter's tool). What a coding agent's print reads (agent/prefix.js
 * `agentPrint`), so a release that changed none of them moves nothing. A launch's agent tool is the offer's, not the
 * build's.
 */
export const buildAgentTools = () => [
  TASKS_DEF,
  CHECKLIST_DEF,
  RECALL_DEF,
  defOf(TEAM_AGENT_TOOL, true),
  defOf(WORKER_TOOL, true),
  TEAM_WAIT_DEF,
  TEAM_WAIT_READS_DEF,
  CODER_WAIT_DEF,
  ENVELOPE_DEF,
  ENVELOPE_SUB_DEF,
  BACKGROUND_DEF,
  BACKGROUND_MACHINE_DEF,
  RUN_CHECK_DEF,
  SKILL_DEF,
  ...memoryOrdered(memoryToolDefs("anthropic")).map((t) => defOf(t, true)),
  REPORT_DEF,
  ASK_LEAD_DEF,
  VISUAL_GUIDE_DEF,
  SHOW_VISUAL_DEF,
  ARTIFACT_DEF,
  SPACE_DEF,
  BESIDE_DEF,
  THREAD_DEF,
  FLOW_DEF,
  BROWSER_DEF,
  CRAFT_DEF,
];
/** A call to the skill tool where the chat offers none now. */
const SKILLS_OFF = "Not run: this chat offers no skills now (Settings › Instructions, or a plugin turned on).";
/** A call to memory's tools in a chat Memory settings leave out (D4 of 11-01). */
const MEMORY_LEFT_OUT = "Not run: this chat is left out of memory (Memory settings), and so are memory's tools.";
/** Whether a chat's skills give its agent the skill tool: one on, or one in the Library to find. @param {{ skills: readonly unknown[], library?: readonly unknown[] } | null | undefined} set */
const hasSkills = (set) => !!set && set.skills.length + (set.library?.length ?? 0) > 0;
/** A call to the browser in a chat that drives none now. */
const BROWSER_OFF = "Not run: this chat drives no browser now (its Tools, Drive a browser).";
/** A call to the browser after the person switched it off, in a session given it before. */
const BROWSER_SWITCHED_OFF = "Not run: the person switched the browser off for this chat. Carry on without it.";
/** The tools that go to the agent's turn: a lead's three and the envelope, of which a plain chat has all but worker. */
const TURN_NAMES = new Set(/** @type {string[]} */ ([TEAM_AGENT_TOOL.name, WORKER_TOOL.name, TEAM_WAIT_TOOL.name, ENVELOPE_TOOL.name]));

/**
 * @param {{ memory: any, memoryToolsOn: () => boolean, graphs: () => any,
 *   turns: { get: (chainId: string | null) => import("./agent-inbox.js").AgentTurn | null },
 *   subagents: () => { offer: (chainId: string) => import("./agent/tools.js").LaunchOffer, asks: (chainId: string) => import("./agent/tools.js").Askable[], askLead?: (id: string, q: { question: string, options: string[] } | null, o: { n?: number | null, withinMs?: number, emit?: ((e: any) => void) | null }) => Promise<import("./agent/subagents.js").LeadAnswer>, checkedProblem?: (chainId: string, commands: readonly string[]) => string | null, subLetter?: (id: string, input: any) => { ok: boolean, text: string, sent?: import("./agent/subagents.js").LetterSent }, checksOf?: (id: string) => string[], runCheck?: (id: string, o?: { signal?: AbortSignal | null }) => Promise<{ ok: true, text: string } | { ok: false, error: string }> } | null,
 *   membersOf: (chainId: string) => readonly import("../core/roster.js").Member[] | null,
 *   machines?: import("../services/machines/index.js").Machines | null,
 *   artifacts?: import("../services/artifacts.js").ArtifactStore | null, port?: () => number, maxBytes?: () => number,
 *   space?: SpaceDeps | null, beside?: BesideDeps | null, thread?: ThreadDeps | null, flow?: FlowDeps | null,
 *   browsers?: () => ReturnType<typeof import("./browser/registry.js").createBrowsers> | null, browserOn?: (chainId: string) => boolean,
 *   commands?: ReturnType<typeof import("./agent/commands.js").createBackgroundCommands> | null,
 *   skills?: ((chain: string, upstream: string, cwd: string) => { skills: import("./agent/skills.js").Skill[], plugins: import("./agent/skills.js").PluginSet[], library?: import("./agent/skills.js").LibrarySkill[] } | null) | null,
 *   craft?: import("./agent/craft-tool.js").CraftDeps | null,
 *   dismiss?: ((chainId: string, ids: readonly unknown[]) => { dismissed: string[], unknown: string[] }) | null,
 *   tails?: ReturnType<typeof import("./agent/tool-tail.js").createToolTails> | null }} deps
 *   `memoryToolsOn`: whether memory's tools are offered now. `graphs`: the sessions' graph runner, read at each call
 *   (it is built after the bridges). `turns`: the sessions whose coding agent's turn holds a door into the registry now
 *   (agent-inbox.js). `subagents`: the registry, read at each call as the runner is — what a session offers its agent of Filament's sub-agents, whom its lead may ask, a
 *   worker's question to its lead, its word on a graph task's report's checked (TG2-D63), and a sub-agent's letter.
 *   `membersOf`: the members of the team that answers a session, whom its lead's tools name. `machines`: the machines
 *   this Filament is paired with, read at each list — where it keeps one for its agents, the agent tool takes
 *   `machine` (the remote-agents plan's s-tools), and so does background_command (c-tools). `artifacts`: the
 *   artifacts' store (HarnessV4_Artifacts_Plan E18), with the port Filament listens on now, which an address names, and
 *   the most a folder published by its path may hold. `space`: the projects' Spaces, each chat's found by its chain.
 *   `beside`: the teams beside the chats, which a harness chat's own agent fires (`ctx.beside`). `flow`: the flows
 *   beside the chats, which a harness chat's own agent designs (`ctx.flow`). `thread`: the threads, which a harness
 *   chat's own agent starts (`ctx.thread`, app/threads.js). `browsers`: the chats' browsers, read at
 *   each call (made after the tools), which a chat's agents drive (`ctx.browser`, AT-D7); `browserOn`, whether its
 *   switch is on now — a session given the browser keeps it listed until it opens again, and each call asks.
 *   `commands`: the background commands of the sessions given the envelope tool (HarnessV4_Background_Plan E34), and
 *   of sub-agents (h1).
 *   `skills`: a chat's skills for the agent of an upstream — the chat's folders and its plugins on, less the agent's
 *   own folders — read at each call (HarnessV4_Skills_Plan S1-1). `craft`: the crafter chats, whose agent alone has the
 *   craft tool (agent/craft-tool.js). `dismiss`: a chat's Still open (agent/still-open.js), whose lines its agent's
 *   envelope dismisses. `tails`: what a chat's turn owes its agent at the end of its next answer from Filament
 *   (agent/tool-tail.js): an agent that takes words only once a step ended hears what comes mid-turn there.
 * @returns {import("../core/ports.js").AgentTools}
 */
export function createAgentTools({ memory, memoryToolsOn, graphs, turns, subagents, membersOf, machines = null, artifacts = null, port = () => 0, maxBytes = () => 0, space = null, beside = null, thread = null, flow = null, browsers = () => null, browserOn = () => true, commands = null, skills = null, craft = null, dismiss = null, tails = null }) {
  const memoryOn = () => !!memory && memoryToolsOn();
  /**
   * Where a call to the Space stands, or null where the chat has none: a chat of no project (`spaceProjectOf`), or an
   * agent whose card goes without it (`space: false`, SA2). The list leaves it out while the switch is off too; a call
   * made after is told so in words. A helper of the chat writes as one. The other chats are named as the chat's agent
   * may read them (core/space.js `readerNames`).
   * @param {AgentToolCtx} ctx @returns {import("./agent/space.js").SpaceAt | null}
   */
  const spaceAt = (ctx) => {
    const chain = ctx.chain;
    const project = chain && space && ctx.space !== false ? spaceProjectOf(space, chain) : null;
    if (!chain || !space || !project) return null;
    // A helper by its card's name, as the loop names one (found by the Hunter on S5c: every helper was "a helper").
    return { store: space.store, project, chain, name: ctx.by ? String(ctx.by.name || "a helper") : null, ...readerNames(space, chain), on: () => space.on(chain), fed: space.fed, connection: space.connection, modelOf: space.modelOf, cwdOf: space.cwdOf, sending: space.sending, dashboards: space.dashboards ?? null, lanes: space.lanes ?? null, routines: space.routines ?? null, runOf: space.runOf, chatsOf: space.chatsOf, guidance: space.guidance ?? null, placeIn: space.placeIn, toolReads: space.toolReads };
  };
  /**
   * Where a call to fire teams stands, or null where the chat fires none: the session was not given the tool (a
   * team's lead, a worker, a helper, no harness chat), its chat is a team's own, or Settings › Experimental's Teams
   * switch is off, which a call is told in words of its own. The list leaves it out while the chat's switch is off
   * too; a call made after is told so in words.
   * @param {AgentToolCtx} ctx
   */
  const besideAt = (ctx) => (ctx.beside ? besideAtOf(beside, ctx.chain) : null);
  /** Where a call to start a thread stands, or null where the chat starts none: as for the team tool. @param {AgentToolCtx} ctx */
  const threadAt = (ctx) => (ctx.thread ? threadAtOf(thread, ctx.chain) : null);
  /**
   * Where a call to draw a flow stands, or null where the chat draws none: as for the team tool (OA3). @param {AgentToolCtx} ctx
   */
  const flowAt = (ctx) => (ctx.flow ? flowAtOf(flow, ctx.chain) : null);
  /**
   * Whether a chat is another machine's agents' (`meta.agentDevice`, sessions.js): what this Filament keeps for its own
   * agents is the person's, never theirs. A meta that cannot be read is read as theirs (the xf-words2 hunt's).
   * @param {string} chain
   */
  const agentsChat = (chain) => {
    try {
      return typeof memory?.archive?.metaOf?.(chain, ["agentDevice"])?.agentDevice === "string";
    } catch {
      return true;
    }
  };
  /**
   * Whether a call's agent is offered `machine`: a plain chat's, given the agent tool, where this Filament keeps a
   * machine for its agents — its agent tool and its background_command take it (s-tools, c-tools) — and never another
   * machine's agents' chat. The store is read at each ask: once for a list. @param {AgentToolCtx} ctx
   */
  const machinesFor = (ctx) => !!ctx.launch && !ctx.team && !!ctx.chain && !agentsChat(ctx.chain) && keepsAgentsMachine(machines);
  /**
   * A plain chat's agent tool as its session offers it now, or null for a call given none — with `machine` where `kept`
   * (`machinesFor`). @param {AgentToolCtx} ctx @param {boolean} kept
   */
  const launchTool = (ctx, kept) => {
    const offer = ctx.launch && !ctx.team && ctx.chain ? subagents()?.offer(ctx.chain) : null;
    return offer ? coderAgentToolFor({ ...offer, held: ctx.held === true, ...(kept ? { machines: true } : {}) }) : null;
  };
  /**
   * Whether a call stands where a command's end has a turn to reach: a session given the envelope tool (BG-D1), or a
   * sub-agent's, whose run hears the ends of its own and stays open until they came (h1, the owner's of 11-08).
   * @param {AgentToolCtx} ctx
   */
  const runsCommands = (ctx) => !!commands && !!ctx.chain && (!!ctx.launch || !!ctx.team || !!ctx.by);
  /**
   * Whether a call is a sub-agent's of a session, which writes the agent that launched it with its envelope tool and
   * answers that agent's letters (app/letters.js, the owner's of 11-04) — a lead's and a launch's envelope is their
   * turn's. @param {AgentToolCtx} ctx
   */
  const writesLead = (ctx) => !!ctx.by && !!ctx.chain && !ctx.team && !ctx.launch;
  /** Whether a call's agent is a sub-agent that only reads and holds its graph task's check (x20, run_check). @param {AgentToolCtx} ctx */
  const holdsCheck = (ctx) => !!ctx.by && (subagents()?.checksOf?.(ctx.by.id)?.length ?? 0) > 0;
  /**
   * Whether a call's agent keeps the chat's checklist (the owner's tool plan of 11-08): the chat's own agent or a team's
   * lead, in a chat of Filament's, where the session has the task graph whose words send a short job to it. A sub-agent,
   * a graph task's or a worker is never offered it, as the loop's are not plan: its list would stand over the one of the
   * agent that launched it. Nor is an outside client's agent, whose own todo list its client draws and mirrors.
   * @param {AgentToolCtx} ctx
   */
  const keepsChecklist = (ctx) => ctx.graph && !!ctx.chain && !ctx.by && !ctx.report && !ctx.asksLead;
  /** The chat's skills for the agent a call comes from, or null where the session was given none. @param {AgentToolCtx} ctx */
  const skillsAt = (ctx) => (ctx.skills && ctx.chain && skills ? skills(ctx.chain, ctx.upstream, ctx.cwd) : null);
  /** @type {import("../core/ports.js").AgentTools} */
  const tools = {
    memoryOn,
    teamsOn: () => beside?.teamsOn?.() !== false,
    list: (ctx) => {
      const kept = machinesFor(ctx);
      const launch = launchTool(ctx, kept);
      const members = ctx.team && ctx.chain ? membersOf(ctx.chain) : null;
      const lead = ctx.team ? leadToolsOf(members) : null;
      // The order of the owner's tool plan of 11-08: the most used first, each family together, reads before writes; then
      // the tools held by name. A client's list is fixed for its session, so the order moves no cache.
      return [
        ...(ctx.graph && ctx.chain ? [lead ? defOf(lead.tasks, true) : TASKS_DEF] : []),
        ...(keepsChecklist(ctx) ? [CHECKLIST_DEF] : []),
        ...(ctx.chain && memory?.archive ? [RECALL_DEF] : []),
        // A lead's agent, worker and wait load whole: every lead calls them (the owner's tool plan of 11-08).
        ...(lead ? [defOf(teamAgentToolFor((ctx.chain && subagents()?.asks(ctx.chain)) || [], members), true), defOf(ctx.reads ? lead.workerReadsOwn : lead.worker, true), ctx.reads ? TEAM_WAIT_READS_DEF : TEAM_WAIT_DEF, ENVELOPE_DEF] : []),
        ...(launch ? [defOf(launch, true), CODER_WAIT_DEF, ENVELOPE_DEF] : []),
        ...(writesLead(ctx) ? [ENVELOPE_SUB_DEF] : []),
        ...(runsCommands(ctx) ? [kept ? BACKGROUND_MACHINE_DEF : BACKGROUND_DEF] : []),
        ...(holdsCheck(ctx) ? [RUN_CHECK_DEF] : []),
        ...(hasSkills(skillsAt(ctx)) ? [SKILL_DEF] : []),
        // Memory's, while its tools are on: never for a chat Memory settings leave out (`leftOut`).
        ...(memoryOn() && !ctx.leftOut ? memoryOrdered(agentMemoryMcpTools(memory)).map((t) => ({ ...t, upfront: true })) : []),
        ...(ctx.report ? [REPORT_DEF] : []),
        ...(ctx.asksLead ? [ASK_LEAD_DEF] : []),
        ...(ctx.visuals ? [VISUAL_GUIDE_DEF, SHOW_VISUAL_DEF] : []),
        ...(ctx.artifacts && artifacts ? [ARTIFACT_DEF] : []),
        ...(spaceAt(ctx)?.on?.() ? [SPACE_DEF] : []),
        ...(besideAt(ctx)?.on?.() ? [BESIDE_DEF] : []),
        ...(threadAt(ctx)?.on?.() ? [THREAD_DEF] : []),
        ...(flowAt(ctx)?.on?.() ? [FLOW_DEF] : []),
        ...(ctx.browser && ctx.chain && browsers() ? [BROWSER_DEF] : []),
        ...(craftAtOf(craft, ctx.chain) ? [CRAFT_DEF] : []),
      ];
    },
    has: (name) =>
      isMemoryTool(name) || name === TASKS_DEF.name || name === CHECKLIST_DEF.name || name === REPORT_DEF.name || name === ASK_LEAD_DEF.name || name === VISUAL_GUIDE_DEF.name || name === SHOW_VISUAL_DEF.name || name === ARTIFACT_DEF.name || name === SPACE_DEF.name || name === BESIDE_DEF.name || name === THREAD_DEF.name || name === FLOW_DEF.name || name === BROWSER_DEF.name || name === BACKGROUND_DEF.name || name === RUN_CHECK_DEF.name || name === SKILL_DEF.name || name === CRAFT_DEF.name || TURN_NAMES.has(name),
    async call(name, args, ctx) {
      if (isRecallTool(name)) {
        if (!ctx.chain || !memory?.archive) return { text: "Not run: recall reads a chat's own record, and this call stands in no chat.", isError: true };
        return { text: recall(memory.archive, ctx.chain, args || {}) };
      }
      if (isMemoryTool(name)) {
        if (ctx.leftOut) return { text: MEMORY_LEFT_OUT, isError: true };
        if (!memoryOn()) return { text: "Not run: memory's tools are off in Filament now.", isError: true };
        return { text: await callAgentMemoryTool(memory, name, args, { cwd: ctx.cwd, upstream: ctx.upstream, chain: ctx.chain, turn: ctx.turn, confined: !!ctx.confined, helper: !!ctx.by }) };
      }
      // The report reaches the run it ends — the latest when it gives several — as the loop's sub-agent's does; one
      // that does not read is the call's error, in its words.
      if (name === REPORT_DEF.name) {
        if (!ctx.report) return { text: "Not run: this session works on no task of the graph's.", isError: true };
        const r = readReport(args);
        if (!r.ok) return { text: r.error, isError: true };
        // Its checked is vetted as the loop's is (HarnessV3-TaskGraph-v2 TG2-D63), by the session the call is for.
        const refused = r.report.checked && ctx.chain ? (subagents()?.checkedProblem?.(ctx.chain, r.report.checked) ?? null) : null;
        if (refused) return { text: refused, isError: true };
        if (!ctx.emit) return { text: "Not run: your task's run has ended, so there is nothing to report to.", isError: true };
        ctx.emit({ type: "task-report", report: r.report });
        return { text: REPORT_IN };
      }
      // The chat's checklist (the owner's tool plan of 11-08): drawn on the running turn as the loop's plan is, the Todo
      // card and the status panel's Progress — and on the chat's task graph as the loop's is (HarnessV3-TaskGraph-v2
      // V2-5; the nudge map of 11-10, c-mirror): its items are tasks of the agent's own — or, while a task it added to its
      // graph runs, that task's steps (the owner's of 11-11) —, and a tick answers as the loop's does. Never a lead's,
      // which does no work itself: its answer is the list's count alone.
      if (name === CHECKLIST_DEF.name) {
        if (!keepsChecklist(ctx)) return { text: ctx.by || ctx.report || ctx.asksLead ? "Not run: a sub-agent keeps no checklist; the agent that launched you keeps the chat's." : "Not run: this session keeps no checklist of Filament's; use your own todo list.", isError: true };
        const c = checklistOf(args);
        if (!c.ok) return { text: c.error, isError: true };
        if (!ctx.emit) return { text: "Not run: no turn of the person's runs in this session now, so there is no chat to show it in.", isError: true };
        const runner = ctx.team ? null : graphs();
        // A list that names its task (`task`) is refused before anything is drawn where it names none of the agent's own
        // at work — or where its checklist is on no graph, a lead's.
        const refused = c.task ? (runner ? runner.stepsRefusal(/** @type {string} */ (ctx.chain), c.task) : stepsRefused()) : null;
        if (refused) return { text: refused, isError: true };
        ctx.emit({ type: "plan", items: c.items });
        // A coding agent's list (`solo`), as its tasks calls are: its tick offers only what its tasks tool takes.
        const onGraph = runner ? runner.plan(/** @type {string} */ (ctx.chain), c.items, { cwd: ctx.cwd || null, solo: true, ...(c.task ? { task: c.task } : {}) }) : null;
        if (onGraph?.changed && onGraph.view) ctx.emit({ type: "graph", graph: onGraph.view });
        // What the folder changed while the tasks it ended ran (E41 P2 case 11), once git has read it.
        const changed = onGraph?.more ? await onGraph.more : "";
        return { text: [onGraph?.text ? `${c.text} ${onGraph.text}` : c.text, changed].filter(Boolean).join("\n") };
      }
      // A worker's question to its lead (HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58): the call holds within the agent's
      // patience, as a lead's wait does, and the next call names the question to go on waiting — a plan's 3 minutes run
      // from the first.
      if (name === ASK_LEAD_DEF.name) {
        const ask = ctx.asksLead ? subagents()?.askLead : null;
        if (!ctx.asksLead || !ask) return { text: "Not run: you have no lead to ask in this session.", isError: true };
        const v = leadQuestionOf(args, { coder: true });
        if (!v.ok) return { text: v.error, isError: true };
        const r = await ask(ctx.asksLead, v.q, { n: v.n, withinMs: heldFor(ctx.patienceMs ?? MCP_PATIENCE_MS), emit: ctx.emit ?? null });
        return r.ok ? { text: leadAnswerWords(r) } : { text: r.error, isError: true };
      }
      // A visual (HarnessV4_Visuals_Plan E16): kept on the turn the call is filed on — a helper no turn launched keeps
      // it on its session (VS-D48), and so does the chat's own agent in a turn memory keeps no row of (`rowless`: one it
      // leaves out for a reason of its own, or whose situate or prepare failed), while that turn runs to draw it — under
      // the id and round of the agent's own call it came in, found by its name (Claude's, Codex's and Cursor's alike), as
      // the loop's is kept under its call's — an id of Filament's where no call of the agent's is found — and announced
      // on the turn's events.
      if (name === VISUAL_GUIDE_DEF.name) {
        const r = visualGuide(args);
        return r.ok ? { text: r.text } : { text: r.error, isError: true };
      }
      if (name === SHOW_VISUAL_DEF.name) {
        if (!ctx.visuals) return { text: VISUALS_OFF, isError: true };
        const home = visualHome(memory?.archive, { turn: Number(ctx.turn) || null, chain: ctx.chain ?? null, by: ctx.by ?? null, rowless: !!ctx.rowless && !!ctx.emit });
        if (!home) return { text: "Not shown: no turn of the developer's runs in this session now, so there is no chat to draw in.", isError: true };
        const own = ctx.callOf ? await ctx.callOf(SHOW_VISUAL_DEF.name) : null;
        const at = { id: own?.id ?? `v${randomBytes(6).toString("hex")}`, round: own?.round ?? null };
        const r = showVisual(args, at, home);
        if (!r.ok) return { text: r.error, isError: true };
        ctx.emit?.(visualEvent(at, r));
        return { text: r.text };
      }
      // An artifact (HarnessV4_Artifacts_Plan E18): its versions are read and published as the session's — or, for a
      // helper of the session, as that helper's (AF-D5) — a folder from inside the agent's folder or the ones its chat
      // adds; a version it publishes is said on the turn's events, under the id and round of the agent's own call where
      // it is found, as a visual is.
      if (name === ARTIFACT_DEF.name) {
        if (!ctx.artifacts || !ctx.chain || !artifacts) return { text: ARTIFACTS_OFF, isError: true };
        const at = {
          who: ctx.by ? `${ctx.chain}/${ctx.by.id}` : ctx.chain,
          by: { chain: ctx.chain, model: ctx.model || ctx.upstream, folder: ctx.cwd, helper: ctx.by?.id ?? null, ...(ctx.by ? { exchange: ctx.by.exchange } : {}) },
          within: [ctx.cwd, ...(ctx.dirs || [])],
          port: port(),
          maxBytes: maxBytes(),
        };
        // A publish names the agent's own call, which its chat finds the card by when it is read again (AF-D38).
        const publishing = String(args?.action ?? "").trim().toLowerCase() === "publish";
        const own = publishing && ctx.callOf ? await ctx.callOf(ARTIFACT_DEF.name) : null;
        // What its page names from the library hosts is fetched first, for the version to keep (vendor on publish); the
        // turn's stop ends the fetching, and a publish stopped so is not made.
        const pinned = publishing ? await pinnedFor(args, at, artifacts, ctx.signal || null) : null;
        if (pinned && ctx.signal?.aborted) return { text: PIN_STOPPED, isError: true };
        const r = artifactCall(args, { ...at, pinned }, artifacts, own?.id ?? null);
        if (!r.ok) return { text: r.error, isError: true };
        if (r.event && ctx.emit) ctx.emit({ ...r.event, ...(own ? { id: own.id, round: own.round } : {}) });
        return { text: r.text };
      }
      // The project's Space (proposal_ux §4.14): read and written as the chat's, a helper's line as that helper's. A
      // dashboard's button pressed (HarnessV4_AgentsSpace_Plan SA-D4) is judged by the session's switch as its command
      // would be — the permission card where it asks, with the button's words — as the browser's calls are.
      if (name === SPACE_DEF.name) {
        const at = spaceAt(ctx);
        if (!at) return { text: spaceOffFor(ctx.space !== false ? space : null, ctx.chain), isError: true };
        const permit = ctx.permit ?? null;
        /** @param {{ name: string, input: any }} call */
        const judge = async (call) => {
          if (!permit) return { ok: /** @type {const} */ (false), error: "no turn of this chat runs now to judge the press" };
          try {
            const p = call.input?.press;
            // An app's tool (the owner's of 11-05) by its own words.
            await permit([call], p?.tool ? `run the tool “${p.label}” of ${p.dashboard}` : `press “${p?.label || "a button"}” on ${p?.dashboard || "a dashboard"}`);
            return { ok: /** @type {const} */ (true) };
          } catch (/** @type {any} */ e) {
            return { ok: /** @type {const} */ (false), error: String(e?.message || e) };
          }
        };
        const r = await spaceRun(args, { ...at, judge, signal: ctx.signal || null });
        if (!r.ok) return { text: r.error, isError: true };
        // A routine or a watcher it proposed or changed is said under the agent's own call, where Filament finds it, as
        // an artifact's version is: the chat's card switches it on.
        if (r.event && ctx.emit) {
          const own = ctx.callOf ? await ctx.callOf(SPACE_DEF.name) : null;
          ctx.emit({ ...r.event, ...(own ? { id: own.id, round: own.round } : {}) });
        }
        return { text: r.text };
      }
      // A team beside the chat (team_v2_plan §5.5): fired as the main agent's, or how those beside it stand.
      if (name === BESIDE_DEF.name) {
        const at = besideAt(ctx);
        if (!at) return { text: ctx.beside && beside?.teamsOn?.() === false ? BESIDE_TEAMS_OFF : BESIDE_OFF, isError: true };
        const r = await besideCall(args, at, undefined, { mode: ctx.modeNow ?? null });
        return r.ok ? { text: r.text } : { text: r.error, isError: true };
      }
      // A thread (app/threads.js): a linked chat its agent starts, the person asked on the turn's card where it names
      // a folder that is not the chat's own, and held to reading where its turn is (`threadCtxOf`).
      if (name === THREAD_DEF.name) {
        const at = threadAt(ctx);
        if (!at) return { text: THREAD_OFF, isError: true };
        const r = await threadCall(args, at, threadCtxOf(ctx, args));
        return r.ok ? { text: r.text } : { text: r.error, isError: true };
      }
      // A flow beside the chat (HarnessV4_OneAgent_Plan OA3): drawn after /flow, changed, or read — never started.
      if (name === FLOW_DEF.name) {
        const at = flowAt(ctx);
        if (!at) return { text: FLOW_OFF, isError: true };
        const r = await flowCall(args, at);
        return r.ok ? { text: r.text } : { text: r.error, isError: true };
      }
      // A skill (HarnessV4_Skills_Plan S1-1): loaded, or looked in, from the chat's skills as they stand at the call.
      if (name === SKILL_DEF.name) {
        const set = skillsAt(ctx);
        if (!set || !hasSkills(set)) return { text: SKILLS_OFF, isError: true };
        // One of the Library's off here is loaded on demand all the same, turning nothing on (the owner's of 11-07).
        const got = skillAnswer(set.skills, args, set.plugins || null, set.library || []);
        return got.ok ? { text: got.text } : { text: got.text, isError: true };
      }
      // A skill crafted in a crafter chat (agent/craft-tool.js): made, its books added, looked in, written.
      if (name === CRAFT_DEF.name) {
        const at = craftAtOf(craft, ctx.chain);
        if (!at) return { text: CRAFT_OFF, isError: true };
        const r = await craftCall(args, at);
        return r.ok ? { text: r.text } : { text: r.error, isError: true };
      }
      // A long command in the background (HarnessV4_Background_Plan E34): its end comes back to the agent whole.
      if (name === BACKGROUND_DEF.name) {
        if (!commands || !runsCommands(ctx)) return { text: "Not run: this session has no turn of a chat for a command's end to reach.", isError: true };
        // With machine, on another machine (the remote-agents plan's c-tools): where the agent is offered it, the store
        // read for a call that names one alone.
        const there = args?.machine != null && String(args.machine).trim() !== "";
        return commands.call(args, { chain: ctx.chain, cwd: ctx.cwd, permit: ctx.permit ?? null, judgeNow: ctx.judgeNow ?? null, modeNow: ctx.modeNow ?? null, askPerson: ctx.askPerson ?? null, rulesAsk: ctx.rulesAsk ?? null, signal: ctx.signal ?? null, machines: there && machinesFor(ctx), agent: ctx.by ? `subagent:${ctx.by.id}` : null });
      }
      // The check of the graph task a sub-agent that only reads looks at, in a copy of the folder (x20).
      if (name === RUN_CHECK_DEF.name) {
        const reg = subagents();
        if (!ctx.by || !reg?.runCheck || !holdsCheck(ctx)) return { text: RUN_CHECK_OFF, isError: true };
        const r = await reg.runCheck(ctx.by.id, { signal: ctx.signal ?? null });
        return r.ok ? { text: r.text } : { text: r.error, isError: true };
      }
      // The chat's browser (AT-D7): the agent's own tab, a sub-agent's in tabs of its own, judged by the chat's switch as
      // the loop's calls are — looking runs, acting is refused in read-only, asks once per site in Edit on the
      // permission card, the person's yes kept for the chat and a worker's lead's for its team (the bug hunt of 10-30,
      // LOOP-2), and runs in Full access; a batch's later step is judged as its own call would be, and a page the rules
      // refuse is not read. A screenshot comes back as a picture.
      if (name === BROWSER_DEF.name) {
        const reg = browsers();
        if (!ctx.browser || !ctx.chain || !reg) return { text: BROWSER_OFF, isError: true };
        // The switch went off since the session was given the tool (the E27 hunt of 10-23): read at each call, as the
        // task graph's is.
        if (!browserOn(ctx.chain)) return { text: BROWSER_SWITCHED_OFF, isError: true };
        if (!ctx.permit || !ctx.judgeNow) return { text: "Not run: no turn of this chat runs now to judge the call.", isError: true };
        const chain = ctx.chain;
        const judgeNow = ctx.judgeNow;
        const seat = ctx.by ? { id: ctx.by.id, name: ctx.by.name || ctx.by.id } : null;
        const mine = reg.forAgent(chain, seat, ctx.by?.team || null);
        const page = mine.page();
        /** @type {{ asked: boolean, by?: "lead" }} */
        let yes;
        try {
          yes = await ctx.permit([{ name: BROWSER, input: { ...(args || {}), page } }], `use the browser: ${browserArgWords(args || {})}`);
        } catch (/** @type {any} */ e) {
          const why = String(e?.message || e);
          return { text: /read-only/.test(why) ? BROWSER_READ_ONLY : `Not run: ${why}.`, isError: true };
        }
        const site = actingSite(args || {}, page);
        if (yes.asked && site) mine.allow(site, yes.by === "lead");
        try {
          const got = await reg.call(chain, args || {}, {
            seat,
            // Stop reaches it: the turn's end, or the agent letting go of its call (the E27 hunt of 10-23).
            signal: ctx.signal || null,
            mayAct: (_site, p) => judgeNow([{ name: BROWSER, input: { action: "click", page: p } }]) === "run",
            mayLook: (p) => judgeNow([{ name: BROWSER, input: { action: "snapshot", page: p } }]) !== "refuse",
          });
          return got instanceof MediaResult ? { text: got.text, media: got.media } : { text: String(got) };
        } catch (/** @type {any} */ e) {
          return { text: String(e?.message || e), isError: true };
        }
      }
      // A sub-agent's letter to the agent that launched it, or its answer to that agent's (app/letters.js): nothing
      // reaches it sealed — its lead's letters come whole, at its next step — so there is nothing for it to open.
      if (name === ENVELOPE_TOOL.name && writesLead(ctx)) {
        if (!writesLetter(args)) return { text: 'Not run: nothing reaches a sub-agent sealed — the letters of the agent that launched you come whole, at your next step. To write it, give to: "lead", subject and text.', isError: true };
        const r = subagents()?.subLetter?.(/** @type {{ id: string }} */ (ctx.by).id, args) ?? null;
        if (!r) return { text: "Not sent: this session sends no letters.", isError: true };
        if (r.sent && ctx.emit) {
          const own = ctx.callOf ? await ctx.callOf(ENVELOPE_DEF.name) : null;
          ctx.emit({ type: "letter-sent", letter: r.sent.id, to: r.sent.to, title: r.sent.title, subject: r.sent.subject, reply: r.sent.reply, answer: args?.answer != null && String(args.answer).trim() !== "", ...(own ? { id: own.id } : {}) });
        }
        return r.ok ? { text: r.text } : { text: r.text, isError: true };
      }
      // The chat's agent dismisses lines of what is still open that no longer hold (agent/still-open.js, the owner's of
      // 11-09): kept with the chat, whether a turn runs or not — a call of its own, as the loop takes it.
      if (name === ENVELOPE_TOOL.name && dismisses(args)) {
        if (!ctx.chain || !dismiss) return { text: "Not run: this session has no list of what is still open to dismiss from.", isError: true };
        return { text: dismissAnswer(dismiss(ctx.chain, args.dismiss), otherThanDismiss(args)) };
      }
      if (name !== TASKS_DEF.name && !TURN_NAMES.has(name)) throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32601 });
      // A plain chat given Filament's agent tool has agent and wait of a lead's three.
      const launches = !ctx.team && !!ctx.launch && name !== WORKER_TOOL.name;
      if (TURN_NAMES.has(name) && !ctx.team && !launches) return { text: "Not run: this session's agent leads no team.", isError: true };
      const runner = graphs();
      if (name === TASKS_DEF.name) {
        if (!ctx.graph || !ctx.chain || !runner) return { text: "Not run: this session has no task graph.", isError: true };
      }
      // A lead's call goes to its turn while that turn runs; so does a plain chat's launch and its wait.
      if (ctx.team || TURN_NAMES.has(name)) {
        const turn = turns.get(ctx.chain);
        if (!turn)
          return {
            text: ctx.team
              ? "Not run: your turn as the team's lead has ended. Your workers' reports reach you with the developer's next message."
              : "Not run: Filament holds no turn of the developer's for this session now, so there is nothing to launch from or wait in. A report still owed reaches you with the developer's next message.",
            isError: true,
          };
        return turn.call(name, args, { patienceMs: ctx.patienceMs });
      }
      // The call's folder is the coding agent's: what a task it starts changes there is read from git (E41 P2 case 11).
      const r = runner.apply(/** @type {string} */ (ctx.chain), args, { crew: "agent", solo: true, cwd: ctx.cwd || null });
      if (!r.ok) return { text: r.error, isError: true };
      if (r.view) ctx.emit?.({ type: "graph", graph: r.view });
      const changed = r.more ? await r.more : "";
      const words = changed ? `${r.text}\n${changed}` : r.text;
      // An image kept behind a task, read (E33), as the browser's look goes.
      return r.media?.length ? { text: words, media: r.media } : { text: words };
    },
  };
  // What its turn owes the chat's own agent rides the end of each answer (`tails`, checkpoint.js "tool-answer").
  return { ...tools, call: async (name, args, ctx) => tailed(await tools.call(name, args, ctx), name, ctx) };
  /**
   * The answer with what the chat's turn owes its agent at its end (tool-tail.js): only the chat's own agent's — never a
   * sub-agent's, a graph task's or a worker's, whose words are their own turn's, nor that of a sub-agent of the agent's
   * own, which calls over the agent's session: the run says whose call it came in (`callIsOwn`), and where it cannot
   * tell, the answer takes them; and none on a call given up, whose answer reaches nobody.
   * @template {{ text: string }} R @param {R} r @param {string} name @param {AgentToolCtx} ctx @returns {Promise<R>}
   */
  async function tailed(r, name, ctx) {
    if (!tails || !ctx.chain || ctx.by || ctx.report || ctx.asksLead || ctx.signal?.aborted || !tails.owes(ctx.chain)) return r;
    if (ctx.callIsOwn && (await ctx.callIsOwn(name)) === false) return r;
    if (ctx.signal?.aborted) return r;
    const more = tails.take(ctx.chain);
    return more ? { ...r, text: r.text ? `${r.text}\n\n${more}` : more } : r;
  }
}
