// @ts-check
// What a chat's agent loop sends ahead of its history, as a print (the owner's of 11-06: "when tool definition or system
// prompt changes when filament is updated or new mcp server is conected or whatever happens then a card should be
// shown"): the build's own words and tools, and the chat's MCP servers, the tools it switched off, its skills, its web
// and its browser. A turn keeps the print it sent on its chain (`prefixSent`, agent/turn.js); the person's next message
// is weighed against the print as it stands (sessions/service.js) — where they differ, the whole history would be
// written to the provider's cache again, and the card asks first. Pure but for reading the skills' folders.
import { shortHash as sha } from "../../core/hash.js";
import { loopToolArgs } from "./tools.js";
import { PROMPT_VERSION, systemPromptFor } from "./prompt.js";
import { browserOffered } from "./browser-tool.js";
import { SKILL_TOOL, loadSkills } from "./skills.js";
import { DOOR_TOOL } from "../../core/mcp-door.js";
import { MCP_RESOURCES_TOOL } from "./mcp-resources.js";
import { LOOP_TOOL_NAMES, mcpServerProblem } from "../../services/session-settings.js";
import { loadOf } from "../../services/mcp-servers.js";
import { buildAgentTools } from "../agent-tools.js";
import { CODER_GRAPH_TEXT } from "../agent-context.js";
import { CONTEXT_HEAD } from "../../adapters/agents/context.js";

/**
 * A chat's print: `build` the build's words and tools; `mcp` each MCP server by name, its shape; `off` the tools it
 * switched off; `skills` each skill listed by name, its description; `skillTool` whether the skill tool is offered;
 * `web` the web hands on; `browser` whether the browser is.
 * @typedef {{ v: 1, build: string, mcp: Record<string, string>, off: string[], skills: Record<string, string>, skillTool: boolean, web: string[], browser: boolean }} LoopPrint
 */

/** @type {string | null} */
let built = null;
/**
 * The build's own words and tools, every one a chat of the loop may be sent: the prompt and the tools with everything
 * on, read-only, and a lead's. Moves only where a release changed what the model reads — a release that changed
 * nothing of it asks nothing. Parallelize tasks is weighed on (11-09), as Filament's commit trailer is (11-10, as it
 * ships): a release that rewords its line moves the print, and the switch itself is in no print, so a flip asks nothing.
 */
export function buildPrint() {
  if (built) return built;
  const web = { fetch: true, search: true };
  const all = { delegateRead: true, web, recall: true, graph: true, report: true, supervise: true, browser: true, craft: true, comeBack: true, machines: true };
  const said = [
    PROMPT_VERSION,
    loopToolArgs(all),
    loopToolArgs({ ...all, lead: true, members: [] }),
    DOOR_TOOL,
    MCP_RESOURCES_TOOL,
    SKILL_TOOL,
    systemPromptFor({ root: "/", delegateRead: true, web, graph: true, asks: true, supervise: true, browser: true, attended: true, parallel: true, trailer: true }),
    systemPromptFor({ root: "/", delegateRead: true, web, graph: true, readOnly: true }),
  ];
  built = sha(JSON.stringify(said));
  return built;
}

/** An MCP server as what it offers depends on: how it is reached and how its tools are offered — never a token. @param {any} m */
const mcpShape = (m) => sha(JSON.stringify([m?.type ?? null, m?.url ?? null, m?.command ?? null, Array.isArray(m?.args) ? m.args : null, loadOf(m)]));

/** @type {string | null} */
let agentBuilt = null;
/**
 * What the build gives a coding agent's session ahead of its history: Filament's tools as an agent's list names them,
 * every one it may be offered, and the standing words that say how its task graph works and how Filament's context
 * opens. A session the agent resumes keeps the tools it loaded as it first saw them (Claude Code's transcript), so where
 * this moved, only a fresh session reads the build's own.
 */
export function agentBuildPrint() {
  if (agentBuilt) return agentBuilt;
  agentBuilt = sha(JSON.stringify([buildAgentTools(), CODER_GRAPH_TEXT, CONTEXT_HEAD]));
  return agentBuilt;
}

/** The chat's MCP servers by name, each its shape. @param {any} doc @returns {Record<string, string>} */
const mcpOf = (doc) => {
  /** @type {Record<string, string>} */
  const mcp = {};
  for (const m of Array.isArray(doc?.plugins?.mcp) ? doc.plugins.mcp : []) if (m && !mcpServerProblem(m)) mcp[String(m.name)] = mcpShape(m);
  return mcp;
};

/**
 * A coding agent's print: the build's tools and words for it, and the chat's MCP servers it is given. Its tools on or
 * off, its skills and its browser are the session's to say as it opens, not the build's: they stay out.
 * @param {any} doc @returns {LoopPrint}
 */
export function agentPrint(doc) {
  return { v: 1, build: agentBuildPrint(), mcp: mcpOf(doc), off: [], skills: {}, skillTool: false, web: [], browser: false };
}

/**
 * The print of what a chat's loop sends ahead of its history, from its effective settings document.
 * @param {any} doc @returns {LoopPrint}
 */
export function loopPrint(doc) {
  const plugins = doc?.plugins || {};
  const mcp = mcpOf(doc);
  const tools = doc?.loop?.tools;
  const off = tools && typeof tools === "object" ? LOOP_TOOL_NAMES.filter((n) => tools[n] === false) : [];
  /** @type {Record<string, string>} */
  const skills = {};
  let skillTool = false;
  try {
    const s = loadSkills(doc || {});
    for (const k of s.skills) skills[k.name] = sha(k.description);
    skillTool = !off.includes(/** @type {any} */ (SKILL_TOOL.name)) && s.skills.length + s.library.length > 0;
  } catch {
    // A folder that can't be read is no change of Filament's.
  }
  const web = [plugins.web?.fetch === true ? "fetch" : "", plugins.web?.search === true ? "search" : ""].filter(Boolean);
  return { v: 1, build: buildPrint(), mcp, off: [...off].sort(), skills, skillTool, web, browser: !!browserOffered(doc, off) };
}

/** @param {string[]} names */
const listed = (names) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "));

/**
 * What changed between the print a chat last sent and the one it would send now, in words — none where they agree.
 * @param {LoopPrint | null | undefined} was @param {LoopPrint} now @returns {string[]}
 */
export function printChanges(was, now) {
  if (!was || was.v !== 1) return [];
  const out = [];
  if (was.build !== now.build) out.push("Filament was updated: what it tells the agent, or its tools, changed");
  const added = Object.keys(now.mcp).filter((n) => !(n in was.mcp));
  const gone = Object.keys(was.mcp).filter((n) => !(n in now.mcp));
  const moved = Object.keys(now.mcp).filter((n) => n in was.mcp && was.mcp[n] !== now.mcp[n]);
  if (added.length) out.push(`MCP server${added.length === 1 ? "" : "s"} ${listed(added)} connected`);
  if (gone.length) out.push(`MCP server${gone.length === 1 ? "" : "s"} ${listed(gone)} removed`);
  if (moved.length) out.push(`MCP server${moved.length === 1 ? "" : "s"} ${listed(moved)} changed`);
  const offNow = now.off.filter((n) => !was.off.includes(n));
  const onNow = was.off.filter((n) => !now.off.includes(n));
  if (offNow.length) out.push(`tools switched off: ${listed(offNow)}`);
  if (onNow.length) out.push(`tools switched on: ${listed(onNow)}`);
  const skillsOn = Object.keys(now.skills).filter((n) => !(n in was.skills));
  const skillsOff = Object.keys(was.skills).filter((n) => !(n in now.skills));
  const reworded = Object.keys(now.skills).filter((n) => n in was.skills && was.skills[n] !== now.skills[n]);
  if (skillsOn.length) out.push(`skill${skillsOn.length === 1 ? "" : "s"} ${listed(skillsOn)} turned on`);
  if (skillsOff.length) out.push(`skill${skillsOff.length === 1 ? "" : "s"} ${listed(skillsOff)} turned off`);
  if (reworded.length) out.push(`skill${reworded.length === 1 ? "" : "s"} ${listed(reworded)} described anew`);
  if (!skillsOn.length && !skillsOff.length && was.skillTool !== now.skillTool) out.push(`the skill tool ${now.skillTool ? "offered" : "no longer offered"}`);
  const webOn = now.web.filter((w) => !was.web.includes(w));
  const webOff = was.web.filter((w) => !now.web.includes(w));
  if (webOn.length) out.push(`web ${webOn.join(" and ")} switched on`);
  if (webOff.length) out.push(`web ${webOff.join(" and ")} switched off`);
  if (was.browser !== now.browser) out.push(`the browser switched ${now.browser ? "on" : "off"}`);
  return out;
}
