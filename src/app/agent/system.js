// @ts-check
// The loop's system prompt, assembled in one place (HarnessV3-NewTask NT-D6): the request's own system text (memory's
// briefing and the goal), the loop's prompt — its sections and the session's Environment (HarnessV3-SystemPrompt) — then the instruction files and
// the session's text, the skills catalogue and the plugins on (a line each) — a skill the newest message calls as $<name> or /<name> rides that message (turn.js), never this prompt. The loop sends it; the New Task
// board weighs it before the session exists — one function, so the figure the board shows is the one the loop's first
// request carries.
import { systemPromptFor } from "./prompt.js";
import { instructionsBlock } from "./instructions.js";
import { environmentText } from "./environment.js";
import { loadSkills, skillsSections } from "./skills.js";

/**
 * The system prompt a loop turn sends, and the parts it is made of. `doc` null (a fork, which runs on the main agent's
 * furniture as it was sent, or a request riding no document) reads no instruction file and no skill. A sub-agent
 * (`host`) never carries the operator's overlay; a team's worker (its `team`) gets its role's
 * prompt. A team's lead (`lead`, HarnessV3-AtHome P2) gets a lead's prompt with its team's name and persona — and the
 * models its members run on (`models`, HarnessV3-TaskGraph-v2 TG2-D47: a card's, or the session's pool) — and no
 * overlay either: the overlay speaks to the developer's own agent. `environment` is the session's frozen capture (null
 * leaves the section out); `model` and `window` are the turn's, named in it. `graph`: the session's task graph is on
 * (HarnessV3-TaskGraph), and the prompt has its section; a sub-agent doing one of its tasks (its host's `task`) — or
 * reviewing one's change — is told how its report ends it. `withoutMcp` is the same text without the sentence naming
 * the MCP servers — what they add to the prompt, for `/autofit` (HarnessV3-Tools TL-D22). `supervise`: a team's lead
 * reads along with its workers (HarnessV3-TaskGraph-v2 §12) — the lead's prompt, and a worker's, say so.
 * @param {{ cfg: any, doc: any, root: string, readerModel?: string, off?: readonly string[],
 *   web?: { fetch?: boolean, search?: boolean } | null, mcp?: readonly { name: string, tools: number, names?: readonly string[] }[],
 *   host?: { readOnly?: boolean, asks?: boolean, team?: { name: string, role: string, words: string } | null,
 *     task?: { id: string, review: boolean } | null, card?: { name: string, thinks: string, asked?: boolean } | null } | null,
 *   lead?: { name: string, persona: string, members?: readonly import("../../core/roster.js").Member[] | null, models?: import("./prompt.js").TeamModels | null, readOnly?: boolean, held?: boolean } | null, requestSystem?: string,
 *   environment?: import("./environment.js").EnvironmentFacts | null, model?: string, window?: number, graph?: boolean,
 *   asks?: boolean, supervise?: boolean, noTools?: boolean, added?: readonly string[], browser?: boolean, skillSet?: { skills: import("./skills.js").Skill[], problems: string[], plugins?: import("./skills.js").PluginSet[], library?: import("./skills.js").LibrarySkill[] } | null, hooksSaid?: string, instructionsKept?: import("./instructions.js").InstructionsBlock["read"] | null }} a  `asks`: the session names
 *   saved agents its agent may ask (HarnessV4_Tasks E15 step 3); `supervise`: whoever hands work out reads along with
 *   those who do it (HarnessV3-TaskGraph-v2 §12); `noTools`: the model takes no tools (HarnessV4_Tasks E4), and the
 *   prompt says so where it would name them; `added`: the folders added to the working folder for reading, as they
 *   passed (`addedFoldersOf`, HarnessV4_Overnight_Plan OV-D22); `browser`: the session offers the browser tool
 *   (HarnessV4_Browser_Plan BR2); `hooksSaid`: what a plugin's session-start hooks said, kept for the chat (hooks.js
 *   `hookContext`); `instructionsKept`: the instruction files as the chat's prompt was written with them, told as they
 *   were until its next compaction (instructions.js `read`)
 */
export function loopSystem({ cfg, doc, root, readerModel = "", off = [], web = null, mcp = [], host = null, lead = null, requestSystem = "", environment = null, model = "", window = 0, graph = false, asks = false, supervise = false, noTools = false, added = [], browser = false, skillSet: given = null, hooksSaid = "", instructionsKept = null }) {
  // The skills the turn read once for its skill tool (HarnessV4_SpacesPlugins_Plan B4), else read here.
  const skillSet = given || (doc ? loadSkills(doc) : { skills: [], problems: [], plugins: [], library: [] });
  // What a plugin's hooks said at the chat's start rides with them, as Claude keeps a SessionStart hook's context.
  const startSaid = hooksSaid ? [`# Said by the plugins' hooks at this chat's start
${hooksSaid}`] : [];
  const instr = doc ? instructionsBlock(doc, root, { extra: [...skillsSections(skillSet.skills, { tool: !noTools, plugins: skillSet.plugins }), ...startSaid], kept: instructionsKept }) : null;
  // The operator's overlay (agentLoop.systemPrompt) replaces the loop's role and report text.
  const overlay = host || lead ? "" : String(cfg?.agentLoop?.systemPrompt || "").trim();
  // Parallelize tasks, Settings › Experimental's for every chat (the owner's of 11-09), or the chat's own where it has
  // one (`subagents.parallelize`, its card's Always accept in this chat, the owner's of 11-16): the main agent's prompt
  // says it once, the person's consent — a flip writes it anew at the next turn, and the New Task board weighs it the same.
  const own = doc?.subagents?.parallelize ?? null;
  const parallel = own == null ? cfg?.experimental?.parallelizeTasks === true : own === true;
  // Filament's co-author line on a commit, Settings › Agent loop's for every chat and on unless switched off (version
  // 108): every prompt's git line says it, a sub-agent's too, and a flip writes it anew at the next turn.
  const trailer = cfg?.sessions?.commitTrailer !== false;
  const env = environment ? environmentText(environment, { model, window }) : "";
  const team = host?.team || null;
  const worker = team ? { team: team.name, words: team.words } : null;
  /** @param {readonly { name: string, tools: number, names?: readonly string[] }[]} servers */
  const promptOf = (servers) => systemPromptFor({ root, delegateRead: !!readerModel, toolsOff: off, web, mcp: servers, overlay, subagent: !!host, attended: !!host?.asks && !team, readOnly: !!host?.readOnly, card: host?.card || null, task: host?.task ? (host.task.review ? "review" : "work") : null, lead, worker, environment: env, graph, asks, supervise, noTools, added, browser, parallel, trailer });
  /** @param {string} p */
  const textOf = (p) => [requestSystem, p, instr?.text || ""].filter((x) => x && String(x).trim()).join("\n\n");
  const prompt = promptOf(mcp);
  const text = textOf(prompt);
  const withoutMcp = mcp.length ? textOf(promptOf([])) : text;
  return { skillSet, instr, overlay, prompt, environment: env, text, withoutMcp };
}
