// @ts-check
// The session's engine (HarnessV3 §11, Step 5 D1), as pure answers: what answers a harness turn whose session chose an
// engine (engine.mode) — the model the turn names, or a team whose lead is the agent loop on it
// (HarnessV3-AtHome P2) or the coding agent the name reaches (HarnessV3-ACP AC6-3) — and the synthetic route
// the parse stage and the engine stage both build. The engine stage applies it and the settings answer reads the same
// answers here, so the two never disagree; the chat commands' gate asks `filamentRuns`. The teams are handed in
// (services/teams.js), so the answers stay pure over their inputs.
import { findRoute, findUpstream, listedParse, offWhere, offWhy, renderUpstreamModel } from "../core/routing.js";
import { isAgentUpstream } from "../core/schema.js";
import { parseModelSuffix } from "../core/shaping.js";
import { flexParse } from "../core/model-caps.js";
import { ENTRY_UPSTREAMS } from "../core/turn-facts.js";
import { wallWords } from "../core/provider-cause.js";
import { foldedTeamWords } from "../core/folded-teams.js";
import { TEAMS_OFF_WHY, teamsOn } from "../core/teams-on.js";

/**
 * Whether a harness session's turn that names `name` runs on the agent loop — the harness runs on the loop, period:
 * a plain LLM route (one that exists, whose upstream is not a coding agent's). The loop is always on (the owner's of
 * 11-09: it is Filament's own, and no switch turns it off). The parse stage asks it of every session turn; the New Task board asks it before the session exists (HarnessV3-NewTask
 * NT-D8), so the two never disagree about which engine a name gets.
 * @param {any} cfg @param {string} name  the name as sent
 * @param {string} [base]  its base, when the caller already parsed it (the parse stage's listed and flex readings)
 */
export function harnessRunsLoop(cfg, name, base = parseModelSuffix(name, cfg.rules).base) {
  const plain = findRoute(cfg, base) || findRoute(cfg, name);
  const up = plain ? findUpstream(cfg, plain.upstream) : null;
  return !!up && !isAgentUpstream(up);
}

/** The synthetic route the agent loop resolves to: the model its ticks call. @param {{ model: string }} agent */
export const agentRoute = (agent) => ({
  match: `agent:${agent.model}`,
  upstream: ENTRY_UPSTREAMS.agent,
  upstreamModel: agent.model,
  fallbacks: [],
  captures: [],
});

/**
 * The teams the engine reads: a team by its key or name (services/teams.js).
 * @typedef {{ find: (text: unknown) => { key: string, name: string } | null }} Teams
 */

/**
 * The coding agent a model name reaches, or null: the upstream its route lands on — the primary or any fallback — when
 * that upstream is an agent's (ACP), which runs its own turns with hands of its own.
 * @param {any} cfg @param {string} name
 * @returns {string | null}
 */
export function codingAgentOf(cfg, name) {
  const route = findRoute(cfg, parseModelSuffix(name, cfg.rules).base) || findRoute(cfg, name);
  if (!route) return null;
  const ids = [route.upstream, ...(Array.isArray(route.fallbacks) ? route.fallbacks.map((/** @type {any} */ f) => (typeof f === "string" ? f : f?.upstream)) : [])];
  return ids.find((id) => isAgentUpstream(findUpstream(cfg, id))) || null;
}

/**
 * The coding agent a session on `name` runs on, or null: the upstream its route lands on first, when that is an
 * agent's — its turns go to the agent, which holds its own context and compacts it (HarnessV3-ACP AC5-3). A fallback
 * that is an agent's makes no agent's session: the primary reads Filament's composition.
 * @param {any} cfg @param {string} name
 * @returns {string | null}
 */
export function agentSessionOf(cfg, name) {
  const route = findRoute(cfg, parseModelSuffix(name, cfg.rules).base) || findRoute(cfg, name);
  return route && isAgentUpstream(findUpstream(cfg, route.upstream)) ? String(route.upstream) : null;
}

/**
 * The name a coding agent's turn on `name` sends its agent, as acp-turn.js renders it, with what rides on it: the
 * agent's own session it goes on with (`#3716601d`) and the mode it sets (`@bypassPermissions`, read off the end). Its
 * route found as the parse stage finds it (the name's effort, speed and flex read off: `base`), the route's own template
 * unless a backup's is given, over the name whole where the same route takes it whole — a model's own id may end in
 * what reads as a level (Cursor's -high). Whatever weighs or holds a mode reads the one the agent will be set to, never
 * the one the name shows (the second read of 11-12: a chat on a plain name whose route renders `…@bypassPermissions` had
 * a watcher's turn held to reading, and its agent ran in that mode). Null where no route takes the name.
 * @param {any} cfg @param {string} name  the name the turn sends (`body.model`)
 * @param {{ base?: string, route?: any, template?: string | null }} [o]  the pipeline's own, where the caller holds them
 * @returns {{ upstream: string, model: string, resume: string | null, mode: string | null } | null}
 */
export function agentTurnModel(
  cfg,
  name,
  { base = flexParse(cfg, listedParse(cfg, name) || parseModelSuffix(name, cfg.rules)).base, route = findRoute(cfg, base) || findRoute(cfg, name), template = route?.upstreamModel } = {},
) {
  if (!route) return null;
  const whole = findRoute(cfg, name);
  const same = !!whole && whole.upstream === route.upstream && whole.match === route.match;
  let model = renderUpstreamModel(template, same ? name : base, same ? whole.captures : route.captures || []);
  const resume = /#([A-Za-z0-9_-]{4,})/.exec(model);
  if (resume) model = model.slice(0, resume.index) + model.slice(resume.index + resume[0].length);
  const mode = /@([A-Za-z][\w-]*)$/.exec(model);
  if (mode) model = model.slice(0, mode.index);
  return { upstream: String(route.upstream), model, resume: resume?.[1] ?? null, mode: mode?.[1] ?? null };
}

/**
 * The mode a turn on `name` sets its coding agent to (`agentTurnModel`), or null: its route lands first on no coding
 * agent, or renders no mode. A provider's own id may hold an `@` (Vertex's `claude-sonnet@20250514`): no agent reads a
 * mode there. @param {any} cfg @param {string} name
 */
export function agentModeOf(cfg, name) {
  const sent = agentTurnModel(cfg, name);
  return sent?.mode && isAgentUpstream(findUpstream(cfg, sent.upstream)) ? sent.mode : null;
}

/**
 * Why no call for `name` would be answered, in words — or null: every upstream its route tries (its own, then its
 * fallbacks while `resilience.failover` is on) is switched off or gone, so a call ends at once with nothing sent.
 * Null too for a name with no route: that is the route's own refusal to word.
 * @param {any} cfg @param {string} name
 * @returns {string | null}
 */
export function upstreamsOffProblem(cfg, name) {
  const route = findRoute(cfg, parseModelSuffix(name, cfg.rules).base) || findRoute(cfg, name);
  if (!route) return null;
  const backups = cfg.rules?.resilience?.failover === true && Array.isArray(route.fallbacks) ? route.fallbacks : [];
  const ids = [...new Set([route.upstream, ...backups.map((/** @type {any} */ f) => (typeof f === "string" ? f : f?.upstream))].filter(Boolean).map(String))];
  if (ids.some((id) => findUpstream(cfg, id))) return null;
  // One off by a switch of Settings › Experimental (Cursor's SDK's) is said in its words: its Upstreams card shows it on.
  const why = ids.map((id) => offWhy(cfg, id)).find(Boolean);
  if (ids.length === 1 && why) return `${why}.`;
  const known = (/** @type {string} */ id) => (cfg.upstreams || []).find((/** @type {any} */ u) => u.id === id);
  // Among several too (failover on): where its switch is, never "switched off" with the Upstreams page to switch it on.
  const where = (/** @type {string} */ id) => offWhere(cfg, id);
  const said = ids.map((id) => (where(id) ? `"${known(id).name || id}" is off in ${where(id)}` : known(id) ? `"${known(id).name || id}" is switched off` : `"${id}" is gone`));
  const fix = ids.some((id) => known(id) && !where(id))
    ? `Switch ${ids.length === 1 ? "it" : "one"} on on the Upstreams page${why ? ", or turn that switch on" : ""}.`
    : why
      ? "Turn that switch on."
      : "Pick another on the Routes page.";
  return ids.length === 1 ? `its upstream ${said[0]}. ${fix}` : `none of its upstreams can answer: ${said.join(", ")}. ${fix}`;
}

/**
 * Why `name` cannot run an agent now because its provider said it cannot serve this account (HarnessV3-TaskGraph-v2
 * TG2-D54), in words — or null: every upstream its route tries that is switched on is held as such (`wallOf`, the
 * health board's), and the words are the first one's hold. A route with one that serves still runs: the failover
 * order puts the held ones last.
 * @param {any} cfg @param {string} name
 * @param {(id: string) => import("../core/provider-cause.js").Wall | null} wallOf
 * @param {number} [now]
 * @returns {string | null}
 */
export function walledProblem(cfg, name, wallOf, now = Date.now()) {
  const route = findRoute(cfg, parseModelSuffix(name, cfg.rules).base) || findRoute(cfg, name);
  if (!route) return null;
  const backups = cfg.rules?.resilience?.failover === true && Array.isArray(route.fallbacks) ? route.fallbacks : [];
  const ids = [...new Set([route.upstream, ...backups.map((/** @type {any} */ f) => (typeof f === "string" ? f : f?.upstream))].filter(Boolean).map(String))].filter((id) => findUpstream(cfg, id));
  const walls = ids.map((id) => wallOf(id));
  const first = walls[0];
  return ids.length && first && walls.every(Boolean) ? wallWords(first, ids[0], now) : null;
}

/**
 * Why a team's lead cannot run on `name`, in words — or null. A team leads on the agent loop, which needs an API model
 * on every model its route may fall back to, or on the coding agent its route goes to first
 * (HarnessV3-ACP AC6-3), which leads as itself — never on one a fallback reaches, as the loop cannot fail over to an
 * agent. The request then keeps its own turn: it goes to the name as sent, and the record, `/team` and the settings
 * answer say why.
 * @param {any} cfg @param {string} name
 */
function coderProblem(cfg, name) {
  const coder = codingAgentOf(cfg, name);
  if (!coder || agentSessionOf(cfg, name)) return null;
  return `"${name}" falls back to the coding agent upstream "${coder}", which runs its own turns (a team leads on the agent loop with an API model on every model its route falls back to, or on a coding agent its route goes to first)`;
}

/**
 * Whether a session is a team's own chat beside a main one (its chain's kind `team`), which its team leads whatever
 * Settings › Experimental's Teams switch says (`engineProblem`). Read from the archive as the session is found, so a
 * turn memory leaves out is a team chat's all the same; no archive, or no such chain, is none.
 * @param {any} archive @param {unknown} chain
 */
export function isTeamChat(archive, chain) {
  if (!chain) return false;
  try {
    return archive?.getChain?.(String(chain))?.kind === "team";
  } catch {
    return false;
  }
}

/**
 * Why the engine a session chose cannot run, in words — null when it can, or when the model answers by choice. The
 * record's note says it per request; `/set` and `/team` say it the moment the setting is written. A team leads on the
 * agent loop, only a team that exists does, and its lead launches its workers with the agent tool — a session that
 * switched that tool off has no team to lead it. A key Filament does not ship says which team does its work
 * (core/folded-teams.js): nothing of the session is converted. While Settings › Experimental's Teams switch is off
 * no team leads a chat (core/teams-on.js), but a team's own chat beside a main one (`teamChat`): it is its team's
 * work, which finishes.
 * @param {{ mode: string, team?: string | null, agentOff?: boolean }} engine
 * @param {any} cfg
 * @param {Teams | null} [teams]
 * @param {boolean} [teamChat]  the session is a team's own chat (its chain's kind `team`)
 * @returns {string | null}
 */
export function engineProblem(engine, cfg, teams = null, teamChat = false) {
  if (engine.mode !== "team") return null;
  if (!teamChat && !teamsOn(cfg)) return TEAMS_OFF_WHY;
  if (!engine.team) return "engine.mode is team but engine.team names no team (/team lists them)";
  if (!teams?.find(engine.team)) {
    const folded = foldedTeamWords(engine.team);
    return `engine.team names \`${engine.team}\`, which is no team${folded ? ` — ${folded}` : ""} (/team lists them)`;
  }
  if (engine.agentOff) return "engine.mode is team but this session switched the agent tool off (loop.tools.agent) — a team's lead launches its workers with it";
  return null;
}

/**
 * Why the session's engine cannot answer a request that names `model`, in words, or null: the engine's own problem
 * (`engineProblem`), else a name that falls back to a coding agent, on which no team can lead — the loop needs an API
 * model, and a team leads on a coding agent only where its route goes to it first. An `agent/` name is the loop's
 * already. The record's note says it per request; `/team` and `/set` say it of the name the chat carries, the settings
 * answer of the one the session carries.
 * @param {{ mode: string, team?: string | null, agentOff?: boolean }} engine
 * @param {any} cfg
 * @param {{ model: string, agent: { model: string } | null }} asked  the name the request carries, and what parse made of it
 * @param {Teams | null} [teams]
 * @param {boolean} [teamChat]  the session is a team's own chat (`engineProblem`)
 * @returns {string | null}
 */
export function engineProblemFor(engine, cfg, { model, agent }, teams = null, teamChat = false) {
  if (engine.mode === "model") return null;
  return engineProblem(engine, cfg, teams, teamChat) || (agent ? null : coderProblem(cfg, model));
}

/**
 * What the session's engine makes of one request: the agent it now resolves to, and the record's note. Pure over its
 * inputs, so the words are pinned without a pipeline. A team's lead is the harness's loop on the model the turn names,
 * and the agent carries the team's key; or, for a name whose route goes to a coding agent first, that agent as itself
 * (`lead`, HarnessV3-ACP AC6-3): the request stays the agent's, with the team's key. Either leads in a chat Memory
 * settings leave out as in any chat: its turn rides the chat's session (stages/situate.js `turnMemState`), and memory
 * keeps out of its team's work — its workers' calls, their briefs and what their reports teach.
 * @param {{ mode: string, team?: string | null, agentOff?: boolean }} engine
 * @param {any} cfg
 * @param {{ model: string, agent: { model: string } | null }} asked  the name the request carries, and what parse made of it
 * @param {Teams | null} [teams]
 * @param {boolean} [teamChat]  the session is a team's own chat (`engineProblem`)
 * @returns {{ agent?: { model: string, team?: string }, lead?: { team: string }, note: string | null }}
 */
export function engineFor(engine, cfg, { model, agent }, teams = null, teamChat = false) {
  if (engine.mode === "model") return { note: null };
  const problem = engineProblemFor(engine, cfg, { model, agent }, teams, teamChat);
  if (problem) return { note: `engine: ${problem} — the request went to ${model} as named` };
  const team = /** @type {{ key: string, name: string }} */ (teams?.find(engine.team));
  if (!agent && agentSessionOf(cfg, model)) return { lead: { team: team.key }, note: `engine: team ${team.name} answers this session's turns (engine.team), its lead the coding agent ${model}` };
  const lead = agent?.model || model;
  return {
    agent: { ...agent, model: lead, team: team.key },
    note: `engine: team ${team.name} answers this session's turns (engine.team), its lead on ${lead}`,
  };
}

/**
 * The engine a turn is stamped with (HarnessV3-AtHome AH-O7), by the agent the request resolved to: the agent loop
 * alone, or a team's lead with the team's name as it was then — on the loop, or the coding agent that leads the team
 * as itself (`lead`, the engine stage's `ctx.lead`). Null when no loop runs the turn and no team leads it — a model
 * answers it, or a coding agent runs its own. The composer tells the loop's other engine's turns by it, and the
 * transcript draws its dividers, the lead's signature and the Team view's Leading from it.
 * @param {{ model?: string, team?: string } | null | undefined} agent
 * @param {Teams | null} [teams]
 * @param {{ team: string } | null} [lead]
 * @returns {{ kind: "loop" } | { kind: "team", team: string, name: string } | null}
 */
export function turnEngine(agent, teams = null, lead = null) {
  const team = agent?.team || lead?.team || "";
  if (team) return { kind: "team", team, name: teams?.find(team)?.name || team };
  return agent ? { kind: "loop" } : null;
}

/**
 * Whether Filament itself runs this request's turn — it composes the session (the harness), or the name is the agent
 * loop's (a call of Filament's own) — so its chat commands are Filament's (stages/chat-command.js). An outside client's
 * turn goes to the model it names.
 * @param {{ composed?: boolean, settings?: any } | null | undefined} sit
 * @param {{ model?: string, agent?: any }} named  the name the request carries, and what parse made of it
 */
export function filamentRuns(sit, { agent = null }) {
  return !!(sit?.composed || agent);
}
