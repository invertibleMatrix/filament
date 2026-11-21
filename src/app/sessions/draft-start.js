// @ts-check
// The first request of a session not born yet, weighed part by part (HarnessV3-NewTask NT-D5/D6/D8): the New Task
// board's figures. Each part comes from the function the turn itself uses — the engine rule the parse stage asks
// (`harnessRunsLoop`), the loop's system prompt (`loopSystem`), its tool set (`loopToolArgs`), memory's and recall's
// tool definitions, the window and the compaction line every request of the session is measured by. What only the
// first turn can know is said, not guessed: memory's briefing and recall are built from the first message (their
// ceilings, `upTo`), and an MCP server's tools are counted once it connects (the servers are named). Nothing here
// calls a model or writes anything (NT-D11): it reads the instruction files, the skill folders and memory's counts.
import { estimateTokens } from "../../core/tokens.js";
import { parseModelSuffix } from "../../core/shaping.js";
import { sessionWindowFor } from "../../core/model-families.js";
import { findRoute, findUpstream } from "../../core/routing.js";
import { teamRow } from "../../core/roster.js";
import { foldedTeamWords } from "../../core/folded-teams.js";
import { nativeCapable } from "../../core/catalogues.js";
import { BRIEFING_TOKENS, isAgentUpstream } from "../../core/schema.js";
import { harnessRunsLoop, engineProblem } from "../engine.js";
import { loopSystem } from "../agent/system.js";
import { environmentSummary } from "../agent/environment.js";
import { instructionsBlock } from "../agent/instructions.js";
import { addedFoldersOf, loopConfig, disabledTools, parseAgentModel } from "../agent/turn.js";
import { ENVELOPE_TOOL, TEAM_WAIT_OWN_TOOL, TEAM_WAIT_TOOL, leadToolsOf, loopToolArgs } from "../agent/tools.js";
import { SPACE } from "../agent/space.js";
import { BESIDE_TEAM } from "../agent/beside-tool.js";
import { TEAMS_OFF_WHY, teamsOn } from "../../core/teams-on.js";
import { SKILL_TOOL, SKILL_TOOL_NAME, calledNotes, loadSkills, triggeredSkills } from "../agent/skills.js";
import { browserOffered } from "../agent/browser-tool.js";
import { spaceable } from "../../core/space.js";
import { leadWords } from "../agent-lead.js";
import { memoryToolDefs, recallToolDef } from "../memory-tools.js";
import { usableWindow } from "./compaction.js";
import { readsAlong, mcpServerProblem, sessionEngineOf } from "../../services/session-settings.js";

/**
 * The loop's switches that reach a coding agent (acp-turn.js `toolsAt`; the owner's look of 10-24): Filament's browser,
 * pictures, artifacts, Space, teams, flows and threads ride its MCP server on the chat's own switches. The rest of the loop's
 * tools are the agent's own to do — files, commands, the web's fetch and search, questions, plans.
 */
export const AGENT_REACHES = Object.freeze(["browser", "show_visual", "artifact", SPACE, "team", "flow", "thread"]);

/**
 * Which engine the session's turns will reach (NT-D8): a coding agent's own route, the agent loop (the harness runs a
 * plain route on it — the parse stage's rule), a team whose lead is that loop (HarnessV3-AtHome P2: the draft's document
 * chooses a team that can lead, app/engine.js's rule), or the plain model where the loop does not run it (its route's
 * own upstream is switched off: the loop itself is always on, the owner's of 11-09). A coding agent leads
 * a team as itself (HarnessV3-ACP AC6-3; HarnessV4_Tasks B12): its route stays its own — `agent` — with the `team`
 * it leads. `none` says why nothing would answer.
 * @param {any} cfg @param {string} name
 * @param {{ mode: string, team?: string | null } | null} [engine]  the draft's engine (sessionEngineOf)
 * @param {import("../engine.js").Teams | null} [teams]
 * @param {boolean} [teamChat]  the session is a team's own chat, which its team leads while teams are off (engine.js `engineProblem`)
 * @returns {{ kind: "loop" | "model" | "agent" | "team" | "none", model: string | null, why?: string, team?: { key: string, name: string } }}
 */
export function draftEngine(cfg, name, engine = null, teams = null, teamChat = false) {
  const r = soloEngine(cfg, name);
  if ((r.kind !== "loop" && r.kind !== "agent") || engine?.mode !== "team" || engineProblem(engine, cfg, teams, teamChat)) return r;
  const found = /** @type {{ key: string, name: string }} */ (teams?.find(engine.team));
  const team = { key: found.key, name: found.name };
  return r.kind === "agent" ? { ...r, team } : { kind: "team", model: r.model, team };
}

/**
 * The engine a name reaches when no team leads: draftEngine's answer before the session's own choice.
 * @param {any} cfg @param {string} name
 * @returns {{ kind: "loop" | "model" | "agent" | "none", model: string | null, why?: string }}
 */
function soloEngine(cfg, name) {
  const n = String(name || "").trim();
  if (!n) return { kind: "none", model: null, why: "no model chosen yet" };
  const base = parseModelSuffix(n, cfg.rules).base;
  const agentName = parseAgentModel(n)?.model;
  if (agentName) return { kind: "loop", model: agentName };
  const route = findRoute(cfg, base) || findRoute(cfg, n);
  if (!route) return { kind: "none", model: n, why: `no route matches "${n}" — add one on the Routes page` };
  if (isAgentUpstream(findUpstream(cfg, route.upstream))) return { kind: "agent", model: n };
  return harnessRunsLoop(cfg, n, base) ? { kind: "loop", model: n } : { kind: "model", model: n };
}

/**
 * Whether a coding agent's turns work with Filament's hands — its Read, Write, Edit, Bash, Glob and Grep in place of
 * the agent's own: its upstream's client bridge is native, and the agent can switch its own off (toolset.js).
 * @param {any} cfg @param {string | null | undefined} name
 */
function nativeHands(cfg, name) {
  const n = String(name || "").trim();
  const route = n ? findRoute(cfg, parseModelSuffix(n, cfg.rules).base) || findRoute(cfg, n) : null;
  const up = route ? findUpstream(cfg, route.upstream) : null;
  return !!up && up.acp?.clientBridge === "native" && nativeCapable(up.acp, up);
}

/**
 * Why no team can lead a draft, in the board's words, or null (HarnessV4_Tasks E15 step 6, AG-173): Settings ›
 * Experimental's Teams switch is off; nothing would answer yet; Filament's loop does not run the model; or the task
 * switched off the agent tool a lead launches its workers with.
 * draftEngine's own rules, said before a team is named.
 * @param {any} cfg @param {ReturnType<typeof draftEngine>} engine  the draft's engine
 * @param {{ agentOff: boolean }} chosen  the draft's own choice (sessionEngineOf)
 * @returns {string | null}
 */
function noTeamWhy(cfg, engine, chosen) {
  if (engine.team) return null;
  if (!teamsOn(cfg)) return TEAMS_OFF_WHY;
  if (engine.kind === "none") return engine.why || "nothing would answer yet";
  if (engine.kind === "model") return `Filament's agent loop does not run ${engine.model}, and a team works on it`;
  if (chosen.agentOff) return "the agent tool is off for this chat (the Tools card), and a lead launches its workers with it";
  return null;
}

/**
 * The anatomy of the first request, and the choices the board draws (NT-D5, NT-D9).
 * `environment` is the folder's capture (HarnessV3-SystemPrompt): the loop names it, the model and the window in its
 * prompt, so the prompt part weighs the section the first turn sends. `teams` are where the draft's team is found: its
 * lead sends a lead's prompt with its team's persona, a lead's tools — both naming its team's members — and the
 * session's MCP servers, as any agent does (HarnessV4_Tasks decision 9). `who` is the board's first row (HarnessV4_Tasks E15 step 6, AG-173): the teams there are,
 * whether the start asks for one, the one that leads, why no team can lead — and what is wrong with a team the start
 * names that is none.
 * `asks`: the saved agents the draft's agent may ask (its `subagents.ask`, HarnessV4_Tasks E15 step 3), which its
 * agent tool lists and its prompt speaks of. `modelsOf`: what each of a team's members would run on — the team's model
 * for it, else its card's, or the draft's pool (the registry's, HarnessV3-TaskGraph-v2 TG2-D47, §13.12) — which its
 * lead's lines name.
 * `mcpTested`: an MCP server's last test in Settings › MCP servers, by its spec, or null. The space tool rides where
 * the draft belongs to a project, as the turn offers it (team_v2_plan TV2-D7; app/agent/space.js).
 * @param {{ cfg: any, eff: any, cwd: string, projectId: string, text?: string, memory?: any, modelProblem?: ((name: string) => string | null) | null,
 *   environment?: import("../agent/environment.js").EnvironmentFacts | null, teams?: import("../../services/teams.js").TeamStore | null,
 *   asks?: readonly import("../agent/tools.js").Askable[], places?: readonly import("../agent/tools.js").Askable[],
 *   modelsOf?: ((members: readonly { tag: string, card?: string, own?: { model?: string } }[], leadModel: string) => import("../agent/prompt.js").TeamModels | null) | null,
 *   mcpTested?: ((spec: any) => { ok: boolean, words: string } | null) | null,
 *   spaceMade?: ((project: string) => boolean) | null, excluded?: string | null, outside?: boolean }} a
 *   `spaceMade`: whether a project has a Space (10-29: one the person made) — the space tool rides only there; none
 *   given, every project's chat has it. `excluded`: why Memory settings leave the chat out (memory/brain.js
 *   `capturedOut`), or null — none of memory's parts ride its first request there — no briefing, no recall, no memory
 *   tools (D4 of 11-01) — while the recall tool does, which reads the chat's own record; the answer's `memory.out`
 *   says why. `outside`: a chat outside a project, in Everything's folder (app/everything.js) — its memory counts
 *   what holds everywhere too (`memory.knows.everywhere`), what it draws on beside Everything's own
 */
export function startAnatomy({ cfg, eff, cwd, projectId, text = "", memory = null, modelProblem = null, environment = null, teams = null, asks = [], places = [], modelsOf = null, mcpTested = null, spaceMade = null, excluded = null, outside = false }) {
  const name = String(eff?.model?.name || "").trim();
  const chosen = sessionEngineOf(eff);
  const engine = draftEngine(cfg, name, chosen, teams);
  const noTeam = noTeamWhy(cfg, engine, chosen);
  const w = engine.model ? sessionWindowFor(cfg, engine.model, eff?.model?.window) : { tokens: 0, source: null };
  const windowTokens = Number(w.tokens) || 0;
  const comp = eff?.context?.compaction || {};
  // A team's lead is the loop (HarnessV3-AtHome P2) with a lead's prompt and tools; the session's MCP servers are its as
  // they are its workers' (HarnessV4_Tasks decision 9). A coding agent that leads builds its own context: Filament's side of it is the lead's part, which
  // rides its system channel, and its team's tools, which reach it over Filament's MCP server (HarnessV3-ACP AC6-3).
  const team = engine.team ? teams?.find(engine.team.key) || null : null;
  const lead = team ? { name: team.name, persona: team.persona, members: team.members, models: modelsOf?.(team.members, engine.model || "") ?? null } : null;
  const loop = engine.kind === "loop" || engine.kind === "team";
  const agentLead = engine.kind === "agent" ? lead : null;
  // A $<name> in the draft names a skill its agent loads with the skill tool as it needs it (agent/turn.js); a plugin's
  // command it names rides its message whole, as the turn sends it.
  const skillsBase = loop ? loadSkills(eff) : null;
  const commands = skillsBase ? calledNotes(skillsBase, String(text || "")).filter((c) => c.skill.kind === "command") : [];
  const message = estimateTokens([String(text || ""), ...commands.map((c) => c.text)].join("\n\n"));

  // --- the loop's furniture: its prompt, the instructions and skills, its tools (only the loop sends them) ---
  const al = loopConfig(cfg.agentLoop || {}, eff?.loop || null);
  const off = disabledTools(al.tools);
  // What the turn leaves out besides the person's switches: the space tool, where the draft's project has no Space, and
  // the team tool while Settings › Experimental's Teams switch is off (core/teams-on.js).
  const space = spaceable(projectId) && (!spaceMade || spaceMade(projectId));
  const sendOff = [...off, ...(space ? [] : [SPACE]), ...(teamsOn(cfg) ? [] : [BESIDE_TEAM])];
  // The reader model behind delegate_read: offered under the loop's own rule — switched off, the loop itself, or a
  // model the loop would refuse leaves the tool out.
  let readerModel = String(al.readerModel || "").trim();
  if (readerModel && (off.includes("delegate_read") || parseAgentModel(readerModel) || modelProblem?.(readerModel))) readerModel = "";
  const webDoc = eff?.plugins?.web || null;
  const web = webDoc ? { fetch: webDoc.fetch === true, search: webDoc.search === true } : null;
  // A lead that reads along with its workers (HarnessV3-TaskGraph-v2 §12): its prompt and its tools say so — the loop's,
  // a coding agent's in its own words, and the loop's own agent with its graph's sub-agents.
  const supervise = (loop || !!agentLead) && readsAlong(eff);
  // The agent's browser, on the session's switch (HarnessV4_Browser_Plan BR-D5): its tool and its prompt's line.
  const browser = browserOffered(eff, off);
  const sys = loop ? loopSystem({ cfg, doc: eff, root: cwd, readerModel, off: sendOff, web, mcp: [], lead, environment, model: engine.model || "", window: windowTokens, graph: true, asks: asks.length > 0 && !off.includes("agent"), supervise, added: addedFoldersOf(cfg, eff?.loop?.addedFolders).folders, browser, skillSet: skillsBase }) : null;
  const lt = agentLead ? leadToolsOf(agentLead.members) : null;
  // The skill tool rides where the Library or the plugins on hold a skill, after the loop's own and its MCP tools, as
  // the turn sends it (B4; prompt version 54).
  const own = loop
    ? [
        // A chat's own agent may come back to it later (agent/come-back.js): a lead's chat goes on with its team.
        ...loopToolArgs({ delegateRead: !!readerModel, disabled: sendOff, web, lead: !!lead, members: lead?.members ?? null, graph: true, supervise, asks: off.includes("agent") ? [] : asks, places: off.includes("agent") ? [] : places, browser, comeBack: !lead }),
        ...(sys && sys.skillSet.skills.length + (sys.skillSet.library?.length ?? 0) > 0 && !sendOff.includes(SKILL_TOOL_NAME) ? [SKILL_TOOL] : []),
      ]
    : lt
      ? [lt.agent, supervise ? lt.workerReadsOwn : lt.worker, supervise ? TEAM_WAIT_OWN_TOOL : TEAM_WAIT_TOOL, ENVELOPE_TOOL, lt.tasks]
      : [];
  // The system prompt split three ways that add up to what the loop sends: the instruction block without the skills
  // (the files and the session's text), the skills it carries (the catalogue and the plugins on), and the
  // rest — the loop's own prompt, its Environment section included.
  const systemTokens = sys ? estimateTokens(sys.text) : agentLead ? estimateTokens(leadWords(agentLead, { supervise, models: agentLead.models })) : 0;
  const blockTokens = sys?.instr ? estimateTokens(sys.instr.text) : 0;
  const plainTokens = sys ? estimateTokens(instructionsBlock(eff, cwd).text) : 0;
  const servers = (Array.isArray(eff?.plugins?.mcp) ? eff.plugins.mcp : []).filter((m) => m && !mcpServerProblem(m));
  const mcp = servers.map((m) => String(m.name || "server"));
  // Each server's last test, for the Tools card's dot (HarnessV4_Settings_Plan HC-26): null where none ran.
  const mcpTests = Object.fromEntries(servers.map((m) => {
    const t = mcpTested?.(m) || null;
    return [String(m.name), t ? { ok: !!t.ok, words: String(t.words || "") } : null];
  }));
  // A plugin's servers, by the plugin each came with (HarnessV4_SpacesPlugins_Plan B5): its chip says so.
  const mcpFrom = Object.fromEntries(servers.filter((m) => typeof m.plugin === "string").map((m) => [String(m.name), String(m.plugin)]));

  // --- memory: what rides on the first request, and its ceilings ---
  const memCfg = cfg.memory || {};
  const auto = { briefingTokens: BRIEFING_TOKENS, turnTokens: 300, tools: true, ...(memCfg.autopilot || {}) };
  const memGlobal = memCfg.enabled === true;
  // Memory's autopilot recalls and offers tools; off (Memory settings), the turns are recorded and nothing is added.
  const autopilot = memGlobal && auto.enabled !== false;
  const memOn = memGlobal && eff?.memory?.enabled !== false;
  const memReady = !!memory?.archive;
  // A chat Memory settings leave out (`excluded`) has none of memory's parts, as its turns carry none (D4 of 11-01) —
  // the recall tool aside, which reads the chat's own record, kept there too.
  const memIn = memReady && !excluded;
  // A coding agent gets memory's briefing and recall through its own channels, and memory's tools over
  // Filament's MCP server (HarnessV3-ACP AC4-1, AC4-2) — never the recall tool, which reads what only the loop leaves.
  const agent = engine.kind === "agent";
  // The skills on here, as the loop's prompt read them, else read for the board.
  const skillSet = sys?.skillSet || loadSkills(eff);
  // What Filament hands it beside its own tools, as its turn decides (acp-turn.js `toolsAt`): each on the chat's own
  // switch, the Space where the chat has a project. `hands`: whose files and commands it works with.
  const switchedOff = (/** @type {string} */ n) => eff?.loop?.tools?.[n] === false;
  const agentAdds = agent
    ? AGENT_REACHES.filter((n) => (n === "browser" ? browserOffered(eff, switchedOff(n) ? [n] : []) : !switchedOff(n) && (n !== SPACE || space) && (n !== BESIDE_TEAM || teamsOn(cfg))))
    : [];
  const adds = memIn && autopilot && memOn;
  const memTools = adds && eff?.memory?.tools !== false && auto.tools !== false ? memoryToolDefs("anthropic") : [];
  const recall = memReady && !agent ? [recallToolDef("anthropic")] : [];
  const briefingUpTo = adds && eff?.memory?.briefing !== false ? Math.max(300, Number(auto.briefingTokens) || BRIEFING_TOKENS) : 0;
  const turnTokens = Number(eff?.memory?.turnTokens ?? auto.turnTokens ?? 300) || 0;
  // The first turn's per-turn recall, the brain's rule (`turnBudget`): memory's turn budget where the briefing recalls on
  // the same words, half again where the session turns the briefing off.
  const recallUpTo = adds && eff?.memory?.turnBlock !== false ? Math.round(turnTokens * (briefingUpTo ? 1 : 1.5)) : 0;
  let knows = null;
  try {
    const row = memReady ? memory.archive.projects().find((/** @type {any} */ p) => p.id === projectId) : null;
    knows = { memories: Number(row?.items) || 0, dossier: Number(row?.dossier) || null };
  } catch {
    knows = null;
  }
  // Outside a project, the memories that hold everywhere, as Library › Memory › Everywhere counts them: the briefing
  // names the user's word among them, and recall reaches them as it reaches every project's.
  if (knows && outside) {
    try {
      knows = { ...knows, everywhere: Number(memory.claimScopes?.()?.find((/** @type {any} */ s) => s.project === null)?.claims) || 0 };
    } catch {}
  }

  const tools = [...own, ...memTools, ...recall];
  const toolTokens = tools.length ? estimateTokens(JSON.stringify(tools)) : 0;
  const parts = [
    { id: "prompt", tokens: Math.max(0, systemTokens - blockTokens) },
    { id: "instructions", tokens: Math.min(plainTokens, blockTokens) },
    { id: "skills", tokens: Math.max(0, blockTokens - plainTokens) },
    { id: "tools", tokens: toolTokens },
    { id: "memory", tokens: briefingUpTo + recallUpTo, upTo: true },
    { id: "message", tokens: message },
  ];
  return {
    engine,
    who: {
      // None listed while Settings › Experimental's Teams switch is off: `off` says why.
      teams: teamsOn(cfg) ? (teams?.list() || []).map(teamRow) : [],
      asked: chosen.mode === "team",
      team: engine.team?.key ?? null,
      off: noTeam,
      problem:
        noTeam || engine.team || chosen.mode !== "team"
          ? null
          : chosen.team
            ? `it names the team "${chosen.team}", and there is no such team${foldedTeamWords(chosen.team) ? ` — ${foldedTeamWords(chosen.team)}` : ""}`
            : "it names no team",
    },
    window: { tokens: windowTokens || null, source: windowTokens ? w.source || null : null },
    line: { percent: Number(comp.thresholdPercent) || 85, tokens: windowTokens ? usableWindow(windowTokens, comp) : null },
    parts,
    // What the loop itself measures as its fixed part (its window event's `fixed`): the system prompt and its own
    // tools — the figure a test holds the board to on a real first turn.
    loopFixed: sys ? systemTokens + estimateTokens(JSON.stringify(own)) : 0,
    // What the prompt's Environment tells the agent, in the board's few words (null when the loop sends none).
    environment: sys?.environment ? environmentSummary(environment) : null,
    instructions: sys?.instr
      ? { files: sys.instr.files.map((f) => ({ file: f.file, chars: f.chars, truncated: !!f.truncated, ...(f.from ? { from: f.from } : {}) })), missing: sys.instr.missing, sessionChars: sys.instr.sessionChars || 0 }
      : { files: [], missing: [], sessionChars: 0 },
    // The skills on here: the loop's prompt lists them, a coding agent's skill tool offers them; plain chat takes none,
    // and its card still names those on here, greyed, so none reads as none on.
    skills: {
      on: (Array.isArray(eff?.skills?.on) ? eff.skills.on : []).filter((/** @type {any} */ s) => s?.enabled !== false).map((/** @type {any} */ s) => String(s?.name)),
      // A plugin's skill says its plugin: on where the plugin is, it has no switch of its own here.
      list: skillSet.skills.map((k) => ({ name: k.name, description: k.description, ...(k.plugin ? { plugin: k.plugin } : {}) })),
      // Those on here the draft names as $<name>: its agent loads each as it needs it (agent/turn.js).
      triggered: triggeredSkills(skillSet.skills, String(text || "")).map((k) => k.name),
      problems: skillSet.problems,
    },
    tools: {
      offered: own.map((t) => String(t.name)),
      off,
      ...(agent ? { adds: agentAdds, hands: nativeHands(cfg, engine.model) ? "native" : "own" } : {}),
      memory: memTools.length,
      recall: recall.length > 0,
      mcp,
      mcpTests,
      mcpFrom,
    },
    // `out`: why Memory settings leave the chat out, in their words, or null.
    memory: { global: memGlobal, autopilot, on: memOn, ready: memReady, briefing: briefingUpTo, recall: recallUpTo, tools: memTools.length > 0, knows, out: excluded || null },
  };
}
