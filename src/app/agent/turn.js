// @ts-check
// One client-visible turn of the agent loop: the model name `agent/<model>` resolved to the loop, whose ticks go
// back through Filament's own front door as ordinary requests (each billed on its own record), while the client
// sees one reply — streamed live, one text block per model call, or sent whole at the end. A turn that pauses on a
// question or a permission waits here for the client's next message on the same session.
// A sub-agent's run (subagents.js) is served here too, in host mode: the same loop under the launching session's
// settings, with a prompt and tools of its own, unattended, reporting to the registry instead of to a session. A team's
// lead (HarnessV3-AtHome P2) is the session's own loop with a lead's prompt and tools; its agent and worker calls go
// to the team's tools (team-tools.js) as plain JSON, and its workers are sub-agents served here in host mode.
import { statSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runAgentTurn } from "./loop.js";
import { withRetries } from "../../core/retry.js";
import { ENVELOPE, FORK_REFUSALS, REPORT_NOT_YOURS, WEIGH_REFUSALS, cardOffTools, cardRefusals, isAllowCommand, keepsAgentsMachine, loopToolArgs, permissionMode, SUBAGENT_OFF, unansweredAs } from "./tools.js";
import { SHOW_VISUAL, visualHome } from "./visuals.js";
import { ARTIFACT, artifactsMakeHere } from "./artifacts.js";
import { SPACE, spaceProjectOf } from "./space.js";
import { BESIDE_TEAM, besideAtOf } from "./beside-tool.js";
import { FLOW_NAME, flowAtOf } from "./flow-tool.js";
import { THREAD, threadAtOf } from "./thread-tool.js";
import { craftAtOf } from "./craft-tool.js";
import { COME_BACK } from "./come-back.js";
import { PROMPT_VERSION } from "./prompt.js";
import { loopSystem } from "./system.js";
import { createEnvironmentKeeper } from "./environment.js";
import { composition } from "../../core/fold.js";
import { moveNote, toldPatch } from "../../core/move-note.js";
import { folderInstructions, instructionsBlock, instructionsChanged } from "./instructions.js";
import { createInternalCall } from "../internal-call.js";
import { mediaWeights, readPdfs } from "../pipeline/dispatch/pdfs.js";
import { createAgentReply } from "../acp-wire.js";
import { createRemoteCommands } from "./remote-commands.js";
import { waitedCommands } from "./commands.js";
import { runHand, RESULT_BUDGET_BYTES, createSightingsKeeper, attendShells, takeShellExits, peekShellExits, tellShellExits, untellShellExits, changedSightings, peekSightings, forgetSighting, runningShellsOf, wakes, comeBackOf } from "../../adapters/tools/hands.js";
import { staleNote } from "./stale.js";
import { putSaidBack } from "./turn-said.js";
import { runWebHand, isWebTool } from "../../adapters/tools/web-hands.js";
import { callRoom, findRoute, findUpstream, outputCeiling, renderUpstreamModel, thinkingOnWire } from "../../core/routing.js";
import { sessionWindowFor } from "../../core/model-families.js";
import { modelCapsFor } from "../../core/model-caps.js";
import { mergeRules, parseModelSuffix } from "../../core/shaping.js";
import { estimateTokens, estimateBodyTokens, fittedMaxTokens } from "../../core/tokens.js";
import { MediaResult } from "../../core/media.js";
import { readerNames } from "../../core/space.js";
import { BROWSER, browserOffered } from "./browser-tool.js";
import { LSP, projectSymbols, runLsp } from "./lsp-tool.js";
import { createLspPool } from "../../adapters/lsp/pool.js";
import { listAllFiles } from "../../adapters/tools/workspace.js";
import { languageServers } from "../../adapters/lsp/servers.js";
import { fitVerdict } from "../../core/autofit.js";
import { localReply } from "../../core/wire/local-reply.js";
import { errorBody } from "../../core/wire/errors.js";
import { requestWasAborted } from "../../services/health.js";
import { eventJson, followRunEvents } from "../../services/runs.js";
import { calibFactor } from "../../services/token-calib.js";
import { writingMs } from "../../services/daily-usage.js";
import { clientConversationId, chainRefOf, CHAIN_HEADER, shellSessionOf } from "../../core/conversation.js";
import { sendJson, replyLocally } from "../pipeline/respond.js";
import { readRules, rulesFrom } from "./rules.js";
import { keptNow } from "./chat-always.js";
import { sideLineOf, summaryHead, summaryLead, usableWindow, summarize as summarizeTranscript, summaryOfReply } from "../sessions/compaction.js";
import { chooseWriter, summaryEstimate, roundsForkInstruction, transcriptSummary, FORK_MIN_TOKENS, FORK_SUMMARY_INSTRUCTION, ASSUMED_WINDOW } from "../sessions/compactor.js";
import { reattachBlock } from "../sessions/reattach.js";
import { createStillOpen } from "./still-open.js";
import { forkLineOf, forkMessages, forkPays, forkTaskAt, forkWeight, opensForkTask } from "./subagents.js";
import { openingPictures, readJudge } from "./attach.js";
import { createTeamTools, endedWorkers, watchParts } from "./team-tools.js";
import { createLoopHooks, describeHook, hookContext, hookLabel, hooksFor } from "./hooks.js";
import { newestUserText as newestText } from "../../adapters/agents/client-bridge.js";
import { stripMemoryBlocks } from "../../services/memory/brain.js";
import { createLearnedPermissions } from "../../services/memory/permissions.js";
import { loopbackHost } from "../../services/config/store.js";
import { createTurnTree } from "../turn-tree.js";
import { git } from "../../adapters/git/snapshot.js";
import { parseWorktrees } from "../../adapters/git/places.js";
import { linkedIn } from "../agent-permits.js";
import { PATCH_HANDS, instructionsOver, patchHand } from "../../adapters/tools/patch-hands.js";
import { serverFor } from "../../adapters/lsp/servers.js";
import { fileURLToPath } from "node:url";
import { LOOP_TOOL_NAMES, lookSecondsOf, mcpServerProblem, readsAlong, requestDocument, resolveChainSettings, resultCapOf } from "../../services/session-settings.js";
import { createMcpPool, isMcpTool, specKey, MCP_FAILED_WAIT_MS } from "../../adapters/tools/mcp-client.js";
import { DOOR_TOOL, MCP_DOOR, doorAnswer, doorIndex, doorLines, shortName } from "../../core/mcp-door.js";
import { MCP_RESOURCES, MCP_RESOURCES_TOOL, resourcesAnswer } from "./mcp-resources.js";
import { SKILL_TOOL, SKILL_TOOL_NAME, calledNotes, loadSkills, skillAnswer, taggedSkills } from "./skills.js";
import { loadOf, noteOf } from "../../services/mcp-servers.js";
import { resultRef } from "../sessions/shapes.js";
import { redactorOf } from "../../core/redact.js";
import { headChars, possessive } from "../../core/text.js";
import { cacheSaid } from "../../core/cache-facts.js";
import { addSpent, callSpend, callsOf, countCalls, endedOf, pricedSum } from "../../services/memory/outcomes.js";
import { lookIn } from "../second-look.js";
import { steerGate, weighAside } from "./steer-fork.js";
import { routineActs } from "../../core/routines.js";
import { AGENTS_CHAT_HEADER, UNREAD_DEVICE, fullControl, heldGrant } from "../../services/devices.js";
import { copiesRootOf } from "../../services/copies.js";

/** @typedef {import("../deps.js").AppDeps} AppDeps */
/** @typedef {import("./loop.js").PausedTurn} PausedTurn */

/**
 * What the person said in the newest user message: their words alone, the blocks memory added to it left out (the
 * memory plan's c3) — so a typed /allow is the command alone, a quoted past turn's $name calls no skill, and a declined
 * call quotes their words, not memory's. @param {string} format @param {any} body
 */
const newestUserText = (format, body) => stripMemoryBlocks(newestText(format, body));
/**
 * The messages with `note` closing the newest user message: a copy, so what the client sent — and what the archive
 * keeps — stays as it was. The note rides this request alone (HarnessV3-TaskGraph TG-D6).
 * @param {any[]} messages @param {string} note
 */
/** A hook's reason after a refusal's words, as one sentence ending once: ": its words." — or "." where it said none. @param {string} note */
const saidAs = (note) => {
  const s = note.trim();
  return s ? `: ${s}${/[.!?]$/.test(s) ? "" : "."}` : ".";
};

/**
 * What earlier turns' starts said on their messages (agent/turn-said.js), read from the chain's standing turns, each
 * opened from the archive, by turn number — and those turns, this one aside, as a request's messages are matched to.
 * @param {any} archive @param {string} chain @param {string | null | undefined} self  this turn's row
 * @returns {{ said: Map<number, import("./turn-said.js").Said>, turns: import("./turn-said.js").TurnPin[] }}
 */
function saidEntries(archive, chain, self) {
  /** @type {Map<number, import("./turn-said.js").Said>} */
  const said = new Map();
  for (const s of archive.saidOf(chain)) {
    const m = archive.getMessage(s.hash)?.message;
    if (!m || m._filament_truncated || !Array.isArray(m.content)) continue;
    const texts = m.content.map((/** @type {any} */ b) => String(b?.text ?? ""));
    said.set(s.n, { head: texts.slice(0, s.head), tail: texts.slice(s.head) });
  }
  const turns = said.size && archive.turnPinsOf ? archive.turnPinsOf(chain).filter((/** @type {any} */ t) => t.id !== String(self ?? "")) : [];
  return { said, turns };
}

function withNote(messages, note) {
  const at = messages.findLastIndex((m) => m?.role === "user");
  if (at < 0) return messages;
  const m = messages[at];
  const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
  return messages.map((x, i) => (i === at ? { ...m, content: [...content, { type: "text", text: note }] } : x));
}

/**
 * The note the first turn after a change in a chat's MCP servers carries, on its newest message alone
 * (HarnessV4_Settings_Plan HS-D25): whose tools are gone — switched off or removed, or not
 * answering this turn — and whose are new. Without it a model that called a server's tools earlier goes on claiming
 * them from the conversation. Null when the set is the same.
 * @param {readonly string[]} seen  the servers whose tools the newest turn that ran to its end offered
 * @param {readonly string[]} now  the servers whose tools this turn offers
 * @param {readonly { name: string, conn?: unknown, problem?: string | null }[]} servers  this turn's, connected or not
 * @returns {{ gone: string[], added: string[], text: string } | null}
 */
export function mcpChangeNote(seen, now, servers) {
  const gone = seen.filter((n) => !now.includes(n));
  const added = now.filter((n) => !seen.includes(n));
  if (!gone.length && !added.length) return null;
  const tools = (/** @type {string} */ n) => `its tools (mcp__${n}__…)`;
  const lines = [
    ...gone.map((n) => {
      const failed = servers.find((s) => s.name === n && !s.conn);
      return failed
        ? `- ${n} did not answer this turn (${String(failed.problem || "no reason given").split("\n")[0].slice(0, 200)}): ${tools(n)} are not offered now.`
        : `- ${n} was switched off or removed: ${tools(n)} are gone.`;
    }),
    ...added.map((n) => `- ${n} was added: ${tools(n)} are offered from this turn.`),
  ];
  return { gone, added, text: `[Filament: the MCP servers changed since your last turn. Go by the tools you have now, not by earlier turns:\n${lines.join("\n")}]` };
}

export const PAUSE_TTL_MS = 6 * 3600_000;
/** What a turn pauses on (the loop's `PausedTurn`): a question to the developer, or a permission. A park on the chain of
 *  any other kind waits for nothing: no answer resumes it, and the page draws no card for it. */
export const PAUSE_KINDS = Object.freeze(["ask", "permission"]);
/**
 * Filament's own tools another machine's agents' chat goes without: each reaches past its folder into what is the
 * person's here — their artifacts and the databases behind them, their project's Space, the teams and flows beside their
 * chats, a turn Filament starts later by itself, the browser of their desktop app, their skills, and the web on their
 * search key and network. Its hands, its sub-agents, its asks, its checklist and task graph, its pictures and its own
 * record stay: they work in its folder, under this machine's mode, or in the chat itself.
 */
export const AGENTS_CHAT_OFF = Object.freeze([ARTIFACT, SPACE, BESIDE_TEAM, FLOW_NAME, COME_BACK, BROWSER, SKILL_TOOL_NAME, "web_fetch", "web_search"]);

/**
 * The paused turns kept in this process, each by its session, for `PAUSE_TTL_MS`. One let go unanswered — its time
 * out at a sweep, found out of time as the next message comes, or its question ended with no answer's turn (`letGo`) —
 * stops the second look its card waited with
 * (HarnessV4_Space_Plan S3b), as an answer would; else the Reviewer read on with no one to read it.
 * @param {{ stopLook: (look: { chain: string, agent: string }) => void, now?: () => number }} o
 */
export function createParks({ stopLook, now = () => Date.now() }) {
  /** @type {Map<string, { paused: PausedTurn, soFar: import("./subagents.js").TurnSoFar | null, requestId: string | null, pictures: import("./attach.js").TurnPicture[], knowsPictures: boolean, at: number, expires: number }>} */
  const pending = new Map();
  /** @param {string} k */
  const drop = (k) => {
    const look = pending.get(k)?.paused.look;
    pending.delete(k);
    if (look && "agent" in look) stopLook(look);
  };
  return {
    /**
     * @param {string} k @param {PausedTurn} paused @param {import("./subagents.js").TurnSoFar | null} soFar
     * @param {string | null} [requestId]  the request that asked
     * @param {import("./attach.js").TurnPicture[]} [pictures]  the person's pictures it heard while it worked, kept in
     *   this process alone: its resume numbers them after its message's (`attach`)
     * @param {boolean} [knowsPictures]  false where the turn was taken up from the archive: its resume numbers none
     */
    park(k, paused, soFar, requestId = null, pictures = [], knowsPictures = true) {
      pending.set(k, { paused, soFar, requestId, pictures, knowsPictures, at: now(), expires: now() + PAUSE_TTL_MS });
    },
    /**
     * The paused turn of a session, taken for its resume; out of time, or no longer held by its session (`holds`, asked
     * with the request that asked), let go, and null.
     * @param {string} k @param {(requestId: string | null) => boolean} [holds]
     */
    take(k, holds = () => true) {
      const p = pending.get(k);
      if (!p) return null;
      if (p.expires > now() && holds(p.requestId)) {
        pending.delete(k);
        return p;
      }
      drop(k);
      return null;
    },
    /**
     * A session's paused turn let go: its question ended with no answer's turn — left for a coding agent, taken away by
     * a rewind, out of time — and its in-process work ends with it, its second look stopped. @param {string} k
     */
    letGo(k) {
      if (pending.has(k)) drop(k);
    },
    /** The paused turns out of time, let go. */
    sweep() {
      const cutoff = now() - PAUSE_TTL_MS;
      for (const [k, v] of pending) if (v.at < cutoff) drop(k);
    },
  };
}

/** Said in Filament's voice, like the loop's other closing lines: never archived or shown as the model's words. A
 *  coding agent's harness turn says it too (app/acp-turn.js). */
export const EMPTY_REPLY_LINE = "(Filament: the agent finished without saying anything)";
const READER_MAX_FILES = 20;
/** Where a fold in the middle of a turn aims to land, as a share of the window: the loop spaces its folds by it (loop.js). */
const MID_TURN_LAND = 0.4;
const READER_MAX_CHARS = 200_000;

/**
 * @typedef {object} AgentTurnArgs
 * @property {{ model: string, team?: string }} agent  what the model name resolved to: the backing model, and the key of
 *   the team whose lead the loop is (engine.team)
 * @property {"anthropic" | "openai"} format
 * @property {any} body
 * @property {any} rec
 * @property {import("node:http").ServerResponse} res
 * @property {Record<string, string>} inboundHeaders
 * @property {AbortController} clientAbort
 * @property {{ sit: any, prep: any, chain: string | null, rowless: boolean } | null} memState  memory's state, or the
 *   session's settings alone, the session the turn's own tools ride, and whether memory keeps no row of the turn, whose
 *   own agent's pictures are then kept on that session (stages/situate.js `turnMemState`)
 * @property {boolean} [runEvents]  the harness's own turn: the reply carries the run's events (HarnessV3-Responsiveness R3)
 * @property {(() => Promise<{ history: any[], id: number, fromTurn: number, toTurn: number, kind: string, method: string, note: string } | { error: string }>) | null} [earlier]  a session's own turn: the sessions service's hand for room in the
 *   whole chat while the turn runs (HarnessV4_Tasks C33)
 * @property {import("../../core/tokens.js").BlockWeights | null} [weights]  a session's own turn: the sessions' keeper of
 *   what the composed body's blocks weigh (`createBlockWeights`), which the turn's estimate and the loop weigh them by
 * @property {{ from: string, text: string } | null} [handover]  a session's own turn as it moved to the loop from a coding
 *   agent: what stands, said with its first request (sessions/reattach.js `handoverFor`)
 */

/** Where the model name `agent/<model>` points, or null when the name is not the loop's. @param {string} name */
export function parseAgentModel(name) {
  const m = /^agent\/(.+)$/.exec(String(name || ""));
  return m ? { model: m[1] } : null;
}

/**
 * The agentLoop config for one turn: the session document's `loop` section (HarnessV2 §5.2) over the global config,
 * in the config's own field names so the rest of the turn reads one shape. A document knob that is null or absent
 * leaves the global value; `tools` (the per-tool switches) exists only in the document.
 * @param {any} global  `cfg.agentLoop`
 * @param {any} doc  the effective document's `loop` section, or null
 */
export function loopConfig(global, doc) {
  const g = global || {};
  if (!doc || typeof doc !== "object") return g;
  const pick = (v, fallback) => (v === null || v === undefined ? fallback : v);
  const lp = doc.learnedPermissions || {};
  return {
    ...g,
    permissions: pick(doc.permissions, g.permissions),
    readerModel: pick(doc.readerModel, g.readerModel),
    treeSnapshots: pick(doc.treeSnapshots, g.treeSnapshots),
    // A document cap wins, 0 included; null takes the global (resultCapOf).
    resultCapChars: resultCapOf(doc, g),
    // `enabled: false` (document only) switches learned permissions off whole: nothing learned, no confirmed rule
    // applied, the gate asks every time. The global's "0 approvals" keeps confirmed rules working and learns nothing.
    learnedPermissions: {
      ...(g.learnedPermissions || {}),
      afterApprovals: pick(lp.afterApprovals, g.learnedPermissions?.afterApprovals),
      enabled: lp.enabled !== false,
    },
    tools: doc.tools && typeof doc.tools === "object" ? doc.tools : null,
  };
}

/**
 * The permission mode in force, asked at each call (HarnessV3-AtHome AH-F1): the loop's, and a harness session's coding
 * agent's requests (HarnessV3-ACP AC3-2). A mode the request names (`header`) is the request's: a client's header, a
 * sub-agent that only reads or its fixed launch (`fixed`). Otherwise it is the session's, read from its document as it
 * stands — the way situate read this request's — over the config as it stands: a switch made while the turn works,
 * waits on the developer or runs a sub-agent reaches the next call. Another machine's agents' chat (`device`: the id
 * of the agents' device that started it, `meta.agentDevice`) runs Auto as Edit unless that device's grant `unasked`,
 * or Full control, which holds it, is on in `devices` as it stands (services/devices.js `heldGrant`): a switch of it
 * reaches the next call too.
 * @param {{ config: () => any, archive: any, chain: string | null, sit: any, header: unknown,
 *   devices?: import("../../services/devices.js").DeviceStore | null, device?: string | null }} o  `sit`: memory's
 *   situate result for the request, whose settings stand in when the session's document can't be read
 */
export function sessionMode({ config, archive, chain, sit, header, devices = null, device = null }) {
  const asked = String(header || "").trim();
  const fixed = asked ? permissionMode(asked) : null;
  /** The session's document as it stands, read the way situate read this request's. */
  const docNow = () => {
    const resolved = chain && archive ? resolveChainSettings(archive, config(), chain) : null;
    return resolved ? requestDocument(resolved, !!sit?.composed) : sit?.settings || null;
  };
  const modeNow = () => {
    const mode = fixed || permissionMode(loopConfig(config().agentLoop || {}, docNow()?.loop || null).permissions);
    return mode === "auto" && device !== null && !heldGrant(devices?.get?.(device), "unasked") ? "edit" : mode;
  };
  return { fixed, docNow, modeNow };
}

/**
 * The project's learned permissions (WP-L) for one chat, as the gate reads them: whether a confirmed one covers a call,
 * a yes counted towards one, and the always-allow still waiting for a call's shape. They live in memory's archive, per
 * project: null without memory, without a project for the chat, or with `loop.learnedPermissions.enabled` off.
 * @param {{ archive: any, projectId: string | null | undefined, chainId: string | null, loop: any }} o  `loop`: the
 *   turn's agentLoop config (`loopConfig`)
 */
export function projectPermissions({ archive, projectId, chainId, loop }) {
  if (!archive || !projectId || projectId === "none" || loop.learnedPermissions?.enabled === false) return null;
  const learned = createLearnedPermissions({ archive, threshold: loop.learnedPermissions?.afterApprovals ?? 5 });
  return {
    allowed: (/** @type {string} */ name, /** @type {any} */ input) => !!learned.allowedBy({ projectId, tool: name, input }),
    recordAllow: (/** @type {string} */ name, /** @type {any} */ input) => learned.recordAllow({ projectId, chainId, tool: name, input }),
    offered: (/** @type {string} */ name, /** @type {any} */ input) => learned.offeredFor({ projectId, tool: name, input }),
  };
}

/**
 * The tools the document switched off: the names set `false` in `loop.tools`, in the schema's order (so the toolset
 * key and the prompt line are the same bytes for the same choice). Unknown names are ignored.
 * @param {any} tools  `loop.tools`, or null
 * @returns {string[]}
 */
export function disabledTools(tools) {
  if (!tools || typeof tools !== "object") return [];
  return LOOP_TOOL_NAMES.filter((n) => tools[n] === false);
}

/**
 * The folder as the filesystem knows it: symlinks and junctions resolved, so a link under an allowed root that
 * points elsewhere is judged by where it points. A folder that does not exist keeps its lexical form.
 * @param {string} p
 */
export function realFolder(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * The network share a path names on Windows, as `\\host\share` lower-cased — from `\\host\share\…`, `//host/share/…`
 * and the long forms `\\?\UNC\host\share\…` and `\\.\UNC\host\share\…` alike — or "" for a path on this machine: a
 * drive's, its device form (`\\?\C:\…`), and every path anywhere but Windows, where `//host` names no other computer.
 * Any other path that opens with two separators is another computer's too, keyed by its first two names.
 * @param {string} p
 */
export function networkShare(p) {
  if (process.platform !== "win32") return "";
  const s = String(p || "").trim().replace(/\//g, "\\");
  if (!s.startsWith("\\\\")) return "";
  const parts = s.slice(2).split("\\");
  if (parts[0] === "?" || parts[0] === ".") {
    if (/^[a-z]:$/i.test(parts[1] || "")) return "";
    if (/^unc$/i.test(parts[1] || "")) parts.splice(0, 2);
  }
  return `\\\\${parts[0] || ""}\\${parts[1] || ""}`.toLowerCase();
}

/** Whether a listed root names the network share `share` (`networkShare`). @param {string} share @param {string[]} roots */
const shareNamed = (share, roots) => roots.some((r) => networkShare(String(r || "")) === share);

/** Whether Filament's listener is open beyond this machine: its host is none of this machine's own (`loopbackHost`). @param {any} cfg */
const exposedListener = (cfg) => !loopbackHost(cfg?.server?.host);

/**
 * Why the folder rules keep a path on another computer's share (`networkShare`) out before the disk is asked of it, or
 * null where it may be asked — a path on this machine always may. With roots listed, a share no root names is outside;
 * with none listed, a listener open beyond this machine refuses every folder, and a share's refusal comes before
 * anything asks it; with none listed on this machine's own listener, a share the person picks is a folder like any
 * other. Windows answers for a share by signing in to its computer as the person, so a share kept out is never asked —
 * neither what is there nor whether it is.
 * @param {any} cfg @param {string} p
 * @returns {"outside" | "exposed" | null}
 */
export function shareKeptOut(cfg, p) {
  const share = networkShare(p);
  if (!share) return null;
  const roots = (Array.isArray(cfg?.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);
  if (roots.length) return shareNamed(share, roots) ? null : "outside";
  return exposedListener(cfg) ? "exposed" : null;
}

/**
 * Whether `cwd` lies under one of `roots`: both sides resolved through the filesystem (see `realFolder`), then a
 * path-prefix test, case-insensitive on Windows. A filesystem root (`/`, `C:\`) is a legal root. Empty roots allow
 * any folder; with roots listed, a folder on a network share no root names lies under none, judged without asking the
 * share.
 * @param {string} cwd @param {string[]} roots
 */
export function underRoots(cwd, roots) {
  if (!roots.length) return true;
  const share = networkShare(cwd);
  if (share && !shareNamed(share, roots)) return false;
  const norm = (p) => {
    let r = realFolder(p).replace(/[\\/]+$/, "");
    if (!r || /^[a-zA-Z]:$/.test(r)) r += sep; // "/" and "C:\" lose their only separator above; a bare "C:" is a drive, not a folder
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  const c = norm(cwd);
  return roots.some((r) => {
    const base = norm(String(r || ""));
    return c === base || c.startsWith(base.endsWith(sep) ? base : base + sep);
  });
}

/**
 * Why Filament's agent could not work in a folder not made yet (a new worktree's, HarnessV4_Git_Plan GWC-107), in words;
 * null where it could: under a listed `agentLoop.roots` entry, or anywhere while none is listed (the folder it is made
 * from passed the fence already).
 * @param {any} cfg @param {string} folder
 * @param {{ from?: string }} [o]  `from`: the folder it is made from (a worktree's repository's)
 * @returns {string | null}
 */
export function newFolderRefusal(cfg, folder, { from = "" } = {}) {
  const roots = (Array.isArray(cfg?.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);
  // A folder made from a copy is under the copies folder, a root of its own as `folderVerdict` says — for what is made
  // from a copy alone (the security re-read of 11-11): one made from a folder of the person's is under the roots
  // listed, or under none.
  const copies = roots.length && from && underRoots(from, [copiesRootOf()]) ? [copiesRootOf()] : [];
  return underRoots(folder, [...roots, ...copies]) ? null : `${folder} would not be under any folder listed in agentLoop.roots`;
}

/**
 * Whether work may happen in `cwd` under this configuration — the one judgement the loop and the admin surface's
 * folder-reading rows (files, git, changes) share: the folder exists, it lies under a listed root as the filesystem
 * resolves it, and with no roots listed the listener is private to this machine. A folder on a network share the rules
 * keep out is refused before anything asks the disk (`shareKeptOut`), its `root` as written. `why` names the failing
 * check so a caller can say it in its own words; `root` is the folder as resolved.
 * @param {any} cfg
 * @param {string} cwd
 * @param {{ person?: boolean }} [o]  `person`: judged for a chat of this machine's person — its start, its turn, a
 *   folder it adds —, for which Filament's copies folder is no root: another machine's agents' chats work there, and a
 *   row that reads a folder reads theirs too (the security re-read of 11-11: it was a root for every chat)
 * @returns {{ ok: true, root: string, why: null } | { ok: false, root: string, why: "empty" | "missing" | "outside" | "exposed" }}
 */
export function folderVerdict(cfg, cwd, { person = false } = {}) {
  const al = cfg?.agentLoop || {};
  const roots = (Array.isArray(al.roots) ? al.roots : []).map(String).filter(Boolean);
  const c = String(cwd || "").trim();
  if (!c) return { ok: false, root: "", why: "empty" };
  const kept = shareKeptOut(cfg, c);
  if (kept) return { ok: false, root: resolve(c), why: kept };
  let isDir = false;
  try {
    isDir = statSync(c).isDirectory();
  } catch {}
  if (!isDir) return { ok: false, root: c, why: "missing" };
  const root = realFolder(c);
  // Filament's copies folder, where another machine's agents work in a copy of their project (services/copies.js), is
  // one more root where roots are listed: it holds none of the person's folders, and no chat of the person's works in it.
  if (!underRoots(root, roots.length && !person ? [...roots, copiesRootOf()] : roots)) return { ok: false, root, why: "outside" };
  if (!roots.length && exposedListener(cfg)) return { ok: false, root, why: "exposed" };
  return { ok: true, root, why: null };
}

/**
 * What a place that takes a folder — a chat's create, its check and the Start's draft, a crafter chat, Add project, a
 * new Space's folder, Everything's — answers for one `folderVerdict` finds outside the roots agentLoop.roots lists, a
 * network share no listed root names among them: one sentence wherever it is said.
 * @param {string} folder  as the request named it
 */
export const outsideRootsWords = (folder) => `${folder} is not under any folder listed in agentLoop.roots: add it there (Settings → Agent loop), or pick a folder under one`;

/**
 * What Filament says where it listens beyond this machine and agentLoop.roots lists no folder — as it starts, and in
 * Settings. That setup works: a coding agent works in whatever folder a request names, another computer's request too,
 * while Filament's own agent works in none. "" where the listener is this machine's alone, or roots are listed.
 * @param {any} cfg
 */
export function exposedWords(cfg) {
  const roots = (Array.isArray(cfg?.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);
  if (roots.length || !exposedListener(cfg)) return "";
  return `Filament listens on ${cfg?.server?.host || "every address"}, beyond this machine, and agentLoop.roots lists no folder: a coding agent works in whatever folder a request names, another computer's request too, and Filament's own agent works in none. List the folders agents may work in under agentLoop.roots (Settings → Agent loop).`;
}

/**
 * What a turn of another machine's agents' chat without Full control says where its folder is one their fence refuses
 * (deps.js `agentsFolder`): the fence's words, and the way on. One answer for Filament's own loop and a coding agent's turn.
 * @param {string} why
 */
export const fencedFolderWords = (why) =>
  `${why}. This chat of another machine's agents works there no more without Full control: start another in a project's folder, or switch Full control on for their device again. Nothing ran.`;

/**
 * What a turn says where `folderVerdict` refuses a folder — one that is not there (a worktree removed, a folder moved),
 * outside the roots, or none listed on an exposed listener: its words to the person and its record's note. One answer
 * for Filament's own loop and a coding agent's turn; null for a folder an agent may work in, or no folder named.
 * @param {any} cfg @param {string} cwd  as the request named it @param {ReturnType<typeof folderVerdict>} verdict
 * @returns {{ text: string, note: string } | null}
 */
export function folderRefusalOf(cfg, cwd, verdict) {
  if (verdict.why === "missing") return { text: `The working folder does not exist on this machine: ${cwd}. Nothing ran.`, note: "the working folder does not exist" };
  if (verdict.why === "outside")
    return {
      text: `The working folder ${cwd}${verdict.root !== resolve(cwd) ? ` (really ${verdict.root})` : ""} is not under any folder listed in agentLoop.roots, so nothing ran. Add it there (Settings → Agent loop) to allow it.`,
      note: "the working folder is outside agentLoop.roots",
    };
  if (verdict.why === "exposed")
    return {
      text: `agentLoop.roots is empty while Filament listens on ${cfg.server.host}: with an exposed listener the agent may only work in folders you list. Nothing ran.`,
      note: "empty roots on an exposed listener",
    };
  return null;
}

/** Why an added folder is left out, by `folderVerdict`'s word. */
const ADDED_LEFT = Object.freeze({
  empty: "an empty path",
  missing: "it does not exist on this machine",
  outside: "it is not under any folder agentLoop.roots lists",
  exposed: "agentLoop.roots is empty while Filament listens beyond this machine",
});

/**
 * The chat's added folders (`loop.addedFolders`, HarnessV4_Overnight_Plan OV-D21) that pass as the working folder does
 * (`folderVerdict`), each as the filesystem resolves it, once; the others with why, in words, for the record. One
 * judgement for Filament's own agent and for a coding agent's session.
 * @param {any} cfg @param {unknown} list @param {{ person?: boolean }} [o]  as `folderVerdict` takes it
 * @returns {{ folders: string[], left: string[] }}
 */
export function addedFoldersOf(cfg, list, o = {}) {
  /** @type {string[]} */
  const folders = [];
  /** @type {string[]} */
  const left = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (typeof f !== "string" || !f.trim()) continue;
    const v = folderVerdict(cfg, f.trim(), o);
    if (!v.ok) left.push(`${f.trim()} (${ADDED_LEFT[v.why]})`);
    else if (!folders.some((x) => (process.platform === "win32" ? x.toLowerCase() === v.root.toLowerCase() : x === v.root))) folders.push(v.root);
  }
  return { folders, left };
}

/**
 * The added folders of another machine's agents' chat without Full control that their fence lets it read
 * (`deps.agentsFolder`), each other one said on the turn's record. One judgement for Filament's own agent and a coding
 * agent's session. @param {string[]} folders @param {(folder: string) => string | null} refused @param {{ changes?: string[], priorChanges?: string[] }} rec
 */
export function fencedAdded(folders, refused, rec, key = /** @type {"changes" | "priorChanges"} */ ("changes")) {
  return folders.filter((f) => {
    const why = refused(f);
    if (why) (rec[key] ||= []).push(`agent: an added folder is left out — ${f} (another machine's agents' fence keeps it: ${why})`);
    return !why;
  });
}

/**
 * The top folders of the working folder's repository's other worktrees, as `git worktree list --porcelain` names them —
 * Filament's helper copies in its git folder among them, which places.js's `worktreesOf` leaves out — that pass as the
 * working folder does (`folderVerdict`), each as the filesystem resolves it, once: what a run that only reads reads
 * besides (the owner's of 11-09: a Reviewer was refused `git -C <worktree> status` and `du` on the repository's own
 * worktrees, so it could not size or status them). None where git cannot list them.
 * @param {any} cfg @param {string} root  the working folder, as `folderVerdict` resolved it
 * @param {{ person?: boolean }} [o]  as `folderVerdict` takes it
 * @returns {Promise<string[]>}
 */
export async function worktreeReadsOf(cfg, root, o = {}) {
  const key = (/** @type {string} */ p) => (process.platform === "win32" ? p.toLowerCase() : p);
  try {
    const listed = await git(["worktree", "list", "--porcelain", "-z"], { cwd: root });
    if (listed.code !== 0) return [];
    /** @type {string[]} */
    const folders = [];
    for (const w of parseWorktrees(listed.out)) {
      if (w.bare || w.prunable !== null) continue;
      const v = folderVerdict(cfg, w.path, o);
      if (v.ok && key(v.root) !== key(root) && !folders.some((x) => key(x) === key(v.root))) folders.push(v.root);
    }
    return folders;
  } catch {
    return [];
  }
}

/**
 * The agent loop's wiring, built once per app: the paused turns it keeps and the internal call its ticks make.
 * @param {AppDeps} deps
 */
export function createAgentLoopTurn(deps) {
  const { config, log, usage, ops, events, memory, finish, destination, runs, liveWords, agentHeartbeatMs } = deps;
  const parks = createParks({ stopLook: (look) => void deps.secondLook?.stop(look.chain, look.agent) });
  setInterval(() => parks.sweep(), 600_000).unref?.();
  const internalCall = createInternalCall({ config, log, ...(deps.selfBase ? { selfBase: deps.selfBase } : {}) });
  // The sessions' Environment sections (HarnessV3-SystemPrompt SP-D2), each captured once and then the same bytes every
  // turn. Without a capture (a composition that hands none in) the prompt has no Environment section.
  const environments = deps.environment ? createEnvironmentKeeper({ capture: deps.environment }) : null;
  // What each agent has seen of the files `write` may overwrite (HarnessV3-Tools TL-D7): one map per session and agent,
  // across its turns.
  const sightingsOf = createSightingsKeeper();
  // The sessions' MCP servers (§5.7), connected once and kept warm between turns; closed when idle or with the app. A
  // signed-in server's token comes from Filament's sign-ins with each request (HarnessV4_Settings_Plan HS-7, HC-146).
  // One that did not connect is not asked again by the next turns for a while (the slowness of 11-01: each turn waited
  // out its connect before its first request).
  const mcpPool = createMcpPool({ log: (level, msg) => log(level, msg), auth: deps.mcpSignIns?.auth || null, failedWaitMs: MCP_FAILED_WAIT_MS, keepListed: true });
  // The language servers the lsp tool asks (the owner's LSP of 11-04): one per folder and server, started at an agent's
  // first ask there and shared by every chat working in it; closed when idle or with the app.
  const lspPool = createLspPool({ log: (level, msg) => log(level, msg) });
  // What is still open in each chat (agent/still-open.js): the app's, else one over the registry and memory's archive.
  const stillOpen = deps.stillOpen || createStillOpen({ registry: deps.subagents || null, archive: () => /** @type {any} */ (memory)?.archive || null });

  /** @param {AgentTurnArgs} args */
  async function turn({ agent, format, body, rec, res, inboundHeaders, clientAbort, memState, runEvents = false, earlier = null, weights = null, handover = null }) {
    /** When this request began: its outcome's time (M7-D48). */
    const startedAt = Date.now();
    const cfg = config();
    // The session the turn's own tools ride and its bookkeeping is kept on — its graph, artifacts, pictures, browser,
    // pause, Environment: memory's chain where its prepare names it, else the session the request belongs to — where
    // memory left the turn out (D4 of 11-01), or its prepare failed before it opened the turn. What memory keeps — the
    // turn's row, which a chat Memory settings leave out keeps too, its outcome, its recall — reads `memState.prep`.
    const sessionChain = memState?.chain || null;
    // The loop's knobs: the settings this request runs under (HarnessV2 §5.2; on `sit.settings`, a harness session's
    // whole document or the knobs an outside client's session chose — situate) over the global agentLoop config — a
    // knob they leave null or out falls to the config. Every document read below keeps that rule.
    const al = loopConfig(cfg.agentLoop || {}, memState?.sit?.settings?.loop || null);
    const rules = rulesFrom(memState?.sit?.settings || null);
    // Its rules on reading: grep searches and glob lists no file they refuse a read of (core/read-rules.js).
    const readFence = readRules(rules);
    // `privacy.redact`: applied where outside text enters the turn — by each source (a hand, MCP, the web) before its
    // own cut, so the cap archives the redacted whole; the files handed to the reader; a hook's note — so no model
    // reads what it names.
    const redact = redactorOf(memState?.sit?.settings?.privacy?.redact);
    const model = agent.model;
    const stream = body.stream === true;
    /** A refusal the developer reads in chat, not an error toast: the turn ran nothing and says why. @param {string} text */
    const refuse = (text, note) => {
      usage.firstByte(rec);
      replyLocally(res, { format, stream, requestId: rec.id, msg: localReply(format, { model: body.model, text, now: Date.now() }) });
      finish(rec, { status: "ok", httpStatus: 200, tokens: { input: 0, output: 0 }, cost: 0, local: true, changes: [note] });
      // The refusal is the turn's answer: archived as its final and marked as Filament's own words (no model was
      // called), so a reload shows it instead of "no reply was recorded" and no seed hands it to a model as history.
      if (memState?.prep?.turn) {
        try {
          memory.afterReply({ chainId: memState.prep.chain, turnId: memState.prep.turn, requestId: rec.id, finalMessage: { role: "assistant", content: [{ type: "text", text }] }, replyText: text, outputChars: text.length, injectedIds: memState.prep.ids || [], trace: null });
          /** @type {any} */ (memory).archive?.mergeTurnMeta?.(memState.prep.turn, { command: true });
          if (rec.memory) rec.memory.command = true;
        } catch (/** @type {any} */ e) {
          log("warn", `${rec.id} memory bookkeeping failed: ${e.message}`);
        }
      }
    };
    /** @param {number} status @param {string} message */
    const reject = (status, message) => {
      sendJson(res, status, errorBody(format, status, message));
      finish(rec, { status: "error", httpStatus: status, error: message });
    };
    // Host mode: the registry launched this request as a sub-agent's run and says what the run is. The header is
    // house-only, so a client cannot claim it.
    const registry = deps.subagents || null;
    const looks = deps.secondLook || null;
    const saId = String(inboundHeaders["x-filament-subagent"] || "");
    const host = saId ? registry?.hostOf(saId) || null : null;
    if (saId && !host) return reject(409, `no sub-agent ${saId} is waiting for its run`);
    // A team's lead: the engine named the session's team on the agent it resolved to.
    const leadTeam = !host && agent.team ? deps.teams?.find(agent.team) || null : null;
    // The backing model must be a plain model with a route: the loop behind the loop, or a coding agent (which runs
    // its own tools), would recurse or double up. The reader behind delegate_read is held to the
    // same rule; failing it, the tool is left out rather than the turn refused.
    if (parseAgentModel(model)) return reject(400, `"${body.model}": the agent loop cannot run itself — name a plain model, e.g. agent/<model>`);
    const backing = plainModelProblem(cfg, model, destination);
    if (backing) return reject(backing.status, `"${body.model}": ${backing.why}`);
    // The client's conversation names the parked turn; a chain named by id (the harness's sessions) is the name
    // itself; a client that sends neither gets a turn that cannot pause.
    const conversationId = clientConversationId(inboundHeaders);
    const chainRef = chainRefOf(inboundHeaders);
    // A sub-agent rides its session's chain but parks nothing there (it never pauses) and resumes nothing of it; its
    // MCP servers are the session's own, kept warm under the session's key.
    const poolKey = chainRef ? `chain:${chainRef}` : conversationId || `nosession:${rec.id}`;
    const sessionKey = host ? `subagent:${host.id}` : poolKey;
    const pendKey = `${sessionKey}|agent`;
    // Resume: the newest user message answers the parked question or permission, in the folder the question was asked
    // in — a header that names another does not move a half-finished round. The mode is the one in force at each call
    // (HarnessV3-AtHome AH-F1); the harness marks the answer that is the permission switch itself with a house header.
    // A park its session no longer holds — the person went on with a coding agent, or a rewind took its turn away — is
    // let go: this message answers nothing.
    const archiveOf = /** @type {any} */ (memory).archive || null;
    const parked = host ? null : parks.take(pendKey, (asked) => !sessionChain || !archiveOf?.getChain || archiveOf.getChain(sessionChain)?.meta?.paused?.requestId === asked);
    const modeSwitch = String(inboundHeaders["x-filament-mode-switch"] || "") === "1";
    // A waiting permission runs on the person's press alone (the owner's rule: nothing reads their words for a yes) — the
    // harness's card says it by a house header a client cannot send, 1 for Allow and 0 for Deny, whose words never run
    // it, /allow among them; a message with no press — a client that draws no card — runs it as /allow, alone.
    const press = String(inboundHeaders["x-filament-allow"] || "");
    /** @param {string} answer */
    const allowOf = (answer) => press === "1" || (press !== "0" && isAllowCommand(answer));
    /** @type {{ paused: PausedTurn, answer: string, allow: boolean, modeSwitch: boolean } | null} */
    let resume = null;
    /** The paused turn so far: the resumed turn waits on the background launches it made that still run, as it did
     *  (HarnessV3-Views V6-17), and counts what they spent as its own, with its runs (the bug report's L10). No
     *  sub-agent outlives the process, so a pause resumed from the archive has none.
     *  @type {import("./subagents.js").TurnSoFar | null} */
    let soFar = null;
    if (parked) {
      const answer = newestUserText(format, body);
      resume = { paused: parked.paused, answer, allow: allowOf(answer), modeSwitch };
      soFar = parked.soFar;
    }
    // A chain-addressed session outlives this process: its parked question is on the chain (HarnessV2 P2) — after a
    // restart, or a park let go whose question an undone rewind brought back — and the answer rebuilds the conversation
    // from the composed history plus the reply that was waiting. A park of a kind no turn pauses on (`PAUSE_KINDS`)
    // waits for nothing: this message starts a turn of its own.
    if (!resume && !host && chainRef && archiveOf?.getChain) {
      const stored = archiveOf.getChain(chainRef)?.meta?.paused;
      if (stored?.dangling && PAUSE_KINDS.includes(stored.kind) && stored.expires > Date.now()) {
        const history = Array.isArray(body.messages) ? body.messages.slice(0, -1).map((m) => structuredClone(m)) : [];
        if (history.at(-1)?.role === "assistant") history.pop(); // the question's text rides in the waiting reply
        const convo = [...history, stored.dangling];
        resume = {
          paused: { kind: stored.kind, convo, results: stored.results || [], pending: stored.pending, remaining: stored.remaining || [], round: stored.round || 0, plan: stored.plan || null, root: stored.root, readerModel: stored.readerModel || "", heard: stored.heard || [], subagentWrote: stored.subagentWrote || [], wrote: stored.wrote === true, unread: stored.unread || [], changed: stored.changed || [], spent: stored.spent || null, treeFrom: stored.treeFrom || null, treeWaiting: stored.treeWaiting || null, ...(stored.review ? { review: stored.review } : {}), ...(stored.look ? { look: stored.look } : {}), ...(stored.supervise ? { supervise: true } : {}), baseLen: convo.length - 1, workFrom: convo.length - 1 },
          answer: newestUserText(format, body),
          allow: allowOf(newestUserText(format, body)),
          modeSwitch,
        };
        (rec.changes ||= []).push("agent: resumed from the archived pause (this process kept no paused turn of it)");
      }
    }
    // The pause this turn answers, and the reply that asked in it: that reply opens this turn's work, unless a
    // compaction mid-turn folds it into a summary.
    const asking = resume && resume.paused.workFrom != null ? { kind: resume.paused.kind, reply: resume.paused.convo[resume.paused.workFrom] } : null;
    // The turn that answers a pause takes it (HarnessV3-Views V6-12): the chain's pause is marked with this request,
    // and the transcript leaves it out while the request runs. The turn's end clears it or parks the next one; a
    // request that ends without that — Filament stopped mid-turn, a refusal below — leaves a mark no running request
    // answers to, and the pause waits again.
    if (resume && sessionChain && archiveOf?.mergeMeta) {
      try {
        const stored = archiveOf.getChain(sessionChain)?.meta?.paused;
        if (stored) archiveOf.mergeMeta(sessionChain, { paused: { ...stored, answeredBy: rec.id } });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} the answered pause was not marked: ${e.message}`);
      }
    }
    // The working folder: from the client, else the project memory names — for a sub-agent with its own worktree, the
    // worktree the registry names (its request names the session's folder, its project). It must exist, and lie under
    // a listed root — or, with no roots listed, the listener must be private to this machine. Judged as the filesystem
    // sees it, so a link under an allowed root that points elsewhere is judged by where it points.
    const cwd = resume ? resume.paused.root : String(host?.workdir || inboundHeaders["x-filament-cwd"] || memState?.sit?.project?.cwd || "").trim();
    // Another machine's agents' chat (`meta.agentDevice`, sessions.js; a chat made from one keeps it, and its sub-agents
    // ride its chain) works in its folder in the mode it was sent with, else this machine's — Auto as Edit unless their
    // device may run without asking —, and reaches nothing else of the person's here (AGENTS_CHAT_OFF): no MCP server, no skill, and no machine
    // kept for this Filament's agents. `agentDevice`: the id of their device; null for any other chat. A meta that cannot
    // be read is read as theirs (`UNREAD_DEVICE`), as server.js and the agent tools read it (the xf-words2 hunt's).
    const agentDevice = (() => {
      const chat = sessionChain || chainRef;
      try {
        const id = chat ? archiveOf?.metaOf?.(chat, ["agentDevice"])?.agentDevice : null;
        return typeof id === "string" ? id : null;
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} remote: whether chat ${chat} was started by another machine's agents could not be read (${e?.message || e}): its turn runs as theirs`);
        (rec.changes ||= []).push("agent: whether another machine's agents started this chat could not be read: the turn runs as theirs, with what their chat is given alone");
        return UNREAD_DEVICE;
      }
    })();
    const agentsChat = agentDevice !== null;
    // Filament's copies folder is a root for their chat alone: a chat of this machine's person is judged without it
    // (`folderVerdict`'s `person`), its folder, the folders it adds and its repository's other worktrees alike.
    const whose = { person: !agentsChat };
    const verdict = folderVerdict(cfg, cwd, whose);
    const root = verdict.root;
    if (verdict.why === "empty")
      return refuse(
        "I have no working folder for this chat: open the chat in a project memory knows, and ask again.",
        "agent: refused — no working folder",
      );
    const refusedFolder = folderRefusalOf(cfg, cwd, verdict);
    if (refusedFolder) return refuse(refusedFolder.text, `agent: refused — ${refusedFolder.note}`);
    // The folders the chat adds to the working folder for reading (`loop.addedFolders`, HarnessV4_Overnight_Plan
    // OV-D21), judged as it is: one that does not pass is left out of the turn, said.
    const added = addedFoldersOf(cfg, memState?.sit?.settings?.loop?.addedFolders, whose);
    for (const l of added.left) (rec.changes ||= []).push(`agent: an added folder is left out — ${l}`);
    // Under Full control (the owner's of 11-09, devices.js `fullControl`, read once for the turn) such a chat runs as
    // the person's own here: `fenced` is false, and what follows gives it the person's tools, MCP servers, skills and
    // instruction files. What it may never do stays on `agentsChat`: send work on to a machine of this Filament's, or
    // have a third machine's models answer it.
    const fenced = agentsChat && !fullControl(deps.devices ?? null, agentDevice);
    // Fenced, it works only where their fence lets a chat start (`deps.agentsFolder`), judged at each turn: one started
    // under Full control in a folder the fence refuses (a home or a credentials folder, around Filament's data folder)
    // works there no more once it is off (the fc-review's).
    const fencedOut = fenced ? (deps.agentsFolder?.(root || cwd, agentDevice) ?? null) : null;
    if (fencedOut) return refuse(fencedFolderWords(fencedOut), "agent: refused — another machine's agents' chat, fenced, in a folder their fence refuses");
    // The folders it adds for reading are held to that fence too (the swarm's review of 11-10): a project's or the
    // defaults' added folder is the person's, and one their fence refuses — a home, a credentials folder — is left out.
    if (fenced) added.folders = fencedAdded(added.folders, (f) => deps.agentsFolder?.(f, agentDevice) ?? null, rec);
    // The permission mode in force, asked at each call (HarnessV3-AtHome AH-F1). A team that changes no file
    // (`readOnly`: BugHunters) holds each turn it leads to reading, as its chat on the side is held: its lead's own
    // tools, and the workers and the graph its turn opens, whatever the chat's own mode says.
    const { fixed: fixedMode, docNow, modeNow } = sessionMode({ config, archive: archiveOf, chain: sessionChain || chainRef || null, sit: memState?.sit, header: leadTeam?.readOnly ? "read-only" : inboundHeaders["x-filament-permissions"], devices: deps.devices ?? null, device: agentDevice });
    /** The mode the turn begins under: what its record, its run and the ops line say. */
    const mode = modeNow();
    // A run that only reads for the whole of its turn — its request names read-only, as a Reviewer's does — reads its
    // repository's other worktrees too, Filament's helper copies among them (the owner's of 11-09): its read, grep and
    // glob, and its commands that only read, git's reading forms there with them. Listed once a turn, while the turn
    // gets ready (`worktreeReads`, before the loop starts); a run whose mode may let it write gets none, and nothing of it
    // reaches the prompt.
    // Fenced, those their fence refuses are left out, as the added folders are.
    const worktreesListed = fixedMode === "read-only" ? worktreeReadsOf(cfg, root, whose).then((l) => (fenced ? l.filter((f) => !deps.agentsFolder?.(f, agentDevice)) : l)) : null;
    /** @type {string[]} */
    let worktreeReads = [];
    // The session may switch tools off (`loop.tools`); the set and the prompt line naming the missing ones are frozen
    // per choice, so the bytes hold from tick to tick. Read per turn: a resumed turn runs under the document as it
    // stands now (the folder is the question's, the tools are not part of the parked state). A sub-agent is offered
    // the same set minus SUBAGENT_OFF (nobody to ask, nothing to plan for, no recursion).
    const sessionOff = disabledTools(al.tools);
    // A visual shows in the harness's chat (HarnessV4_Visuals_Plan VS-D2): offered in a session the harness draws, where
    // the archive has a place to keep it — the turn, a sub-agent's the turn that launched it, and its session for one no
    // turn launched (VS-D48) or for a turn memory keeps no row of (`rowless`: one it leaves out for a reason of its own,
    // or whose situate or prepare failed), so such a turn offers what the chat's other turns offer. Anywhere else nobody
    // would see it, so show_visual is left out, its guide with it.
    const visualsHere = memState?.sit?.composed && archiveOf?.addTurnVisual
      ? visualHome(archiveOf, { turn: (host ? memState?.prep?.launchTurn : memState?.prep?.turn) || null, chain: sessionChain, by: host ? { id: host.id, exchange: host.brief.exchange } : null, rowless: !!memState?.rowless })
      : null;
    // An artifact (HarnessV4_Artifacts_Plan AF-D3): made in a session the harness draws, by its own agent and the
    // agents it sends or asks (OA1) — never by an agent that started by itself. Elsewhere, none.
    const artifactChain = sessionChain;
    const artifactsHere =
      deps.artifacts && artifactChain && artifactsMakeHere({ composed: !!memState?.sit?.composed, host })
        ? {
            store: deps.artifacts,
            at: {
              who: host ? `${artifactChain}/${host.id}` : artifactChain,
              by: { chain: artifactChain, model: String(model), folder: root, helper: host ? host.id : null, ...(host ? { exchange: host.brief.exchange } : {}) },
              within: [root, ...added.folders],
              port: deps.selfPort ? deps.selfPort() : cfg.server.port,
              maxBytes: cfg.server.maxBodyBytes,
            },
          }
        : null;
    // The project's Space (proposal_ux §4.14): read and written by the chat's own agent — a team's lead in its seat
    // among them — and the agents it sends or asks, as the chat's (OA1); never by an agent that started by itself, who
    // works for no lane. A chat has it from its first message (team_v2_plan TV2-D7) where its project has a Space — one
    // the person made (10-29) —, none else (`spaceProjectOf`). The other chats are named as the chat's agent may read
    // them (core/space.js `readerNames`).
    const spaceDeps = deps.space || null;
    const spaceProject = spaceDeps && artifactChain && (!host || !host.self) ? spaceProjectOf(spaceDeps, artifactChain) : null;
    /** @type {import("./space.js").SpaceAt | null} */
    const spaceHere =
      spaceDeps && spaceProject && artifactChain
        ? { store: spaceDeps.store, project: spaceProject, chain: artifactChain, name: host ? String(host.card?.name || host.id) : null, ...readerNames(spaceDeps, artifactChain), on: () => spaceDeps.on(artifactChain), fed: spaceDeps.fed, connection: spaceDeps.connection, modelOf: spaceDeps.modelOf, cwdOf: spaceDeps.cwdOf, sending: spaceDeps.sending, dashboards: spaceDeps.dashboards ?? null, lanes: spaceDeps.lanes ?? null, routines: spaceDeps.routines ?? null, runOf: spaceDeps.runOf, chatsOf: spaceDeps.chatsOf, guidance: spaceDeps.guidance ?? null, placeIn: spaceDeps.placeIn, toolReads: spaceDeps.toolReads }
        : null;
    // Teams beside the chat (team_v2_plan §5.5, TV2-D6): fired by a harness chat's own agent — never a team's lead,
    // whose chat a team leads, a worker or a helper — in a chat that fires them (a team's own does not), from its first
    // message (TV2-D7).
    const besideHere = !host && !leadTeam && memState?.sit?.composed ? besideAtOf(deps.beside, artifactChain) : null;
    // A flow beside the chat (HarnessV4_OneAgent_Plan OA3): designed by a harness chat's own agent in the same places, its
    // drafts only after the person's /flow.
    const flowHere = !host && !leadTeam && memState?.sit?.composed ? flowAtOf(deps.flow, artifactChain) : null;
    // A thread of the chat (app/threads.js): started by a harness chat's own agent in the same places — never in a chat
    // of another machine's agents, Full control or not: a chat it starts would be a chat of the person's here.
    const threadHere = !host && !leadTeam && !agentsChat && memState?.sit?.composed ? threadAtOf(deps.thread, artifactChain) : null;
    // The skill a crafter chat crafts (agent/craft-tool.js): its own agent's to write, in that chat alone.
    const craftHere = !host && !leadTeam && !fenced ? craftAtOf(deps.craft, artifactChain) : null;
    // Coming back to the chat later (agent/come-back.js): its own agent's, in a chat Filament composes — the waker starts
    // no turn of a client's own conversation.
    const comeBackOffered = !host && !leadTeam && !!memState?.sit?.composed && !!artifactChain;
    // A model that takes no tools (HarnessV4_Tasks E4: its row on the Upstreams page, or its provider's listing, says
    // so) is offered none: the turn runs in words, its prompt says why, and nothing a tool would need is set up. A
    // fork keeps the main agent's set as it was sent, which for such a model was none.
    const toolsSaid = host?.fork ? null : modelCapsFor(cfg, model)?.tools || null;
    const wordsOnly = !!toolsSaid && !toolsSaid.available;
    // A sub-agent goes without what its card switched off too (HarnessV4_ShippedAgents_Plan SA2): the chat's switches
    // and its card's only take away from what its level gives (SA-D4, SA-D5).
    const cardOff = host ? cardOffTools(host.card?.toolsOff) : [];
    const off = wordsOnly ? [...LOOP_TOOL_NAMES] : [...new Set([...sessionOff, ...(host ? SUBAGENT_OFF : []), ...cardOff, ...(fenced ? AGENTS_CHAT_OFF : []), ...(visualsHere ? [] : [SHOW_VISUAL]), ...(artifactsHere ? [] : [ARTIFACT]), ...(spaceHere ? [] : [SPACE]), ...(besideHere ? [] : [BESIDE_TEAM]), ...(flowHere ? [] : [FLOW_NAME]), ...(threadHere ? [] : [THREAD])])];
    // The session's task graph (HarnessV3-TaskGraph), always on (the owner's word of 10-29): the session's own agent's — a
    // lead's as well — kept on its chain by the process's graph runner (graph-runner.js). A harness chat's own turn (one
    // the session composed) alone: an outside client's request is not reshaped by it (V4-D105). A sub-agent, a fork, a
    // worker and a model that takes no tools never have it.
    const graphs = deps.graphs || null;
    const graphChain = !host && !wordsOnly && graphs && memState?.sit?.composed && sessionChain && archiveOf?.getChain ? sessionChain : null;
    const graphOn = !!graphChain;
    // A team's lead reads along with its workers (HarnessV3-TaskGraph-v2 §12, `engine.supervise`), where Filament keeps
    // the run log their trails are read from. Read when the turn starts: a switch reaches the next turn and a resumed
    // turn keeps the one it ran with, so a lead never finds its instructions changed between two of its steps
    // (TG2-D21). A worker is told by the registry, which says it once for an exchange. The session's own agent reads
    // along too, with the sub-agents of its graph's tasks (V2-0c, TG2-D20) — and such a sub-agent is told by the
    // registry, as a worker is.
    const superviseOn = wordsOnly
      ? false
      : host
      ? !!host.supervise
      : (!!leadTeam || graphOn) && !!registry?.readsRuns() && !!(chainRef || sessionChain) && (resume ? !!resume.paused.supervise : readsAlong(memState?.sit?.settings));
    /** The session's agent reads along with its graph's sub-agents: its tasks has note, and its wait says a look follows. */
    const agentReads = superviseOn && !host && !leadTeam;
    let readerModel = resume ? resume.paused.readerModel : String(al.readerModel || "").trim();
    if (readerModel && off.includes("delegate_read")) readerModel = "";
    else if (readerModel && !resume) {
      const problem = parseAgentModel(readerModel)
        ? { why: "it is the agent loop itself" }
        : plainModelProblem(cfg, readerModel, destination);
      if (problem) {
        (rec.changes ||= []).push(`agent: delegate_read not offered — the reader model "${readerModel}" is refused (${problem.why})`);
        readerModel = "";
      }
    }
    if (resume) {
      (rec.changes ||= []).push("agent: resumed after the developer answered");
      const asked = String(inboundHeaders["x-filament-cwd"] || "").trim();
      if (asked && realFolder(asked) !== root) (rec.changes ||= []).push(`agent: the answer continues in the folder the question was asked in, not the ${asked} the request named`);
    }
    // The web hands (§5.7) ride only on a session's say-so: `plugins.web.fetch` / `plugins.web.search` in the document.
    // A request riding no document gets none; the operator's `agentLoop.web` says where searches go and whether
    // private addresses may be reached.
    const webDoc = memState?.sit?.settings?.plugins?.web || null;
    const web = webDoc ? { fetch: webDoc.fetch === true, search: webDoc.search === true } : null;
    const webOn = [web?.fetch && !off.includes("web_fetch") ? "web_fetch" : null, web?.search && !off.includes("web_search") ? "web_search" : null].filter((x) => x != null);
    const webCfg = cfg.agentLoop?.web || {};
    // The agent's browser (HarnessV4_Browser_Plan BR-D5): the chat's, on its session's say-so — `plugins.browser` —
    // whether or not the desktop app that holds its pages is connected now, so the tool's bytes never move with the app
    // (a call then answers so). A sub-agent drives it too, a fork among them, in tabs of its own (its seat), named for
    // it in the pane (HarnessV4_AgentTools_Plan AT-D2, AT-D6; BR-D13 gave them none).
    const browsers = deps.browsers || null;
    const browserChain = !wordsOnly && browsers && sessionChain ? sessionChain : null;
    const browserOn = !!browserChain && browserOffered(memState?.sit?.settings, off);
    const browserSeat = host ? { id: host.id, name: host.card.name } : null;
    // A team's worker's team: its lead's yes to a site holds for the team's workers alone (the bug hunt of 10-30, LOOP-2).
    const browserTeam = host?.team ? { key: String(host.team.key), name: String(host.team.name) } : null;
    // The session's MCP servers (§5.7 `plugins.mcp`): connected once per session and kept warm; their tools ride
    // after the loop's own as mcp__<server>__<tool>. A server that does not answer is left out, said on the record;
    // the turn goes on with the rest. A team's lead has them too, as it has every hand (HarnessV4_Tasks decision 9). They
    // run in the session's folder. A worker in its own worktree starts its own instead, under a key of its own, in its
    // worktree — a spec's own folder in the developer's as the same folder of the worktree: a relative path in its calls
    // names a place in its worktree, where its fence judges it (the bug hunt of 10-30, PERM-3). They go as its run ends
    // (`mcpLetGo`), before its copy is given back.
    const sessionMcp = (Array.isArray(memState?.sit?.settings?.plugins?.mcp) ? memState.sit.settings.plugins.mcp : []).filter((m) => m && !mcpServerProblem(m));
    // A sub-agent whose card goes without them has none of them (SA2), nor has another machine's agents' chat: they are
    // the person's, signed in as them.
    const mcpSpecs = wordsOnly || host?.card?.toolsOff?.includes("mcp") || fenced ? [] : sessionMcp;
    const sessionCwd = host?.workdir ? String(inboundHeaders["x-filament-cwd"] || root) : root;
    const ownMcp = !!host?.workdir && mcpSpecs.length > 0;
    const mcpKey = ownMcp ? sessionKey : poolKey;
    /** A spec as the worker starts it: where it names a folder in the developer's, the same folder of its worktree. @param {any} spec */
    const inWorktree = (spec) => {
      const own = typeof spec?.cwd === "string" ? spec.cwd.trim() : "";
      const rel = own && isAbsolute(own) && host?.folder ? relative(host.folder, own) : null;
      return rel != null && !rel.startsWith("..") && !isAbsolute(rel) ? { ...spec, cwd: rel ? join(root, rel) : root } : spec;
    };
    /** The worker's own servers closed, each with its whole tree; nothing for any other turn's. */
    const mcpLetGo = () => (ownMcp ? mcpPool.close(mcpKey) : Promise.resolve());
    // A run that ends some other way than through the loop's end lets them go with its reply.
    if (ownMcp) res?.once?.("close", () => void mcpLetGo());
    const mcpServers = mcpSpecs.length ? await mcpPool.servers(mcpKey, ownMcp ? mcpSpecs.map(inWorktree) : mcpSpecs, { cwd: ownMcp ? root : sessionCwd }) : [];
    if (ownMcp) (rec.changes ||= []).push(`agent: the session's MCP servers run in this worker's own worktree (${root}), started for its run and closed with it`);
    // The chat's language servers (`lsp.servers` and its plugins', then Filament's own): each started in the folder the
    // turn works in at the lsp tool's first ask about a file it serves. A worker in its own worktree has its own there,
    // closed as its run ends (`lspLetGo`), before its copy is given back.
    const lspServers = languageServers(memState?.sit?.settings?.lsp);
    const lspLetGo = () => (host?.workdir ? lspPool.close(root) : Promise.resolve());
    if (host?.workdir) res?.once?.("close", () => void lspLetGo());
    /** @type {Map<string, { conn: import("../../adapters/tools/mcp-client.js").McpConnection, tool: string }>} */
    const mcpByName = new Map();
    const mcpReadOnly = new Set();
    /** @type {import("../../adapters/tools/mcp-client.js").McpTool[]} */
    const mcpTools = [];
    for (const s of mcpServers)
      for (const t of s.conn?.tools || []) {
        if (mcpByName.has(t.name) || !s.conn) continue;
        mcpByName.set(t.name, { conn: s.conn, tool: t.tool });
        if (t.readOnly) mcpReadOnly.add(t.name);
        mcpTools.push(t);
      }
    // A server's tools ride every request in full only where it says load core; any other's are named in the prompt,
    // and the mcp tool finds them, loads one and calls it (E49), so they add to the cached prefix only their names.
    const mcpCore = new Set(mcpSpecs.filter((m) => loadOf(m) === "core").map((m) => m.name));
    /** @param {(typeof mcpServers)[number]} s */
    const toolsOf = (s) => mcpTools.filter((t) => mcpByName.get(t.name)?.conn === s.conn);
    // What of each the project uses, where its place says (the owner's word of 10-26), rides on its line.
    const notes = new Map(mcpSpecs.map((m) => [m.name, noteOf(m)]));
    const mcpLine = mcpServers.filter((s) => s.conn).map((s) => {
      const note = notes.get(s.name) || "";
      return { name: s.name, tools: (s.conn?.tools || []).length, ...(mcpCore.has(s.name) ? {} : { names: toolsOf(s).map(shortName) }), ...(note ? { note } : {}) };
    });
    const mcpIndex = mcpTools.length ? doorIndex(mcpTools) : null;
    const doorOn = mcpLine.some((s) => s.names);
    // The servers that say they have resources (agent/mcp-resources.js): one tool lists and reads them, after the door.
    const resourceServers = mcpServers.flatMap((s) => (s.conn?.resources && s.conn.request ? [{ name: s.name, conn: s.conn }] : []));
    const resourcesOn = resourceServers.length > 0 && !off.includes(MCP_RESOURCES) && !off.includes("mcp");
    // The saved agents this session's agent — or its team's lead — may ask (HarnessV4_Tasks E15 step 3): its agent
    // tool lists them, and its prompt says when to ask one. A sub-agent's own run asks nobody.
    const askChain = chainRef || sessionChain;
    const asks = registry && !host && askChain && !off.includes("agent") ? registry.asks(String(askChain)) : [];
    if (asks.length) (rec.changes ||= []).push(`agent: the session names ${asks.length} saved agent${asks.length === 1 ? "" : "s"} its ${leadTeam ? "team's lead" : "agent"} may ask (subagents.ask): ${asks.map((a) => a.tag).join(", ")}`);
    // A sub-agent doing a task of the session's graph ends it with its report (G2-4), a reviewer its review (G3-3). A
    // team's worker whose lead reads along may ask it (HarnessV3-TaskGraph-v2 TG2-D49).
    // Builder and Reviewer where what they may do is set on them (HarnessV4_ShippedAgents_Plan SA1): the agent tool says it.
    const places = registry && !host && askChain && !off.includes("agent") ? registry.places?.(String(askChain)) || [] : [];
    // The session's own agent carries report too while its graph is on (loopToolArgs), refused in words
    // (REPORT_NOT_YOURS): a task of its graph may start as its fork, whose tools are its own byte for byte (the owner's
    // words of 10-26).
    const carriesReport = graphOn && !host && !leadTeam;
    // Where this Filament keeps a machine for its agents (the remote-agents plan's s-tools), the session's own agent tool
    // takes machine: the store is read once for the turn, as its tools are built — a Filament with none sends the tool
    // it always sent. bash_background takes machine there too (c-tools), on its own switch.
    // Another machine's agents' chat takes none: what this Filament keeps there is for the person's agents.
    const keepsMachine = !wordsOnly && !host && !leadTeam && !agentsChat && (!off.includes("agent") || !off.includes("bash_background")) && keepsAgentsMachine(deps.machines);
    if (keepsMachine && !off.includes("agent")) (rec.changes ||= []).push("agent: this Filament keeps a machine for its agents: the agent tool takes machine, list_machines and cwd");
    const commandsThere = keepsMachine && !off.includes("bash_background") ? createRemoteCommands({ machines: deps.machines ?? null }) : null;
    if (commandsThere) (rec.changes ||= []).push("agent: this Filament keeps a machine for its agents: bash_background takes machine and cwd, and runs its command there");
    const own = wordsOnly ? Object.freeze([]) : loopToolArgs({ delegateRead: !!readerModel, disabled: off, web, lead: !!leadTeam, members: leadTeam?.members ?? null, graph: graphOn, report: !!host?.task, askLead: !!host?.askLead, asks, places, supervise: superviseOn, browser: browserOn, craft: !!craftHere, comeBack: comeBackOffered, machines: keepsMachine });
    const mcpDefs = mcpTools.filter((t) => mcpCore.has(t.server)).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    // A fork (subagents.js, view `fork`) runs on the main agent's request furniture as it was sent — its system
    // prompt, tools, thinking and output ceiling — and on the messages the registry composed: every round then sends
    // the prefix the provider already caches. SUBAGENT_OFF's tools stay in its set (the bytes must not move) and are
    // answered in words instead.
    const forked = host?.fork || null;
    // The skills listed in the prompt (§5.6), read once here and handed to the prompt below: where there are any, the
    // skill tool loads one's text as a tool result (HarnessV4_SpacesPlugins_Plan B4) — core, one small definition. A
    // fork keeps the main agent's prompt and tools as sent, the skill tool among them where it was offered: its calls
    // are answered from the same folders, read here. The tool is offered wherever the Library or the plugins on hold a
    // skill: with no name it finds them by words (the owner's word of 10-27), and it loads any of the Library's by its
    // name, on here or not (the owner's of 11-07) — the prompt lists the chat's own alone, the same bytes every turn.
    const skillsDoc = memState?.sit?.settings || null;
    const forkSkills = !forked || forked.tools.some((/** @type {any} */ t) => t?.name === SKILL_TOOL_NAME);
    // Another machine's agents' chat has none, unless under Full control: the Library and the plugins are the person's.
    const skillsBase = skillsDoc && forkSkills && !fenced ? loadSkills(skillsDoc) : { skills: [], problems: [], plugins: [], library: [] };
    const skillOn = !wordsOnly && !off.includes(SKILL_TOOL_NAME) && skillsBase.skills.length + skillsBase.library.length > 0;
    const extra = [...mcpDefs, ...(doorOn ? [DOOR_TOOL] : []), ...(resourcesOn ? [MCP_RESOURCES_TOOL] : []), ...(skillOn ? [SKILL_TOOL] : [])];
    const tools = forked ? forked.tools : extra.length ? Object.freeze([...own, ...extra]) : own;
    if (wordsOnly)
      (rec.changes ||= []).push(`agent: ${model} takes no tools (${toolsSaid?.source === "operator" ? "its row on the Upstreams page says so" : "its provider's model list says so"}): the turn runs in words only — no tools offered, and its prompt says why`);
    else if (sessionOff.length) (rec.changes ||= []).push(`agent: ${sessionOff.length} tool${sessionOff.length === 1 ? "" : "s"} switched off by the session (loop.tools): ${sessionOff.join(", ")}`);
    if (agentsChat && !fenced && !wordsOnly) (rec.changes ||= []).push("agent: another machine's agents' chat under Full control — it runs as the person's own here, and sends no work on to another machine");
    if (fenced && !wordsOnly) (rec.changes ||= []).push(`agent: another machine's agents' chat — Filament's tools that reach past its folder are left out (${AGENTS_CHAT_OFF.join(", ")}), and so are the chat's MCP servers and skills`);
    if (forked) (rec.changes ||= []).push(`agent: sub-agent ${host?.id} (${host?.card.name}) is a fork — the main agent's system prompt, tools and thinking as they were sent, so the provider reads the shared prefix from its cache; ${SUBAGENT_OFF.join(", ")} are refused in words, and a call that would ask too`);
    else if (host) (rec.changes ||= []).push(`agent: ${host.team ? `team ${possessive(host.team.name)} ${host.team.role}` : "sub-agent"} ${host.id} (${host.card.name}) — the session's tools without ${SUBAGENT_OFF.join(", ")}; a call that would ask ${host.asks ? "waits for the developer's answer" : "is refused in words"}`);
    if (host?.task) (rec.changes ||= []).push(`agent: sub-agent ${host.id} does task ${host.task.id} of the session's task graph — it has the report tool, and its report ends the task`);
    if (host?.askLead) (rec.changes ||= []).push(`agent: ${host.team?.role ?? "worker"} ${host.id} may ask its lead: it has ask_lead, whose question waits for its lead's answer${host.supervise ? " — its lead reads along with it" : ""}`);
    if (host?.planHeld) (rec.changes ||= []).push(`agent: ${host.team?.role ?? "worker"} ${host.id}'s lead reviews its plan (plan_review): its changes and commands wait for its lead's go, or 3 minutes after its plan with no answer`);
    if (leadTeam) {
      (rec.changes ||= []).push(`agent: team ${possessive(leadTeam.name)} lead (engine.team): its workers do the work — agent launches them, worker messages, stops or follows up on them — and ${leadTeam.readOnly ? "its own hands only read, as its workers do: its team changes no file" : fixedMode === "read-only" ? "its own hands only read in this turn, as its workers do: the turn is held to reading" : "it has every hand of its own, under the permission mode, for a piece better done itself"}`);
      rec.changes.push(
        superviseOn
          ? `agent: the lead reads along with its workers (engine.supervise): Filament shows it a look at them at once on a sign, else ${lookSecondsOf(docNow()) ? `every ${lookSecondsOf(docNow())} s while` : "whenever"} something is new (engine.lookSeconds)`
          : "agent: the lead does not read along with its workers (engine.supervise is off, or Filament keeps no run log here): its wait answers with a line for each of them",
      );
    }
    if (host?.team && superviseOn) (rec.changes ||= []).push(`agent: ${host.team.role} ${host.id}'s lead reads along with it (engine.supervise): it says its plan first, and goes on rather than stop to ask`);
    if (host && !host.team && superviseOn) (rec.changes ||= []).push(`agent: the agent that planned sub-agent ${host.id}'s task reads along with it (engine.supervise): it says its plan first, and goes on rather than stop to ask`);
    if (!host && !leadTeam && graphOn)
      (rec.changes ||= []).push(
        agentReads
          ? `agent: the agent reads along with the sub-agents of its task graph (engine.supervise): Filament shows it a look at them at once on a sign, else ${lookSecondsOf(docNow()) ? `every ${lookSecondsOf(docNow())} s while` : "whenever"} something is new (engine.lookSeconds), and its tasks note reaches the one at work on a task`
          : "agent: the agent does not read along with its graph's sub-agents (engine.supervise is off, or Filament keeps no run log here): it hears each task's end",
      );
    if (webOn.length) (rec.changes ||= []).push(`agent: web hands offered by the session (plugins.web): ${webOn.join(", ")}${webCfg.allowPrivate ? " — private addresses allowed (agentLoop.web.allowPrivate)" : ""}`);
    if (browserOn) (rec.changes ||= []).push(`agent: the browser offered by the session (plugins.browser)${browsers?.available ? "" : " — no desktop app is connected now and no Chrome was found on this machine, and its calls say so"}`);
    for (const s of mcpServers) {
      (rec.changes ||= []).push(
        s.conn && s.problem
          ? `agent: MCP server ${s.name} did not answer this turn (${s.problem.split("\n")[0].slice(0, 200)}) — offered as it last listed itself, ${s.conn.tools.length} tool${s.conn.tools.length === 1 ? "" : "s"}, so the request's tools and prompt hold; each call says it is down`
          : s.conn
          ? `agent: MCP server ${s.name} offers ${s.conn.tools.length} tool${s.conn.tools.length === 1 ? "" : "s"} (${s.conn.transport}${s.fresh ? `, connected in ${s.ms} ms` : ", kept from an earlier turn"}${s.conn.tools.filter((t) => t.readOnly).length ? `, ${s.conn.tools.filter((t) => t.readOnly).length} read-only` : ""}) — ${mcpCore.has(s.name) ? "in full with every request (load core)" : "by name in the prompt, each loaded through mcp when the agent needs it (load on-demand)"}`
          : `agent: MCP server ${s.name} left out — ${s.problem}`,
      );
      if (s.conn?.dropped?.length)
        rec.changes.push(`agent: MCP server ${s.name}: ${s.conn.dropped.length} tool${s.conn.dropped.length === 1 ? "" : "s"} not offered — the model-facing name collides with another's after sanitising: ${s.conn.dropped.map((t) => `"${t}"`).join(", ")}`);
      // What a server lists past the tools Filament offers of one, by the first names, the rest counted: a server may list
      // thousands on one page.
      const capped = s.conn?.capped;
      if (capped) {
        const named = capped.names.slice(0, 20).map((t) => `"${t}"`);
        const left = capped.names.length - named.length;
        rec.changes.push(`agent: MCP server ${s.name} lists more tools than the ${capped.at} Filament offers of one server — not offered: ${[...named, ...(left ? [`${left} more`] : []), ...(capped.more ? ["those on the pages after them, not asked for"] : [])].join(", ")}`);
      }
    }
    rec.upstream = "agent-loop";
    rec.upstreamModel = model;
    rec.agent = {
      model, mode, root, promptVersion: PROMPT_VERSION,
      ...(host ? { subagent: host.card.tag } : {}),
      ...(leadTeam ? { team: { key: leadTeam.key, name: leadTeam.name } } : host?.team ? { team: { key: host.team.key, name: host.team.name, role: host.team.role } } : {}),
      ...(forked ? { fork: true } : {}),
      ...(sessionOff.length ? { toolsOff: sessionOff } : {}),
      ...(webOn.length ? { web: webOn } : {}),
      ...(browserOn ? { browser: true } : {}),
      ...(graphOn ? { graph: true } : {}),
      ...(superviseOn ? { supervise: true } : {}),
      ...(mcpServers.length ? { mcp: mcpServers.map((s) => ({ name: s.name, ...(s.conn ? { transport: s.conn.transport, tools: s.conn.tools.length, readOnly: s.conn.tools.filter((t) => t.readOnly).length, load: mcpCore.has(s.name) ? "core" : "on-demand" } : {}), ...(s.problem ? { problem: s.problem } : {}), ms: s.ms })) } : {}),
    };
    // The session's hooks (§5.6) run in the working folder with the turn's identity; the first turn of a session
    // runs the session-start hooks first, and a block refuses the turn in the hook's words.
    const doc = memState?.sit?.settings || null;
    const sessionHooks = doc ? createLoopHooks({ doc, cwd: root, session: sessionChain, turn: memState?.prep?.turnN || null, signal: clientAbort?.signal || null, redact, modeNow }) : null;
    // A sub-agent keeps the pre- and post-tool hooks — they guard every call — but not the turn-end judgements (the
    // hooks and the read-back), which judge the developer's turn when it ends, not each piece of work inside it: its
    // own end is the subagent-end hooks', as Claude's SubagentStop is.
    const subHooks = sessionHooks && host ? { ...sessionHooks, turnEnd: (/** @type {number} */ round) => sessionHooks.subagentEnd(round), readBackBeforeDone: false } : sessionHooks;
    // A builder's patch workspace (adapters/git/patch.js, the owner's plan of 11-09 for big repos): its file tools answer
    // from the overlay and the commit it lies over; what needs a checkout moves it to a worktree at the same folder
    // first — a command, the language server, a hook that runs for the call, a browser page of the folder's —, after
    // the call's own gate. The words of the move ride the result of the call it ran under (the loop's `movedNews`).
    const patchHold = host?.workspace || null;
    let movedSaid = "";
    /** @type {import("../../adapters/tools/patch-hands.js").PatchHold | null} */
    const patchHands = patchHold
      ? {
          ...patchHold,
          move: async (why) => {
            const m = await patchHold.move(why);
            if (m.ok && m.said) movedSaid = m.said;
            return m;
          },
        }
      : null;
    /**
     * Its patch moved to a worktree for `why`, where it is still one; a move that fails throws, in the call's words.
     * @param {string} why
     */
    const moveFor = async (why) => {
      if (!patchHands) return;
      await patchHands.settled();
      if (!patchHands.now()) return;
      const m = await patchHands.move(why);
      if (!m.ok) throw new Error(`this ${why} needs a worktree, which could not be made: ${m.error}`);
    };
    /** A hook that runs for a call runs in a checkout: a patch moves first, and a move that fails blocks the call in words. @param {"pre-tool" | "post-tool"} on @param {string} tool */
    const hookMoved = async (on, tool) => {
      if (!patchHands?.now() || !hooksFor(doc, on, { tool }).length) return null;
      try {
        await moveFor("hook");
        return null;
      } catch (/** @type {any} */ e) {
        return [{ on, tool, command: "", verdict: /** @type {const} */ ("block"), exit: null, ms: 0, timedOut: false, note: String(e?.message || e), args: null }];
      }
    };
    const hooks = subHooks && patchHands
      ? {
          ...subHooks,
          pre: async (/** @type {string} */ tool, /** @type {any} */ input, /** @type {number} */ round) => (await hookMoved("pre-tool", tool)) || subHooks.pre(tool, input, round),
          post: async (/** @type {string} */ tool, /** @type {any} */ input, /** @type {string} */ result, /** @type {boolean} */ ok, /** @type {number} */ round) => (await hookMoved("post-tool", tool)) || subHooks.post(tool, input, result, ok, round),
        }
      : subHooks;
    /** @param {import("./hooks.js").HookOutcome[]} outcomes */
    const recordHooks = (outcomes) => {
      if (!outcomes.length) return;
      rec.hooks = [...(rec.hooks || []), ...outcomes.map((o) => ({ on: o.on, tool: o.tool, command: o.command, verdict: o.verdict, exit: o.exit, ms: o.ms, timedOut: o.timedOut, ...(o.args ? { rewrote: true } : {}), ...(o.builtin ? { builtin: o.builtin } : {}), ...(o.plugin ? { plugin: o.plugin } : {}), note: o.note.slice(0, 600) }))];
      for (const o of outcomes) ops.record("hook", `${o.on}${o.tool ? `(${o.tool})` : ""}: ${o.command.slice(0, 80)} → ${o.verdict}`, { sub: o.verdict, detail: { on: o.on, tool: o.tool, command: o.command, exit: o.exit, ms: o.ms, timedOut: o.timedOut, note: o.note.slice(0, 300), ...(o.builtin ? { builtin: o.builtin } : {}), ...(o.plugin ? { plugin: o.plugin } : {}) }, ref: { requestId: rec.id, ...(sessionChain ? { chainId: sessionChain } : {}) } });
    };
    // A session has started once a turn got past its session-start hooks (`meta.hooksStarted`): a blocked or failed
    // first turn leaves the next one to run them again, rather than the turn number alone deciding.
    const chainMeta = sessionChain && archiveOf?.getChain ? archiveOf.getChain(sessionChain)?.meta || {} : {};
    if (hooks && !resume && !host && (memState?.prep?.turnN === 1 || (memState?.prep?.turnN && !chainMeta.hooksStarted && hooksFor(doc, "session-start").length))) {
      const started = await hooks.sessionStart();
      recordHooks(started);
      for (const o of started) (rec.changes ||= []).push(`hook: ${describeHook(o)}`);
      const block = started.find((o) => o.verdict === "block");
      if (block) return refuse(`The session-start hook \`${block.command}\` blocked this session${saidAs(block.note)} Nothing ran.`, "agent: refused — a session-start hook blocked the session");
      if (started.length && sessionChain && archiveOf?.mergeMeta) {
        try {
          // What a plugin's hook said at the chat's start is the agent's for the whole chat, as Claude keeps it: kept
          // on the chain, by plugin, and told in the system prompt while that plugin's hooks are on here.
          const said = started.filter((o) => o.plugin && o.verdict === "allow" && o.note.trim()).map((o) => ({ plugin: String(o.plugin), note: o.note }));
          archiveOf.mergeMeta(sessionChain, { hooksStarted: true, ...(said.length ? { hooksSaid: said } : {}) });
          if (said.length) chainMeta.hooksSaid = said;
        } catch {}
      }
    }
    // The person's message, before the model reads it (Claude's UserPromptSubmit): a block refuses it in the hook's
    // words; what the hooks that allowed said rides the message, in this request alone.
    let promptSaid = "";
    if (hooks && !resume && !host) {
      const heard = await hooks.promptSubmit(newestUserText(format, body));
      recordHooks(heard);
      for (const o of heard) (rec.changes ||= []).push(`hook: ${describeHook(o)}`);
      const block = heard.find((o) => o.verdict === "block");
      if (block) return refuse(`The prompt-submit hook ${hookLabel(block)} refused this message${saidAs(block.note)} Nothing ran.`, "agent: refused — a prompt-submit hook refused the message");
      promptSaid = hookContext(heard);
    }
    // The person's message goes to the model now, past every refusal above: a chat's name may be read from it
    // (memory's `messageSent`, app/chat-namer.js) — never from a message a hook blocked.
    if (!resume && !host && memState?.prep?.turn) /** @type {any} */ (memory).messageSent?.(String(memState.prep.chain), Number(memState.prep.turn));
    // A plugin's words at the chat's start, while its hooks are on here (a session-start hook of it still joined).
    const startPlugins = new Set(doc ? hooksFor(doc, "session-start").map((h) => h.plugin).filter(Boolean) : []);
    const startSaid = hookContext((Array.isArray(chainMeta.hooksSaid) ? chainMeta.hooksSaid : [])
      .filter((/** @type {any} */ x) => startPlugins.has(x?.plugin) && typeof x?.note === "string")
      .map((/** @type {any} */ x) => /** @type {import("./hooks.js").HookOutcome} */ ({ on: "session-start", tool: null, command: "", verdict: "allow", note: x.note, args: null, ms: 0, exit: 0, timedOut: false, plugin: x.plugin })));
    // The graph lives on the chain (`meta.graph`, TG-D7).
    const graphNow = graphChain ? chainMeta.graph || null : null;
    // Who plans the graph (G3-1): a team's lead, whose tasks name its team's members, else the agent.
    /** @type {import("../../core/task-graph.js").Crew} */
    const crew = leadTeam ? leadTeam.members : "agent";
    if (graphOn) (rec.changes ||= []).push(`agent: the session's task graph is on: the tasks tool rides beside plan${graphNow && !graphNow.closed ? ` — its graph is open, ${graphNow.tasks.filter((/** @type {any} */ t) => t.state === "done").length} of ${graphNow.tasks.length} done` : ""}`);
    // The servers whose tools this turn offers, against those the newest turn that ran to its end offered
    // (`meta.mcpSeen`): the first turn after a change carries a note on its newest message, in this request alone
    // (HS-D25). A model that takes no tools has none at all — its prompt says so — so its turn moves no mark.
    const mcpTrack = !host && !wordsOnly && !!sessionChain;
    const mcpNow = mcpLine.map((s) => s.name);
    const mcpSeen = Array.isArray(chainMeta.mcpSeen) ? chainMeta.mcpSeen.map(String) : null;
    const mcpNote = mcpTrack && mcpSeen && !resume && Number(memState?.prep?.turnN) > 1 ? mcpChangeNote(mcpSeen, mcpNow, mcpServers) : null;
    // The chat moved to another place since its last turn (HarnessV4_Git_Plan GW-D72): its newest message says where it
    // works now, in this request alone, until a turn runs to its end.
    const moved = !host && !resume && sessionChain ? moveNote(chainMeta) : null;
    if (moved) (rec.changes ||= []).push("agent: the chat moved to another folder since its last turn — the newest message carries the note in this request alone");
    if (mcpNote) (rec.changes ||= []).push(`agent: the session's MCP servers changed since its last turn (${[mcpNote.gone.length ? `gone: ${mcpNote.gone.join(", ")}` : "", mcpNote.added.length ? `new: ${mcpNote.added.join(", ")}` : ""].filter(Boolean).join("; ")}) — the newest message carries the note in this request alone`);
    // Each tasks call goes through the runner, which keeps the graph with the session and sends it to the pages. While
    // the turn runs, the runner starts the graph's work: the agent's sub-agents, or the team's workers.
    /**
     * The turn's start on its task graph, kept once a request that carries it came back whole (`call`), as what the start
     * said on its message is (`keepSaid`): a turn whose first request the provider refused counted no turn on its running
     * tasks, and told none of them left idle (the re-review of 11-11). @type {(() => void) | null}
     */
    let graphBegun = null;
    /** Where the agent stands as the turn begins, its start kept at once where there is nothing to hear (`graphs.opening`). */
    const graphBegin = () => {
      const o = /** @type {NonNullable<typeof graphs>} */ (graphs).opening(String(graphChain), crew);
      if (o.words == null) o.begun();
      else graphBegun = o.begun;
      return o.words;
    };
    /** @type {import("./loop.js").LoopArgs["graph"]} */
    // The agent's checklist goes on its graph (HarnessV3-TaskGraph-v2 V2-5, TG2-D75): never a lead's, which does no work itself.
    const graphArg = graphOn && graphs && graphChain ? { apply: (input) => graphs.apply(graphChain, input, { crew, reads: agentReads }), open: () => graphs.open(graphChain, crew), hasOpen: () => graphs.hasOpen(graphChain), begin: graphBegin, where: (o) => graphs.where(graphChain, crew, o), onTask: () => graphs.onTask(graphChain), ownWork: () => graphs.ownWork(graphChain), outside: (file, folder) => graphs.outside(graphChain, file, folder), soFar: agentReads ? (input) => graphs.soFar(graphChain, input) : null, plan: leadTeam ? null : (items, task) => graphs.plan(graphChain, items, task ? { task } : undefined), stepsRefusal: leadTeam ? null : (task) => graphs.stepsRefusal(graphChain, task) } : null;
    const runsGraph = graphArg && graphs && graphChain ? { graphs, chainId: graphChain } : null;
    // The session inspector's "what is in force" names the permission mode this session's loop runs under: a mode
    // this request fixed, else none — its calls follow the session's own, which the inspector reads (AH-F1).
    if (sessionChain && !host) /** @type {any} */ (memory).setSessionAgent?.(sessionChain, { permissions: fixedMode, model });
    let messages = forked ? forked.messages : Array.isArray(body.messages) ? body.messages : [];
    // What earlier turns' starts said on the person's messages goes back on them, as each went out (the owner's of
    // 11-06): the archive keeps a message as the person sent it, and a turn that replayed it bare sent other bytes than
    // the provider cached — a chat with an open task graph wrote its whole history again every turn. Each on its own
    // turn's message (turn-said.js `turnsOf`), before anything is put on it; a fork's messages hold them already.
    const saidChain = !host && !forked && sessionChain && archiveOf?.saidOf && archiveOf?.getMessage ? sessionChain : null;
    if (saidChain) {
      const kept = saidEntries(archiveOf, saidChain, memState?.prep?.turn);
      const back = putSaidBack(messages, kept.said, kept.turns);
      messages = back.messages;
      if (back.put) (rec.changes ||= []).push(`agent: what earlier turns' starts said on ${back.put} of the person's messages went back on them — the history is the bytes the provider cached`);
    }
    /** What this turn's start says on its message, kept with the turn once its first request went out. @type {import("./turn-said.js").Said} */
    const said = { head: [], tail: [] };
    /** What waits for those lines to be kept: a mark that they were told. @type {(() => void)[]} */
    const onSaidKept = [];
    if (promptSaid) {
      messages = withNote(messages, promptSaid);
      said.tail.push(promptSaid);
    }
    if (mcpNote) {
      messages = withNote(messages, mcpNote.text);
      said.tail.push(mcpNote.text);
    }
    if (moved) {
      messages = withNote(messages, moved.text);
      said.tail.push(moved.text);
    }
    // The system text the request carries leads the loop's: memory's briefing and the goal, which memory's prepare
    // placed there. Each tick's memory pass takes them out and places them again, so what the ticks send holds.
    const sysText = Array.isArray(body.system)
      ? body.system.filter((b) => b?.type === "text").map((b) => b.text).filter(Boolean).join("\n")
      : body.system;
    // Instructions and skills (§5.6) close the system prompt: the project's files, the session's text, the skills
    // catalogue and any skill the newest message triggers. The block's hash is on the record, so a file that changed
    // between turns is visible there.
    // A fork's system prompt already carries the main agent's instructions and skills, as they were sent.
    // The session's Environment (HarnessV3-SystemPrompt SP-D2): captured on its first turn and frozen — the session's
    // own agent stores it on its chain, so a later turn, and one after a restart, sends the same bytes. A sub-agent in
    // a worktree captures its own folder's. A fork sends the main agent's prompt as it was, environment included.
    const envChain = !host && sessionChain && archiveOf?.getChain ? sessionChain : null;
    const environment =
      forked || !environments
        ? null
        : await environments.forSession({
            key: sessionKey,
            // A patch has no checkout to read: its session's folder stands for it.
            root: patchHold && host?.folder ? host.folder : root,
            stored: envChain ? chainMeta.environment : null,
            store: envChain && archiveOf?.mergeMeta ? (facts) => archiveOf.mergeMeta(envChain, { environment: facts }) : null,
          });
    // The window the prompt names is the one every round is measured by (below).
    // A side agent works in its model's standard window, never the one its session chose — as a coding agent's does
    // (acp-turn.js): its line is the default share of "the context window model offers" (the owner's word of 10-25).
    // A fork is not one: it carries the main agent's whole request, so it keeps the window that request was made for —
    // in the standard one, a fork of a 1M chat past 200k would stop at its first round.
    const windowOf = sessionWindowFor(cfg, model, host && !host.fork ? null : memState?.sit?.settings?.model?.window);
    const loopWindow = windowOf.tokens || 0;
    // One assembly for the loop and the New Task board (agent/system.js, HarnessV3-NewTask NT-D6).
    // A lead's lines name the models its members run on, each as its launch resolves it (HarnessV3-TaskGraph-v2 TG2-D47).
    // A team that names its workers' models runs them there (team_v2_plan TV2-D8): read once for the turn.
    const leadRows = leadTeam && registry ? await registry.teamRows(leadTeam, chainRef || sessionChain) : null;
    const leadModels = leadTeam && registry ? registry.modelsOf(chainRef || sessionChain, leadTeam.members, model, undefined, leadRows) : null;
    // The newest compaction the chat stands on: a skill its agent turned on since is held out of the list until a newer one.
    const compactionHead = sessionChain && archiveOf?.getCompactions ? Math.max(0, ...archiveOf.getCompactions(sessionChain).filter((/** @type {any} */ c) => c.detail?.door !== "now").map((/** @type {any} */ c) => Number(c?.id) || 0)) : 0;
    // The instruction files as the chat's prompt was written with them, since its newest compaction: told as they were,
    // so an edit mid-chat moves no byte of the prompt (the owner's of 11-07) — the change rides the next message (below).
    const instrChain = !host && !forked && sessionChain && archiveOf?.mergeMeta ? sessionChain : null;
    // Read in the folder the turn works in: a chat moved to another (core/move-note.js) reads its files there anew.
    const chatKept = instrChain && Number(chainMeta.instructionsRead?.head) === compactionHead && chainMeta.instructionsRead?.root === root && chainMeta.instructionsRead?.texts && typeof chainMeta.instructionsRead.texts === "object" ? chainMeta.instructionsRead.texts : null;
    // Another machine's agents' chat is told its folder's instruction files alone: the person's own
    // (`instructions.userFiles`, from their home folder) are theirs — under Full control, it reads them as theirs.
    const instrDoc = fenced && doc?.instructions?.userFiles?.length ? { ...doc, instructions: { ...doc.instructions, userFiles: [] } } : doc;
    // Nor is it told where this Filament listens or its command line — its admin API and its settings are the person's,
    // never their business (the x-sec hunt's): only that Filament runs it. Under Full control it is told, as the person is.
    const envSaid = fenced && environment?.harness ? { ...environment, harness: { command: environment.harness.command, listen: null } } : environment;
    // A patch's folders hold none of the project's files until read: its instruction files are the session folder's.
    const patchNow = patchHold?.now() || null;
    const instructionsKept = chatKept || (patchNow && instrDoc && !forked ? instructionsOver(instructionsBlock(instrDoc, root).read, patchNow) : null);
    const sys = loopSystem({ cfg, doc: forked ? null : instrDoc, root, readerModel, off, web, mcp: mcpLine, host, lead: leadTeam ? { name: leadTeam.name, persona: leadTeam.persona, members: leadTeam.members, models: leadModels, readOnly: !!leadTeam.readOnly, held: !leadTeam.readOnly && fixedMode === "read-only" } : null, requestSystem: sysText, environment: envSaid, model, window: loopWindow, graph: graphOn, asks: asks.length > 0, supervise: superviseOn, noTools: wordsOnly, added: wordsOnly ? [] : added.folders, browser: browserOn, skillSet: forked ? null : skillsBase, hooksSaid: startSaid, instructionsKept });
    const { skillSet, instr } = sys;
    // A $<name> in the message names a skill its agent loads with the skill tool, as it needs it (the owner's of 11-07).
    // A plugin's command the message names is the request itself: it rides the message whole, as every skill it names
    // does where the turn offers no skill tool — kept with it as the lines above are, never the system prompt, whose
    // bytes would move for this turn alone. A fork's messages hold the main agent's.
    const typed = forked || !doc ? "" : newestUserText(format, body);
    const called = typed ? calledNotes(skillsBase, typed).filter((c) => !skillOn || c.skill.kind === "command") : [];
    for (const c of called) {
      messages = withNote(messages, c.text);
      said.tail.push(c.text);
    }
    const tagged = typed && skillOn ? taggedSkills(skillsBase, typed).filter((n) => !called.some((c) => c.skill.name === n)) : [];
    // The instruction files the prompt keeps: recorded as it first tells them; one changed on disk since is told on this
    // message once, kept with it as the lines above are, until a compaction writes the prompt with it.
    if (instrChain && instr) {
      if (!instructionsKept) archiveOf.mergeMeta(instrChain, { instructionsRead: { head: compactionHead, root, texts: instr.read }, instructionsTold: null });
      else {
        const toldNow = Number(chainMeta.instructionsTold?.head) === compactionHead && chainMeta.instructionsTold?.hashes ? chainMeta.instructionsTold.hashes : {};
        const changed = instructionsChanged(instructionsKept, instructionsBlock(instrDoc, root).read, toldNow);
        for (const c of changed) {
          messages = withNote(messages, c.text);
          said.tail.push(c.text);
        }
        if (changed.length) {
          // Told once a request that carries it came back whole, as the turn's other lines are kept (`keepSaid`): a turn
          // that failed first, or an answer to a paused turn, which sends none of them, leaves them for the next.
          onSaidKept.push(() => archiveOf.mergeMeta(instrChain, { instructionsTold: { head: compactionHead, hashes: { ...toldNow, ...Object.fromEntries(changed.map((c) => [c.path, c.hash])) } } }));
          (rec.changes ||= []).push(`agent: ${changed.length} instruction file${changed.length === 1 ? "" : "s"} changed since the chat's prompt was written — told on the message; the prompt keeps the old text until the next compaction`);
        }
      }
    }
    if (instr?.text) {
      rec.agent = { ...rec.agent, instructions: { hash: instr.hash, files: instr.files.map((x) => x.file), ...(instr.missing.length ? { missing: instr.missing } : {}), ...(instr.sessionChars ? { sessionChars: instr.sessionChars } : {}), ...(skillSet.skills.length || called.length || tagged.length ? { skills: skillSet.skills.length, triggered: [...called.map((c) => c.skill.name), ...tagged] } : {}) } };
      (rec.changes ||= []).push(`agent: instructions in the system prompt — ${[...instr.files.map((x) => `${x.file} (${x.chars.toLocaleString()} chars${x.truncated ? ", cut" : ""})`), ...(instr.sessionChars ? [`session text (${instr.sessionChars} chars)`] : []), ...(skillSet.skills.length ? [`${skillSet.skills.length} skill${skillSet.skills.length === 1 ? "" : "s"} listed`] : [])].join(", ")} (hash ${instr.hash})`);
    }
    if (called.length) (rec.changes ||= []).push(`agent: ${called.map((c) => c.skill.name).join(", ")} called — whole on the person's message, kept with it`);
    if (tagged.length) (rec.changes ||= []).push(`agent: the message tags ${tagged.join(", ")} — the agent's to load with the skill tool, nothing of ${tagged.length === 1 ? "it" : "them"} sent`);
    if (instr?.missing.length) (rec.changes ||= []).push(`agent: instruction file${instr.missing.length === 1 ? "" : "s"} not found in the working folder or the folders above it: ${instr.missing.join(", ")}`);
    if (instr?.yoursMissing.length) (rec.changes ||= []).push(`agent: your instruction file${instr.yoursMissing.length === 1 ? "" : "s"} not found: ${instr.yoursMissing.join(", ")}`);
    if (instr?.same.length) (rec.changes ||= []).push(`agent: told once — ${instr.same.map((x) => `${x.file} holds what ${x.as} holds`).join(", ")}`);
    for (const p of skillSet.problems) (rec.changes ||= []).push(`agent: skills — ${p}`);
    // What the plugins on here left out (HarnessV4_SpacesPlugins_Plan B3), in their words.
    for (const n of Array.isArray(doc?.plugins?.notes) ? doc.plugins.notes : []) (rec.changes ||= []).push(`agent: plugins — ${n}`);
    const { overlay } = sys;
    if (overlay) (rec.changes ||= []).push("agent: the operator's system prompt overlay is in force (agentLoop.systemPrompt)");
    const fullSystem = forked ? forked.system : sys.text;
    // What the session's MCP servers add to every request — their tools and the prompt's sentence naming them: the
    // loop's furniture with them less without — kept on the session for `/autofit` (TL-D22), whose furniture
    // (`loopFixedOf`) counts it for the servers the session still has, each server's share in proportion to its
    // tools' weight. Rewritten only when it changed.
    if (!host && sessionChain && archiveOf?.mergeMeta && archiveOf?.getChain) {
      const live = mcpServers.filter((s) => s.conn);
      // The skill tool is the skills', not a server's: it stays on the loop's side of the split.
      const loopOwn = skillOn ? [...own, SKILL_TOOL] : own;
      const whole = estimateTokens(sys.text) - estimateTokens(sys.withoutMcp) + estimateTokens(JSON.stringify(tools)) - estimateTokens(JSON.stringify(loopOwn));
      // A server whose tools load on demand weighs its line in the prompt; the door's own weight goes with them.
      const parts = live.map((s) => estimateTokens(mcpCore.has(s.name) ? JSON.stringify(mcpDefs.filter((d) => mcpByName.get(d.name)?.conn === s.conn)) : doorLines([{ name: s.name, names: toolsOf(s).map(shortName), note: notes.get(s.name) || "" }])));
      const all = parts.reduce((a, b) => a + b, 0);
      let upTo = 0;
      let given = 0;
      const weight = live.map((s, i) => {
        upTo += parts[i];
        const share = Math.round((whole * upTo) / all) - given;
        given += share;
        return { key: specKey(/** @type {any} */ (mcpSpecs.find((m) => m.name === s.name))), name: s.name, tokens: share };
      });
      const had = archiveOf.getChain(sessionChain)?.meta?.mcpWeight;
      if (JSON.stringify(weight) !== JSON.stringify(had || [])) archiveOf.mergeMeta(sessionChain, { mcpWeight: weight.length ? weight : undefined });
    }

    // The truthful composition stamp (option B): the `composed` pipeline stage stamped rec.view.composition from the
    // composer's body, which deliberately carries NO system text or tools (service.js — the loop adds them here on
    // the way out), so Tools read 1 in the meter. Now that fullSystem and the real tool set exist, restamp the
    // composition with what actually goes on the wire, so the meter's breakdown is a measurement, not a remainder.
    try {
      // `messages` is the loop's own (anthropic-shaped, as its door takes them) — what the ticks actually send.
      const realComp = composition(messages, "anthropic", { system: fullSystem, tools });
      rec.view = { ...(rec.view || {}), composition: realComp };
    } catch { /* a composition hiccup must never fail the turn */ }

    // The client-visible reply: the same writer the agent upstreams use, with the loop's blocks recorded beside it
    // so the JSON a non-streaming client gets is the streamed deltas by construction.
    const reply = createAgentReply({
      res,
      format,
      model: body.model,
      requestId: rec.id,
      upstreamId: "agent-loop",
      stream,
      heartbeatMs: agentHeartbeatMs,
      pacingMs: 0,
      onFirstByte: () => usage.firstByte(rec),
      idPrefix: "agent",
      sideEvents: runEvents === true && !!runs,
    });
    /** @type {any[]} */
    const blocks = [];
    let open = null;
    // The words go to the live-words hub too, as they go to the turn's own page (HarnessV3-Launch LD-D16): a page that
    // joins the turn reads them there.
    const emitText = (t) => {
      if (!t) return;
      if (open?.type === "text") open.text += t;
      else blocks.push((open = { type: "text", text: t }));
      liveWords?.piece(rec.id, "text", t);
      if (stream) reply.streamText(t);
    };
    const sink = {
      text: (t) => {
        if (!t) return;
        if (host) registry?.streamed(host.id, "text", t.length);
        emitText(t);
      },
      thinking: (t) => {
        if (!t) return;
        if (host) registry?.streamed(host.id, "thinking", t.length);
        if (open?.type === "thinking") open.thinking += t;
        else blocks.push((open = { type: "thinking", thinking: t }));
        liveWords?.piece(rec.id, "thinking", t);
        if (stream) reply.streamThought(t);
      },
      // The signature lands on the newest unsigned thinking block: on the open one while it streams (the provider's
      // signature_delta arrives before the block closes), or on the assembled one a JSON upstream delivered whole.
      signThinking: (sig) => {
        if (!sig) return;
        const target = open?.type === "thinking" ? open : [...blocks].reverse().find((b) => b.type === "thinking" && !b.signature);
        if (!target || target.signature === sig) return;
        target.signature = sig;
        if (stream && target === open) reply.streamSignature(sig);
      },
      endBlock: () => {
        open = null;
        liveWords?.endBlock(rec.id);
        if (stream) reply.breakBlock();
      },
      // How many reply blocks exist so far (thinking and text, in order). The loop stamps it on each round-start, so
      // the page can place a round's cards after that round's own blocks — the anchor the wire's chronology gives.
      count: () => blocks.length,
    };
    const topic = `run:${rec.id}`;
    const onEvent = (evt) => {
      events.publish(topic, evt);
      if (host) registry?.relay(host.id, evt);
    };
    runs?.startRun({
      id: rec.id,
      kind: host ? "subagent" : "agent-turn",
      title: host ? `${host.team ? host.team.role : "sub-agent"} ${host.id}` : body.model,
      parentId: host && rec.subagentOf && rec.subagentOf !== "owner" ? rec.subagentOf : null,
      // `steerImages`: a note sent into the session's own turn may carry pictures, which the loop hands its model with
      // the words at the round boundary (a sub-agent's run takes words only).
      // `chain`: the session the run belongs to, as its record's memory says — the harness sidebar reads it off the runs
      // list instead of fetching each run's full record every poll (BUG-14/15/19: those fetches held the browser's
      // connections). A sub-agent's is its launching session's. `second`: a second look or a check (S3b, S5d), whose
      // answer stays where it was asked — the sidebar gives its chat no working mark and no unread dot for it; nor for
      // `weighs`, a fork that weighs the person's message aside (the owner's forked steer of 11-04), by the message's id.
      // `hooks`: the session's hooks run commands in this run that no call of it says (app/watchers/own-times.js reads it).
      meta: { model, mode, root, promptVersion: PROMPT_VERSION, resumed: !!resume, session: sessionKey.slice(0, 64), ...(hooks?.commands ? { hooks: true } : {}), ...(host ? { subagent: host.id, card: host.card.tag, chain: chainRef || null, ...(host.second ? { second: true } : {}), ...(host.weighs ? { weighs: host.weighs } : {}) } : { steerImages: true, chain: sessionChain || chainRef || null }) },
      ...(host?.brief ? { brief: host.brief } : {}),
    });
    // Its words are held from the run's start to its end (`closeRun`).
    liveWords?.start(rec.id);
    if (runs) reply.markRun();
    if (host) registry?.attach(host.id, rec.id);
    // The harness's own turn carries its run's events in the reply, from run-start to run-end (HarnessV3-Responsiveness
    // R3): the page used to open a second stream per turn for them, one of the six connections a browser gives this
    // host. The follow ends at run-end (which the loop's end publishes before the reply closes), or when the reply can
    // take no more; a page that missed the tail follows the run from its last event.
    /** @type {{ stop: () => void } | null} */
    let carried = null;
    if (runEvents === true && stream && runs) {
      const page = runs.events(rec.id, { since: 0, limit: 5000 });
      if (page) carried = followRunEvents(runs, rec.id, page, { pageSize: 5000, send: (evt) => reply.runEvent(eventJson(evt)) });
      // A reply that ends before its run does (a pause keeps the run open for the resume) lets go of it too.
      res.once("close", () => carried?.stop());
    }
    // The reply's head carries the run id the harness steers by: it opens now, not with the first text or the 15 s
    // heartbeat (BUG-06) — a turn whose first round was a bare tool call left the page without a run id for 15 s,
    // and a Stop in that window cancelled the turn instead of stopping it. The head is not the reply: the request
    // stays "pending" until the loop's first real output (opening the stream never counts as the first byte).
    if (stream) reply.ensureStart();
    const closeRun = (status, summary) => {
      runs?.endRun(rec.id, { status, summary });
      liveWords?.end(rec.id);
    };
    const costOf = (id) => (id && usage.byId.get(id)?.cost) || 0;
    const writingOf = (id) => (id ? writingMs(usage.byId.get(id)) : null);
    const cacheSaidOf = (id) => cacheSaid(id ? usage.byId.get(id)?.tokens : null);
    // A tick is memory-quiet on the developer's own chain: the parent request already archived, briefed and captured
    // this conversation, so the tick only takes the memory tools (`x-filament-memory: tools`), scoped to that chain. A
    // chat Memory settings leave out has memory leave every tick out too, each naming the chat (memory/brain.js
    // `chatLeftOut`): none of memory's tools ride them, and filament_recall does, which reads only the chat's own record
    // (pipeline/stages/situate.js). `x-filament-agent-of` names the tick's source and keeps it in the run tree. The
    // folder a tick names is the project's: a worktree sub-agent's ticks name the session's folder, as its request did.
    // A sub-agent's calls are background work: at a provider with a ceiling they wait behind the developer's turn
    // (`x-filament-background`, HarnessV3-AtHome AH-F5).
    /** @type {Record<string, string>} */
    const asBackground = host ? { "x-filament-background": "1" } : {};
    // Another machine's agents' chat's calls say so, its ticks and its compaction's fork alike: this machine's own models
    // answer them, never a third machine's (services/devices.js `AGENTS_CHAT_HEADER`).
    /** @type {Record<string, string>} */
    const theirsSaid = agentsChat ? { [AGENTS_CHAT_HEADER]: "1" } : {};
    const lineage = { "x-filament-agent-of": rec.id, "x-filament-cwd": sessionCwd, ...asBackground, ...theirsSaid };
    // The cache lifetime the chat chose (`model.cacheTtl`), fixed for the turn as it starts — a change reaches the next
    // turn: the markers Filament adds ask for it, on the turn's ticks and its forks alike — a fork launched as a
    // sub-agent's run too, whose prefix is the turn's. Another sub-agent's calls keep the route's.
    const chatTtl = (!host || forked) && (doc?.model?.cacheTtl === "5m" || doc?.model?.cacheTtl === "1h") ? String(doc.model.cacheTtl) : null;
    /** @type {Record<string, string>} */
    const ttlAsked = chatTtl ? { "x-filament-cache-ttl": chatTtl } : {};
    const tickHeaders = {
      ...lineage,
      ...ttlAsked,
      "x-filament-memory": "tools",
      ...(conversationId ? { "x-filament-conversation": conversationId } : {}),
      ...(chainRef ? { [CHAIN_HEADER]: chainRef } : {}),
    };
    /** The turn's model calls as they are made — a sub-agent's run that throws still reports what it spent. @type {string[]} */
    const tickIds = [];
    /**
     * What those calls spent (`callSpend`), read off each one's record as it comes back — a record closes before its
     * reply ends. A turn's outcome is its own model calls' (M7-D48): its sub-agents' and the reader's are their own.
     */
    const ownSpend = { tokensIn: 0, tokensOut: 0, costs: /** @type {(number | null)[]} */ ([]) };
    /**
     * The newest call that came back whole: its messages as they went out (the loop replaces messages, never edits a
     * sent one, so the array's copy stays byte-true), its reply, and when it was sent — what the provider holds in its
     * cache for this conversation, which Enhance forks.
     * @type {{ messages: any[], reply: any[], sentAt: number, id: string | null } | null}
     */
    let lastCall = null;
    /**
     * What this turn's start said on its message, kept once a request of it came back whole — the one that wrote the
     * provider's cache —, never on a resume, whose start said nothing new (agent/turn-said.js).
     */
    let saidKept = false;
    const keepSaid = () => {
      saidKept = true;
      if (!saidChain || resume || !memState?.prep?.turn || !archiveOf?.putMessage || !archiveOf?.mergeTurnMeta) return;
      if (!said.head.length && !said.tail.length) return;
      try {
        const stored = archiveOf.putMessage("user", { role: "user", content: [...said.head, ...said.tail].map((text) => ({ type: "text", text })) });
        archiveOf.mergeTurnMeta(memState.prep.turn, { said: { head: said.head.length, hash: stored.hash } });
        for (const f of onSaidKept) f();
      } catch (e) {
        (rec.changes ||= []).push(`agent: what the turn's start said on its message could not be kept (${e instanceof Error ? e.message : String(e)}) — the next turn sends the message without it`);
      }
    };
    /**
     * What the loop took for the turn's first request, told once a request of the turn comes back whole (`saidKept`) —
     * a request no reply comes to (a usage wall, a sign-in, a 4xx) told the model nothing. `exits`: its agent's
     * background shells' ends, the lines a watch caught, a come-back's note, as hands.js `tellShellExits` took them:
     * handed back at the turn's end where none came back (`untellShellExits`), for the agent's next turn. `files`: the
     * move of the sightings of the files it read that changed since (hands.js `peekSightings`), made as one comes back:
     * until then the next look finds the same changes, and the write guard still asks for a read.
     * @type {{ exits: ReturnType<typeof tellShellExits> | null, files: (() => void) | null }}
     */
    const startTook = { exits: null, files: null };
    /** @type {import("./loop.js").LoopArgs["call"]} */
    const call = async ({ body: b, weights: sending = null, onDelta = null, onCall = null, signal = null, onQueue = null, onMemory = null }) => {
      const sentAt = Date.now();
      // `signal` is the loop's cut (the client's hang-up or the harness's stop); a caller without one gets the hang-up.
      const r = await internalCall({ body: b, weights: sending, headers: tickHeaders, signal: signal || clientAbort?.signal, onDelta, onCall, onQueue, onMemory });
      if (r.id) tickIds.push(r.id);
      // What of the conversation was left out to get the call through the front door, said once on the turn's record.
      for (const n of r.notes || []) if (!(rec.changes ||= []).includes(n)) rec.changes.push(n);
      const s = callSpend(r.id ? usage.byId.get(r.id) : null);
      ownSpend.tokensIn += s.tokensIn;
      ownSpend.tokensOut += s.tokensOut;
      ownSpend.costs.push(s.usd);
      // A sub-agent's run says what it has spent as it goes: the Team view's cards show it (HarnessV3-Views V3).
      if (host) registry?.spent(host.id, pricedSum(ownSpend.costs));
      if (r.ok && Array.isArray(r.json?.content)) lastCall = { messages: b.messages.slice(), reply: r.json.content, sentAt, id: r.id };
      if (r.ok && !saidKept) keepSaid();
      // …and the agent has the changed files its first request named as they stand: their sightings move (`startTook`).
      if (r.ok && startTook.files) {
        const moved = startTook.files;
        startTook.files = null;
        moved();
      }
      // The request that carried where the agent stands came back whole: the turn's start is kept on its task graph.
      if (r.ok && graphBegun) {
        const begun = graphBegun;
        graphBegun = null;
        begun();
      }
      return r;
    };
    // `loop.resultCapChars` (HarnessV2 §6.3): a result longer than the cap reaches the model as its head plus a
    // pointer, at the time it happens, so the live turn stays inside the window too; the whole result is archived
    // as a message of its own, named on the turn's `meta.capped`, and `filament_recall({ result })` brings it back:
    // memory offers the tool on every tick of a chat Filament runs, one Memory settings leave out among them (its turn is
    // kept, `prep.leftOut`). A turn memory keeps no row of has nowhere to keep the whole, and its results go whole.
    const resultCap = resultCapOf(memState?.sit?.settings?.loop || null, cfg.agentLoop || {});
    let capped = 0;
    /** @param {string} name @param {string} out */
    const capResult = (name, out) => {
      if (!resultCap || out.length <= resultCap || !archiveOf?.putMessage || !memState?.prep?.turn) return out;
      const ref = resultRef(out);
      try {
        const stored = archiveOf.putMessage("user", { role: "user", content: [{ type: "tool_result", tool_use_id: `capped-${ref}`, content: out }] });
        const turnRow = archiveOf.getTurn?.(memState.prep.turn);
        const list = Array.isArray(turnRow?.meta?.capped) ? turnRow.meta.capped : [];
        if (!list.some((/** @type {any} */ c) => c?.ref === ref)) archiveOf.mergeTurnMeta(memState.prep.turn, { capped: [...list, { ref, hash: stored.hash, chars: out.length, tool: name }] });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} agent: a ${out.length}-character ${name} result could not be archived whole (${e.message}); sent whole instead`);
        return out;
      }
      capped++;
      const head = headChars(out, resultCap);
      return `${head}\n…[Filament: ${out.length - head.length} more characters archived, not shown (loop.resultCapChars ${resultCap}); filament_recall({ result: "r:${ref}" }) brings the whole result back]`;
    };
    /**
     * A source's result as the loop takes it: words cut to the cap, or an image result whole (HarnessV3-Tools
     * TL-D17) — its words are the line naming the image, and the image is not words to cut.
     * @param {string} name @param {unknown} got
     */
    const settled = (name, got) => (got instanceof MediaResult ? got : capResult(name, String(got)));
    // The folders a worker's copy links in from the developer's — its dependency folders (AT-D8): the copy's own to read,
    // as the permits say, so the file tools' fence lets a read follow the link (the E27 hunt of 10-23). Writes have none.
    const copyLinks = host?.workdir && host.folder ? linkedIn(host.folder, host.workdir) : [];
    // A patch has none until it moves to a worktree, whose links are made then: read again at each call.
    const linksNow = () => (patchHold && host?.workdir && host.folder ? linkedIn(host.folder, host.workdir) : copyLinks);
    // Whose background shells this turn's hands reach (HarnessV3-FixRound decision 20): its session's, as the session's
    // main agent, or as the sub-agent the registry launched this run for.
    const shellOwner = { session: shellSessionOf(inboundHeaders, sessionChain), agent: host ? `subagent:${host.id}` : null };
    // What is still open for this agent (agent/still-open.js; the owner's plan of 11-02, Phase 4): a side agent's own
    // commands; a harness chat's main agent's whole list, and what it heard of it, which the chat keeps — said after its
    // fold, and with a turn's first request where it is due (`due`).
    const openNow = () => stillOpen.of(shellOwner.session, shellOwner.agent, { others: true });
    const openFor = !host && !!memState?.sit?.composed && !!shellOwner.session ? stillOpen : null;
    /** Whether the turn's first request carried what is still open (`openNews`). */
    let openSaidAtStart = false;
    // The same agent's sightings of its files (TL-D7); a delegate_read is another model's reading, not this agent's.
    const seen = sightingsOf(`${shellOwner.session}\n${shellOwner.agent ?? ""}`);
    /**
     * The hands, with a command's own timeout capped by the time the turn has left, and a bash that stops when the
     * client hangs up. Every source — a hand, MCP, the web — takes the result budget and the session's redaction and
     * applies both itself, redaction first: no secret shows half at the edge of a cut, and no mark longer than what it
     * replaced pushes a notice off the end. What a source says in an error is redacted by it the same way.
     * @type {import("./loop.js").LoopArgs["runHand"]}
     */
    const runHandFn = async (name, input, { root: r, signal, onOutput = null, movable = null, onMoved = null, mayAct = null, mayLook = null, outside = false, afterWrite = false, remote = null }) => {
      // A write outside the chat's folder the developer said yes to passes the fence, that call alone (A2b). In another
      // machine's agents' chat without Full control the fence keeps a repository's own .git and a credentials folder from
      // its read, grep and glob too (`theirs`, fs-fence.js `keptFromAgents`).
      const take = { maxBytes: RESULT_BUDGET_BYTES, redact, fenced: modeNow() !== "auto" && !(outside && (name === "write" || name === "edit")), theirs: fenced };
      // A patch moves to a worktree for what needs a checkout, the call past its gate (the owner's plan of 11-09): a
      // command; the language server — after a write, only where one serves the file —; a page of the folder's in the
      // browser.
      if (patchHands?.now()) {
        if (name === "bash" || name === "bash_background" || name === "powershell") await moveFor("command");
        else if (name === LSP && (!afterWrite || serverFor(resolve(r, String(input?.path || "")), lspServers, { root: r }).server)) await moveFor("language server");
        else if (name === BROWSER && pageInFolder(input, r)) await moveFor("browser page");
      }
      const reads = [...added.folders, ...worktreeReads, ...linksNow()];
      // Its fetch of an LFS file goes too: once the patch moved, its reads are a worktree's of pointers.
      if (patchHands && PATCH_HANDS.has(name)) return settled(name, await patchHand(name, input, patchHands, { root: r, signal: signal || null, owner: shellOwner, seen, ...take, reads, readRules: readFence ? { root: r, rules: readFence } : null, fetchLfs: host?.fetchLfs ?? null }));
      if (name === BROWSER) {
        // The chat's browser in the desktop app (HarnessV4_Browser_Plan BR2): what a page says is redacted as a fetched
        // page is, an error's words included, before the result budget cuts it.
        if (!browserOn || !browserChain || !browsers) throw new Error("the browser is not offered in this session");
        const clean = redact || ((/** @type {string} */ t) => t);
        try {
          const got = await browsers.call(browserChain, input, { signal: signal || null, seat: browserSeat, ...(mayAct ? { mayAct } : {}), ...(mayLook ? { mayLook } : {}) });
          return got instanceof MediaResult ? new MediaResult(clean(got.text), got.media) : capResult(name, clean(String(got)));
        } catch (/** @type {any} */ e) {
          if (redact && e instanceof Error) e.message = redact(e.message);
          throw e;
        }
      }
      // What the language server that serves a file knows of it (agent/lsp-tool.js): its words redacted as a source's
      // are, an error's included, before the result budget cuts them.
      if (name === LSP) {
        const clean = redact || ((/** @type {string} */ t) => t);
        try {
          return capResult(name, clean(await runLsp(input, { root: r, servers: lspServers, pool: lspPool, signal: signal || null })));
        } catch (/** @type {any} */ e) {
          if (redact && e instanceof Error) e.message = redact(e.message);
          throw e;
        }
      }
      // The door's find and load (E49): a call through it was unwrapped by the loop into the server's own tool's.
      if (name === MCP_DOOR) {
        if (!mcpIndex) throw new Error("no MCP server is connected in this session");
        return capResult(name, doorAnswer(input, mcpIndex));
      }
      // A server's resources, listed or read (agent/mcp-resources.js): its words redacted and cut as a tool's result.
      if (name === MCP_RESOURCES) {
        if (!resourcesOn) throw new Error("no MCP server in this session offers resources");
        return settled(name, await resourcesAnswer(input, resourceServers, { signal: signal || null, maxBytes: take.maxBytes, redact }));
      }
      // A skill loaded by the model (HarnessV4_SpacesPlugins_Plan B4): its text as the tool's result — one of the
      // Library's off here too, on demand, turning nothing on (the owner's of 11-07).
      if (name === SKILL_TOOL_NAME) {
        const got = skillAnswer(skillsBase.skills, input, skillsBase.plugins, skillsBase.library);
        if (!got.ok) throw new Error(got.text);
        (rec.changes ||= []).push(
          "skill" in got
            ? `agent: the skill ${got.skill.name} loaded (${got.skill.chars.toLocaleString()} chars)`
            : "plugin" in got
              ? `agent: the plugin ${got.plugin.name}'s index loaded (${got.plugin.skills.length} skill${got.plugin.skills.length === 1 ? "" : "s"} and commands named)`
              : "found" in got
                ? got.found.words
                  ? `agent: skills found for "${got.found.words}" (${got.found.on} on here${got.found.off ? `, ${got.found.off} off here` : ""})`
                  : `agent: the skills on here listed (${got.found.on})`
                : `agent: ${got.looked.action} in the folder of the skill ${got.looked.skill.name}`,
        );
        return capResult(name, got.text);
      }
      if (isMcpTool(name)) {
        const t = mcpByName.get(name);
        if (!t) throw new Error(`no MCP server offers ${name} in this session`);
        return settled(name, await t.conn.call(t.tool, input, { signal: signal || null, ...take }));
      }
      if (isWebTool(name))
        return capResult(name, String(await runWebHand(name, input, { searchEndpoint: webCfg.searchEndpoint, searchProvider: webCfg.searchProvider, searchApiKey: webCfg.searchApiKey, allowPrivate: webCfg.allowPrivate === true, signal: signal || null, ...take })));
      return settled(name, await hand(name, input, r, { signal: signal || null, onOutput, movable, onMoved, owner: shellOwner, seen, ...take, reads, readRules: readFence ? { root: r, rules: readFence } : null, remote, fetchLfs: host?.fetchLfs ?? null }));
    };
    /**
     * Whether a browser call opens a page of the working folder's own (a `file:` address inside it): a patch's folder
     * holds only what it read and wrote, so it moves to a worktree first.
     * @param {any} input @param {string} r
     */
    const pageInFolder = (input, r) => {
      const url = typeof input?.url === "string" ? input.url.trim() : "";
      if (!/^file:/i.test(url)) return false;
      try {
        const at = relative(resolve(r), fileURLToPath(url));
        return !at.startsWith("..") && !isAbsolute(at);
      } catch {
        return false;
      }
    };
    /** `delegate_read`: one cheap-model pass over a bounded file set, through the front door like every other call. */
    const delegateRead = readerModel
      ? async (/** @type {string[]} */ paths, /** @type {string} */ question, /** @type {{ root: string, signal?: AbortSignal | null }} */ { root: r, signal: stopped = null }) => {
          const files = [];
          let total = 0;
          for (const p of paths.slice(0, READER_MAX_FILES)) {
            let text;
            try {
              // The reader takes text: an image is the line that names it (TL-D17). A patch's reads come from its overlay.
              const o = { redact, fenced: modeNow() !== "auto", theirs: fenced, reads: [...added.folders, ...worktreeReads, ...linksNow()], fetchLfs: host?.fetchLfs ?? null };
              text = String(patchHands ? await patchHand("read", { path: p }, patchHands, { root: r, ...o }) : await hand("read", { path: p }, r, o));
            } catch (/** @type {any} */ e) {
              text = `(could not read: ${e.message})`;
            }
            if (total + text.length > READER_MAX_CHARS) {
              files.push({ path: p, text: `(not read: the ${READER_MAX_CHARS}-character budget for this call is used up)` });
              continue;
            }
            total += text.length;
            files.push({ path: p, text });
          }
          const readerBody = {
            model: readerModel,
            system:
              "You answer one question about the files below, for another model that will not see them. Answer in one or two paragraphs with file references (path and line where useful). Say plainly when the files do not answer the question. No preamble.",
            messages: [
              {
                role: "user",
                content: `${files.map((f) => `### ${f.path}\n${f.text}`).join("\n\n")}\n\nQuestion: ${question}`,
              },
            ],
          };
          const r2 = await internalCall({
            // The most the reader can write, inside its window (HarnessV3-FailurePoints §13).
            body: { ...readerBody, max_tokens: callRoom(cfg, readerModel, estimateBodyTokens(readerBody)) },
            // The reader is Filament's own call: memory stays out entirely (no chain, no archive, no tools).
            headers: { ...lineage, "user-agent": "filament-agent-reader/0.1" },
            // The client's hang-up, and the loop's cut beside it: a Stop ends the reader's call (F4 item 21c).
            signal: stopped && clientAbort?.signal ? AbortSignal.any([clientAbort.signal, stopped]) : stopped || clientAbort?.signal,
          });
          const j = r2.json;
          if (!r2.ok) throw new Error(j?.error?.message || `the reader failed (HTTP ${r2.status})`);
          const text = (j?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("").trim();
          return { text: `[read by ${readerModel}, ${files.length} file${files.length === 1 ? "" : "s"}]\n${text || "(the reader returned no text)"}`, requestId: r2.id };
        }
      : null;
    // Learned permissions (WP-L) live in memory's archive, per project: without memory, or without a project for
    // this chat, the gate asks every time.
    const projectId = memState?.sit?.project?.id;
    const archive = /** @type {any} */ (memory).archive || null;
    if (archive && projectId && projectId !== "none" && al.learnedPermissions?.enabled === false)
      (rec.changes ||= []).push("agent: learned permissions are off for this session (loop.learnedPermissions.enabled); the gate asks every time");
    const permissions = projectPermissions({ archive, projectId, chainId: memState?.prep?.chain || null, loop: al });
    // Memory at the moment of action (HarnessV3-Memory M5-3, M5-5): a pitfall a call walks into, and an open thread on a
    // file it touches, ride on its result. Read through the port, in this chat's project, session and turn (a
    // sub-agent's run rides its session's, on the turn that launched it, M7-D3, as its own conversation, M7-3); and what
    // each call did is told to memory's observers (M5-4). Neither where memory stayed out of the developer's request
    // (`prep.silent`: the session muted, the request quiet, memory or its autopilot off, M6-7).
    const memoryHere = projectId && !memState?.prep?.silent && /** @type {any} */ (memory).scope ?/** @type {any} */ (memory).scope({ role: "agent", project: projectId, chain: memState?.prep?.chain || null, turn: memState?.prep?.turn || memState?.prep?.launchTurn || null, conversation: memState?.prep?.conversation || null, client: memState?.sit?.client || "" }) : null;
    const reminders = memoryHere ? (/** @type {string} */ name, /** @type {any} */ input) => (memoryHere.isOpen() ? memoryHere.reminders(name, input) : []) : null;
    const observe = memoryHere ? (/** @type {any} */ event) => memoryHere.observe(event) : null;
    // Working-tree snapshots (WP-J.2) hang off the archive turn this request opened: without memory there is no turn
    // to attach one to, so none is taken. Each snapshot's parent is the chain's previous one, or where the folder stood
    // as the turn began (turn-tree.js); the turn that answers a pause continues from where the paused one stood.
    const chainId = memState?.prep?.chain || null;
    const turnId = memState?.prep?.turn || null;
    // The ref is named by the chain's turn number (the one a fork's `atTurn` takes); the archive row id is the
    // handle the snapshot is recorded under.
    const turnNo = memState?.prep?.turnN || turnId;
    const tree = al.treeSnapshots !== false && chainId && turnId ? createTurnTree({ memory, chainId, turnId, turnNo, root, from: resume?.paused.treeFrom || null, waiting: resume?.paused.treeWaiting || null }) : null;
    // The client's own cap wins; else the model's stated maximum output; else the 128,000 floor.
    const maxTokens = forked?.maxTokens ? forked.maxTokens : Number(body.max_tokens) > 0 ? Math.floor(Number(body.max_tokens)) : outputCeiling(cfg, body.model);
    // The loop's mid-turn compaction line: the usable window for the live turn, and the summarizer that serves it.
    // The line is the SAME one the turn-start composition aims at (§5.4's thresholdPercent of the window), so both
    // doors agree on where compaction runs. The reply's room is not part of the line — each round's max_tokens is
    // clamped to what remains of the window, the composer's own rule. `window`/`source` carry the hard window and
    // where its number came from (the fail-fast and the run event read them), `fixed` is the system prompt +
    // tool schemas — measured once here because they are constant all turn, and counted so the line measures what
    // actually goes on the wire. `target` is where a compaction aims to land: the room between it and the line is
    // what the loop waits for the turn to grow by before it folds at the line again. An unknown window (0) stands the
    // machinery down: nothing to measure against.
    // A side agent's line is the default share of its model's window up to 400,000 (`sideLineOf`), never its session's.
    // The line is read from the session's document as it stands (`docNow`), so a line moved while the turn runs is the
    // one its next round folds at — the meter draws it at once (the owner's report of 10-27: "i had set the compaction
    // line to be 75% but it compacted at 85%"). The line moves no byte of a request; reading it is a look at the
    // session's row, a few times a round.
    const compSettingsNow = () => (host ? null : docNow() || memState?.sit?.settings || null);
    /**
     * A side agent's follow-up at its line, its earlier exchanges the bigger part (the loop's `compactEarlier`): they
     * give way as its own work does — by itself. Its own model writes one summary of everything ahead of the
     * follow-up's message, its brief and any earlier summary included: reading its own conversation at the line, its
     * transcript after a size refusal or where no fork can be made. Its conversation then starts from that summary
     * (`summaryHead`), as a session's history starts from its compaction, and the follow-up's message comes after it
     * whole. An exchange that ended on its tools' results — its next call failed — leaves them as the newest message,
     * which the follow-up's words join: the calls of the reply that made them, and the thinking that came before them,
     * are no part of what gives way. They stay after the summary as that reply, in the acknowledgment's place, so no
     * result is parted from its call and the messages alternate as they did; the reply's words give way with the rest.
     * Their transcript, read where the fork wrote nothing (compactor.js `transcriptSummary`), is held to the request
     * `summaryCallRoom` leaves once the reply has what a summary of it needs, and the call asks for the rest of the
     * window on one scale. Within that, compaction.js `transcriptWithin` gives way as little as it must: at the line
     * every word whole where it fits — the summary is the only place the reply's words go on — else the older pieces
     * first, cut then left out, the oldest first, and the newest exchange last, cut only as far as the call needs, so a
     * report that ended an exchange past the window keeps all of itself the room holds; after a size refusal, each of
     * the agent's words cut to 2,000 characters and each it was told to 8,000, as the loop's fold of a turn's rounds
     * does, as the conversation was just refused near its room, then its oldest lines left out. Its start — its first
     * message, a fork's the one with its own task (subagents.js `forkTaskAt`) — stays as one, its task whole, and so does
     * an earlier summary — the start an earlier give-way left, a fold of an exchange's rounds — said for what it is,
     * without its lead's word to the model that continues: it stands for all that came before it, and the new summary
     * carries its facts on. Where nothing else can give way, its task is cut as words told are, and the rest gives way
     * again in the same order; the note says what was cut of the words kept, and how many lines were left out.
     * Where the start and the earlier summaries alone do not fit, nothing gives way and the error says so: cut, a
     * summary would lose facts the new one must carry, and a summary the model wrote within its window outgrows one
     * call of it only where the window shrank since.
     * The loop's fold reaches a turn's own rounds alone, and a follow-up has none at its first call: this is what makes
     * its room there. → that start, or why none was made.
     * @param {import("./loop.js").EarlierAsk} o
     * @returns {Promise<{ history: any[], fromTurn: number, toTurn: number, method: string, note: string } | { error: string }>}
     */
    const exchangesGiveWay = async ({ ahead, door, signal = null, onWait, onQueue }) => {
      const n = host?.brief.exchange || 0;
      const last = ahead.at(-1);
      const blocks = last?.role === "assistant" && Array.isArray(last.content) ? last.content : [];
      const calls = blocks.some((/** @type {any} */ b) => b?.type === "tool_use") ? { ...last, content: blocks.filter((/** @type {any} */ b) => b?.type !== "text") } : null;
      const said = calls ? blocks.filter((/** @type {any} */ b) => b?.type === "text" && String(b.text ?? "").trim()) : [];
      const gone = calls ? [...ahead.slice(0, -1), ...(said.length ? [{ role: "assistant", content: said }] : [])] : ahead;
      let text = "";
      if (door === "line") {
        const f = await forkRounds(gone, FORK_SUMMARY_INSTRUCTION, { signal, onWait, onQueue });
        if (f && "text" in f) text = f.text;
        if (!text && signal?.aborted) return { error: "stopped while its summary was written" };
        if (f && "error" in f) log("warn", `${rec.id} a side agent's own compaction of its earlier exchanges failed (${f.error}); its model summarizes their transcript instead`);
      }
      let from = "reading its own conversation";
      if (!text) {
        // A fork's own task stands after the main agent's messages it carries; anything else's, first.
        const forkAt = host?.fork ? forkTaskAt(gone, Number(host.fork.opens) || 0) : -1;
        const t = await transcriptSummary(memory, { gone, model, window: compact.window, ceiling: outputCeiling(cfg, model), factor: compact.factor, grow: door === "line", start: Math.max(0, forkAt), isTask: forkAt >= 0 ? opensForkTask : null, chainId: chainRef || null, signal });
        if ("error" in t) return { error: t.error };
        ({ text, from } = t);
      }
      const [head, ack] = summaryHead(summaryLead(1, n, text));
      return {
        history: [head, calls || ack],
        fromTurn: 1,
        toTurn: n,
        method: "summary",
        note: `compaction: its earlier ${n === 1 ? "exchange" : `${n} exchanges`} summarized by ${model}, itself, ${from}`,
      };
    };
    const compact = {
      get usable() {
        if (!loopWindow) return 0;
        return host ? sideLineOf(loopWindow) : usableWindow(loopWindow, compSettingsNow()?.context?.compaction || {});
      },
      get target() {
        return loopWindow ? Math.floor(loopWindow * MID_TURN_LAND) : 0;
      },
      window: loopWindow,
      source: windowOf.source,
      fixed: estimateTokens(String(fullSystem ?? "")) + estimateTokens(JSON.stringify(tools ?? [])),
      // The lane's learned estimator factor, when its upstream's replies ever stated real usage: the compaction line
      // then triggers on the same scale the provider actually bills. Keyed by the RENDERED wire model — the name
      // the observation sites saw on the body they estimated.
      factor: (() => {
        const r = findRoute(cfg, model);
        const up = r && findUpstream(cfg, r.upstream);
        if (!up) return null;
        const wire = renderUpstreamModel(r.upstreamModel, model, r.captures || []) || model;
        return calibFactor(up.id, parseModelSuffix(wire, cfg.rules).base);
      })(),
      // Which of the conversation's thinking blocks go on the wire (HarnessV3-TaskGraph-v2 TG2-D81): none to an
      // OpenAI-format upstream, the signed to an Anthropic one. The line, the round's room and the fold weigh by it.
      thinking: thinkingOnWire(cfg, model),
      // What the conversation's pictures, PDFs and files weigh on the wire: as the send decides for a request (pdfs.js
      // `mediaWeights`) — one past the request's room, and a PDF that goes as its text, as the words that go instead.
      media: mediaWeights(cfg, model),
      // Who writes the fold's summary is the session's writer choice (compactor.js `chooseWriter`), asked with this
      // loop's own cache: the newest round read or wrote the provider's cache and its lifetime has not run out. At the
      // line, a writer that is the loop's own model forks the live conversation (`forkRounds`) — the whole turn read
      // at the cache's price, its results whole rather than the transcript's clipped lines. The overflow recovery
      // never forks: its conversation is the one the provider just refused for size. A fork that cannot be made or
      // fails takes the transcript path on the same writer.
      // A side agent compacts as models do (the owner's word of 10-25): by itself — its own model writes the summary of
      // all of its work, reading its own conversation where it may (the line, a Compact), else its transcript (a size
      // refusal); no rounds kept whole, no results cleared, no files brought back, never the session's writer, model
      // or method. The task graph and the envelopes still sealed are said after it, as for any agent.
      self: !!host,
      summarize: async (/** @type {string} */ transcript, /** @type {import("./loop.js").CompactAsk} */ o) => {
        if (host) {
          if ((o?.door === "line" || o?.door === "manual") && Array.isArray(o.convo)) {
            const f = await forkRounds(o.convo, roundsForkInstruction(0, o.door), { signal: o.signal, onWait: o.onWait, onQueue: o.onQueue, weights: o.weights, sending: o.sending });
            if (f && "text" in f && f.text) return { text: f.text, by: `${model}, itself`, fork: true };
            if (o.signal?.aborted) return { text: "", by: "" };
            if (f && "error" in f) log("warn", `${rec.id} a side agent's own compaction failed (${f.error}); its model summarizes the transcript instead`);
          }
          try {
            return { text: await summarizeTranscript(memory, { transcript, model, chainId: chainRef || null }), by: `${model}, itself` };
          } catch (/** @type {any} */ e) {
            log("warn", `${rec.id} a side agent's own compaction failed: ${e.message}`);
            return { text: "", by: "" };
          }
        }
        const tokens = estimateTokens(transcript);
        const snap = cacheSnapshot();
        const left = snap ? snap.sentAt + snap.ttlMs - Date.now() : 0;
        const w = chooseWriter({
          cfg,
          doc: memState?.sit?.settings || null,
          sessionModel: model,
          cheapModel: String(/** @type {any} */ (memory)?.summarizerModel?.() || "").trim(),
          cache: snap?.cached === true && left > 0 ? { state: "warm", leftMs: left, tokens: snap.tokens, model } : null,
          transcriptTokens: tokens,
          outTokens: summaryEstimate(tokens, []),
        });
        if (!w.chosen) {
          log("warn", `${rec.id} in-turn compaction: ${w.error}`);
          return { text: "", by: "" };
        }
        // The developer's own Compact (door "manual", BUG-21) forks like the line: the conversation is not one the
        // provider refused, and the warm cache reads every result whole.
        if (w.chosen.fork && (o?.door === "line" || o?.door === "manual") && Array.isArray(o.convo)) {
          const f = await forkRounds(o.convo, roundsForkInstruction(o.keep, o.door), { signal: o.signal, onWait: o.onWait, onQueue: o.onQueue, weights: o.weights, sending: o.sending });
          if (f && "text" in f && f.text) return { text: f.text, by: `${model}, from its warm cache`, fork: true };
          // A stop or the hang-up ended the fork, or its wait to try again: nothing more is called.
          if (o.signal?.aborted) return { text: "", by: "" };
          if (f && "error" in f) log("warn", `${rec.id} in-turn compaction fork failed (${f.error}); summarizing the transcript instead`);
        }
        try {
          return { text: await summarizeTranscript(memory, { transcript, model: w.chosen.model, chainId: chainRef || null }), by: w.chosen.model };
        } catch (/** @type {any} */ e) {
          log("warn", `${rec.id} in-turn compaction failed: ${e.message}`);
          return { text: "", by: "" };
        }
      },
      // What comes back after a fold's summary (HarnessV3-AtHome AH-D9 b): read from this turn's folder, fenced to it
      // whatever the mode, under the session's rules and redaction, within a tenth of the window the line measures
      // by — or of the one assumed when none is known — and within the `room` the fold names: half of what it freed.
      // A side agent's: no files — its own summary says what it read — its plan and graph alone. Last, what is still
      // open for this agent: a side agent's own commands; the main agent's every command, and its sub-agents. A team's
      // lead — the session's loop leading its team, never the main agent of a session with none — hears its workers of
      // this turn that ended too, by its door's list of them. The main agent's letters the folded rounds opened that asked
      // no reply, by this turn's number, which recall brings their words back by — none still owed a reply, which the
      // list names. Dismiss is named only to an agent whose envelope takes it (`dismiss` below): a side agent's does not.
      // The main agent heard the list as it stood then. The block stays in the turn's work, which every later request
      // reads, filament_recall the reader's or not: its letters' lines name no tool, and the composer says it to a
      // reader that has it (sessions/reattach.js `withLettersRecall`; the owner's of 11-09, D6) — this turn's own words
      // are not yet there for recall to bring back.
      reattach: (/** @type {{ files: string[], plan: { text: string, status: string }[] | null, graph: string | null, room?: number | null, letters?: { id: string, from: string, subject: string, turn?: number }[], skills?: string[] | null }} */ o) => {
        const open = openNow();
        openFor?.heard(shellOwner.session, openFor.keys(shellOwner.session));
        const turnN = Number(memState?.prep?.turnN) || 0;
        return reattachBlock({
          ...o,
          ...(host ? { files: [] } : {}),
          letters: !host && turnN > 0 ? (o.letters || []).filter((l) => !open.all.includes(`letter:${l.id}`)).map((l) => ({ ...l, turn: l.turn ?? turnN })) : null,
          // The skills the folded rounds loaded, this turn's: their text went with them (c-compact, 11-10) — named with
          // the turn where it has a number, and alone where it has none (a sub-agent's run, a turn memory keeps no row of).
          skills: o.skills?.length ? o.skills.map((name) => (turnN > 0 ? { name, turn: turnN } : { name })) : null,
          root,
          rules,
          redact,
          window: loopWindow || ASSUMED_WINDOW,
          open: open.lines,
          ended: leadTeam && door && registry && saChain ? endedWorkers(registry, { chainId: saChain, ids: door.inbox.own?.() || [], reads: !!door.inbox.reads }) : null,
          dismiss: !!openFor,
          recall: false,
        });
      },
      // Room in the whole chat (HarnessV4_Tasks C33): the session's own turn has its earlier turns give way by the
      // session's method, a side agent's follow-up its earlier exchanges by itself (`exchangesGiveWay`). A side agent's
      // launch has nothing of its own ahead of its message: a fork's start is the main agent's conversation, carried
      // whole for its cache.
      earlier: host ? (host.brief.exchange > 0 ? exchangesGiveWay : null) : earlier || null,
    };
    // The pipe's agent-lane stamp — the pipeline's autofit stage stamps the plain lanes, this stamps the loop's
    // own request: which window applies, where it came from, how much is usable, and the start-of-turn estimate
    // on the same scale the loop's line measures (furniture included). "unknown" is a first-class verdict: a
    // model with no known window is exactly what the surfaces must be able to say.
    const startEstimate =
      compact.usable > 0 ? compact.fixed + estimateBodyTokens({ messages }, "conversation", compact.factor, { thinking: compact.thinking, weights }) : null;
    rec.context = {
      window: loopWindow || null,
      source: windowOf.source,
      usable: compact.usable || null,
      estimate: startEstimate,
      verdict: loopWindow ? fitVerdict({ window: loopWindow, usable: compact.usable || null, estimate: startEstimate }) : "unknown",
    };
    ops.record("agent", `agent turn ${body.model} started`, {
      sub: "start",
      detail: { model, mode, resumed: !!resume, promptVersion: PROMPT_VERSION },
      ref: { requestId: rec.id },
    });
    const thinking = forked
      ? forked.thinking || null
      : body.thinking && typeof body.thinking === "object" && Number(body.thinking.budget_tokens) > 0 ? { type: String(body.thinking.type || "enabled"), budget_tokens: Math.floor(Number(body.thinking.budget_tokens)) } : null;
    const previewChars = cfg.observability?.runEvents?.toolPreviewChars ?? 2000;
    // The session's sub-agents (subagents.js): this turn's door into the registry — the launcher behind `agent`, the
    // inbox their reports arrive in (the developer's own launches too, whether or not the tool is offered), the
    // timeline their marks land on, and what the spawn widget's Enhance forks: this loop's request as it stands, or
    // its newest completed one once the turn is over — the same model, system prompt, tools and thinking as the
    // ticks, so the provider reads the whole prefix from its cache. A sub-agent's own run opens no door: it launches
    // nothing and nobody delivers to it.
    const saChain = chainRef || sessionChain;
    /** @type {any[] | null} */
    let liveConvo = null;
    /** @type {(() => number) | null} */
    let liveRound = null;
    /** What the loop's request as it stands carries, on its line's scale, a window known or not. @type {(() => number) | null} */
    let liveWeigh = null;
    // A fork rides the ticks' quiet memory, so the pipeline treats it byte for byte as it treats them — but under the
    // developer's lineage, not the turn's: it is no round of the loop, and it books on the session, in the folder the
    // ticks name: a worktree sub-agent's fork names the session's, never its worktree (the bug report's L7). A
    // sub-agent's fork is background work, as its rounds are. Memory gives it the tools it gives the ticks, the recall
    // tool among them, so its prefix reads their cache.
    const forkHeaders = {
      "x-filament-cwd": sessionCwd,
      ...ttlAsked,
      "x-filament-memory": "tools",
      ...(conversationId ? { "x-filament-conversation": conversationId } : {}),
      ...(chainRef ? { [CHAIN_HEADER]: chainRef } : {}),
      "x-filament-subagent-of": "owner",
      ...asBackground,
      ...theirsSaid,
    };
    const forkBase ={ model, max_tokens: maxTokens, ...(thinking ? { thinking } : {}), system: fullSystem, ...(tools.length ? { tools } : {}) };
    /**
     * The fold at the compaction line written from the live conversation itself (HarnessV3-Compaction §5.5): the
     * loop's own model, system prompt, tools and thinking with the conversation as it stands and one instruction as
     * the newest user text, so the provider reads the prefix from its cache. The reply's room is fitted to what the
     * window leaves (the composer's fit rule, capped at the most the model can write: HarnessV3-FailurePoints §13); too little room — or none above the
     * thinking budget, which the fork must keep or miss the cache — makes no fork (null). It books on the session
     * under the developer's lineage, like Enhance, linked to this turn by `x-filament-parent-request` — so its numbers
     * join this turn's as a call that billed — and Traffic lists it as a Compaction fork (`x-filament-fork`). A
     * provider busy for a moment is tried again, as the loop's rounds are (HarnessV3-AtHome AH-F4): `onWait` hears of
     * each wait, `onQueue` of a wait for a slot at the provider (AH-F5), and `signal` — the loop's cut, a stop or the
     * hang-up — ends a wait and the call.
     * @param {any[]} convo
     * @param {string} instruction  what the summary replaces: the turn's rounds, its newest kept, at the line or on the
     *   developer's Compact (`roundsForkInstruction`), or all of `convo` — a side agent's earlier exchanges
     *   (`FORK_SUMMARY_INSTRUCTION`)
     * @param {{ signal?: AbortSignal | null, onWait?: (w: import("../../core/retry.js").Wait | null) => void, onQueue?: (q: import("../../services/call-waits.js").QueueNews | null) => void,
     *   weights?: import("../../core/tokens.js").BlockWeights | null, sending?: import("../../core/tokens.js").BlockWeights | null }} [o]
     *   `weights`: the keeper of what the loop's conversation weighs, whose blocks the fork carries; `sending`: the one
     *   that names each block the loop's rounds send (`everyNamed`), whose names the fork sends them by, so the front
     *   door weighs only what the fork adds
     * @returns {Promise<{ text: string } | { error: string } | null>}
     */
    const forkRounds = async (convo, instruction, { signal = null, onWait = undefined, onQueue = undefined, weights: kept = null, sending = null } = {}) => {
      const messages = forkMessages(convo, instruction);
      const request = compact.fixed + estimateBodyTokens({ messages }, "conversation", compact.factor, { thinking: compact.thinking, weights: kept });
      // Filament's own call: the summary asks for the most the model can write, fitted to what the window leaves — never
      // the client's own max_tokens, which bounds the client's reply (HarnessV3-FailurePoints §13).
      const maxOut = fittedMaxTokens({ window: compact.window, request, cap: outputCeiling(cfg, model), floor: FORK_MIN_TOKENS, thinking: Number(thinking?.budget_tokens) || 0 });
      if (maxOut == null) return null;
      const cutBy = signal || clientAbort?.signal || null;
      /** @type {{ r: import("../internal-call.js").InternalCallResult, tries: number, tooLong?: string }} */
      let got;
      try {
        got = await withRetries(() => internalCall({ body: { ...forkBase, max_tokens: maxOut, messages }, weights: sending, headers: { ...forkHeaders, "x-filament-parent-request": rec.id, "x-filament-fork": "compaction" }, signal: cutBy, onDelta: () => {}, onQueue }), { signal: cutBy, onWait });
      } catch (/** @type {any} */ e) {
        return { error: e.message };
      }
      const r = got.r;
      if (!r.ok) return { error: `${got.tooLong ? `${got.tooLong} — ` : ""}${r.json?.error?.message || `HTTP ${r.status}`}${got.tries > 1 ? ` (after ${got.tries} tries)` : ""}` };
      const content = Array.isArray(r.json?.content) ? r.json.content : [];
      if (content.some((/** @type {any} */ b) => b?.type === "tool_use")) return { error: "the fork called a tool instead of writing the summary" };
      return { text: summaryOfReply(content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text || "")).join("\n")) };
    };
    // How long the provider keeps the prefix after a hit: the TTL the cache markers ask for — the chat's, else the route's.
    const cacheTtlMs = (() => {
      if (chatTtl) return chatTtl === "1h" ? 3_600_000 : 300_000;
      const r = findRoute(cfg, model);
      return mergeRules(cfg.rules, r && findUpstream(cfg, r.upstream)?.rules, r?.rules).cache?.ttl === "1h" ? 3_600_000 : 300_000;
    })();
    /** @returns {import("./subagents.js").CacheSnapshot | null} */
    const cacheSnapshot = () => {
      if (!lastCall) return null;
      const t = lastCall.id ? usage.byId.get(lastCall.id)?.tokens || null : null;
      const read = Number(t?.cacheRead) || 0;
      const write = Number(t?.cacheWrite) || 0;
      // The reply follows the cached prefix, so it costs the fork only its own tokens. Its thinking is dropped unless
      // tool calls need it beside them — a finished answer's thinking is what the provider ignores anyway.
      const reply = lastCall.reply.some((b) => b?.type === "tool_use") ? lastCall.reply : lastCall.reply.filter((b) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
      return {
        body: { ...forkBase, messages: [...lastCall.messages, ...(reply.length ? [{ role: "assistant", content: reply }] : [])] },
        headers: forkHeaders,
        sentAt: lastCall.sentAt,
        ttlMs: cacheTtlMs,
        cached: t ? read + write > 0 : null,
        tokens: t ? (Number(t.input) || 0) + read + write : 0,
        reply: t ? Number(t.output) || 0 : 0,
      };
    };
    // The person's pictures this turn, as its agent's `attach` numbers them (attach.js): its message's, then those its
    // messages into the turn carried, as the loop heard them. A resumed turn's message is the one it began with (the
    // answer reaches the model as words alone), and those heard before its pause come with its park. One taken up from
    // the archive (a restart, or a park let go, while its question waited) numbers none: the newest message ahead of
    // its answer there need not be its own, and a picture in it may be one a boundary delivered. Its park says so to a
    // later resume.
    const knowsPictures = !resume || (!!parked && parked.knowsPictures);
    const openedWith = !knowsPictures ? [] : resume ? openingPictures({ messages: resume.paused.convo.slice(0, resume.paused.baseLen ?? resume.paused.convo.length) }) : openingPictures(body);
    /** @type {import("./attach.js").TurnPicture[]} */
    const heardPictures = [...(parked?.pictures || [])];
    const door =
      registry && !host && saChain
        ? registry.openTurn({
            chainId: saChain,
            runId: rec.id,
            cwd: root,
            mode: fixedMode,
            model,
            thinking,
            fork: () => (liveConvo ? { body: { ...forkBase, messages: structuredClone(liveConvo) }, headers: forkHeaders, tokens: liveWeigh?.() ?? null } : null),
            cache: cacheSnapshot,
            // An event that carries the round it was launched in keeps it: a team's worker reports at its call's.
            emit: (evt) => onEvent({ round: liveRound ? liveRound() : 0, ...evt }),
            lead: !!leadTeam,
            round: () => (liveRound ? liveRound() : 0),
            // The turn holds while the graph's work runs, a review reads or a change merges, or work waits for a slot
            // (G2-7, G3-3).
            owes: runsGraph ? () => runsGraph.graphs.owes(runsGraph.chainId) : null,
            before: soFar,
            // Its looks at its workers: the pace as the session says it at each look (TG2-D21), and how a worker
            // stands now in the watch's words, less its newest tool and words — a look's rounds show those whole.
            // The session's agent, its graph on, looks at its graph's sub-agents the same way, in its own word for them.
            looks: superviseOn ? { seconds: () => lookSecondsOf(docNow()), who: leadTeam ? "workers" : "sub-agents", head: (sa, at) => watchParts(sa, at, { look: true }) } : null,
            // Its agent opens envelopes where its tools hold the envelope tool: else what reaches it comes whole.
            opens: () => own.some((t) => t.name === ENVELOPE),
            // What its agent attaches is read as its own read tool reads (`runHandFn`'s fence, its read rules), at the call.
            attach: () => {
              const reads = [...added.folders, ...worktreeReads, ...linksNow()];
              return { judge: readJudge({ root, rules, fenced: modeNow() !== "auto", reads, theirs: fenced }), redact, pictures: () => (knowsPictures ? [...openedWith, ...heardPictures] : null), folders: [...(root ? [root] : []), ...reads] };
            },
          })
        : null;
    // A team's lead calls the team's tools through the loop's door: the call goes over as plain JSON — the session,
    // this turn and the call, the team — and comes back as one (HarnessV3-AtHome AH-O10).
    /** @type {import("./subagents.js").Subagents | null} */
    let launcher = door?.subagents || null;
    if (leadTeam && door && registry) {
      const teamTools = createTeamTools({ registry });
      // Its check goes to each of its members that changes files (the plan's p6).
      const team = { key: leadTeam.key, name: leadTeam.name, members: leadTeam.members, models: leadTeam.models, check: leadTeam.check };
      /** @param {import("./subagents.js").ToolLaunch} o @returns {import("./team-tools.js").TeamCall} */
      const teamCall = (o) => ({ chainId: String(saChain), lead: { runId: rec.id, callId: o.id }, cwd: root, mode: fixedMode, model, thinking, team, input: o.input, reads: superviseOn });
      launcher = {
        run: (o) => teamTools.agent(teamCall(o)),
        worker: (o) => teamTools.worker(teamCall(o)),
        // A lead that reads along is shown a look when its wait ends — the watch only after a wait that ran out of time
        // with no look due (HarnessV3-TaskGraph-v2 TG2-D48).
        watch: () => teamTools.watch({ chainId: String(saChain) }).text,
      };
    }
    // The graph's work starts while this turn runs (G2-3) — as it opens, and as its tasks end, until it ends: under a
    // lead, as its team's workers, each with the team's words for its role (G3-2).
    const graphTurn = runsGraph && door ? runsGraph : null;
    // Whether a task of the graph may start as a fork of this turn now (`forkPays`, the owner's words of 10-26): its
    // newest request, else — a turn that has sent nothing yet, as tasks waiting start when it opens — the last turn's,
    // kept (`keptFork`), read from the cache, weighed as a fork launched by name is: against the fork's line
    // (`forkLineOf` the window the fork's own run keeps — the session's document and the config as they stand, as the
    // launch reads them — the assumed one where none is known), by the newest request's count, or the loop's
    // conversation as it stands — what the fork copies — where that is the larger (`forkWeight`). A lead's workers start
    // from their briefs.
    const forkable = () => {
      const snap = cacheSnapshot() || (graphTurn && registry?.keptFork?.(graphTurn.chainId, model)) || null;
      const now = liveConvo ? liveWeigh?.() : null;
      const line = forkLineOf(sessionWindowFor(config(), model, (docNow() || memState?.sit?.settings)?.model?.window).tokens);
      return forkPays(snap ? { ...snap, tokens: forkWeight(snap.tokens + (Number(snap.reply) || 0), now), reply: 0 } : null, line, Date.now());
    };
    graphTurn?.graphs.attach(graphTurn.chainId, { runId: rec.id, cwd: root, mode: fixedMode, model, thinking, team: leadTeam ? { key: leadTeam.key, name: leadTeam.name, members: leadTeam.members, check: leadTeam.check } : null, forkable: leadTeam ? null : forkable });
    // The person's notes into this turn, weighed aside by a fork of it where the switch is on, or the person asked for
    // one (the owner's forked steer of 11-04; off unless turned on, 11-05): only where its newest request was read from
    // the cache or wrote to it, the conversation still starts with what it sent, and a fork of it pays — the turn's own
    // snapshot, never the last turn's kept one (`steerGate`). A graph its tasks go on is the session's.
    const asides =
      door && registry && runs && saChain
        ? weighAside({
            chainId: saChain,
            mailbox: runs.mailbox(rec.id),
            registry,
            graphs: graphs && graphChain ? { propose: (_chain, input) => graphs.propose(graphChain, input) } : null,
            can: ({ asked }) => steerGate({ off: !asked && docNow()?.loop?.steerFork !== true, lead: !!leadTeam, sent: lastCall?.messages || null, live: liveConvo, pays: forkable }),
            log,
          })
        : null;
    let out;
    /** The turn so far, as it lets go of the registry: its own background launches and its runs. @type {import("./subagents.js").TurnSoFar | null} */
    let turnSoFar = null;
    // While the loop runs, its own background shells' exits are told to it (TL-D24); after, a sub-agent's go to the
    // session's main agent.
    const leaveShells = attendShells(shellOwner);
    // What is still open, as the turn starts: due where the main agent compacted with nothing said after, or where a
    // change it was told waits for it went since — said with the turn's first request, a resumed turn's never.
    // The chat moved to the loop from a coding agent (`handover`; the owner's of 11-08): what stands goes with the first
    // request where the list goes — the list is part of it — and the chat keeps that the loop heard it once a reply came.
    const handedOver = handover?.text && !resume ? handover : null;
    // What the folder holds is read where the list is said now (`dueNow`), and for a fold in the turn (`refresh`).
    /** @type {{ text: string, keys: string[], why: "lost" | "folded" | "changed" | "waits" | "more" | "switched" } | null} */
    const openAtStart = openFor && !resume ? (handedOver ? { text: handedOver.text, keys: openFor.keys(shellOwner.session), why: "switched" } : await openFor.dueNow(shellOwner.session)) : null;
    if (openFor) void openFor.refresh(shellOwner.session);
    // A change that waits long in this turn with nothing said of it is weighed from its start (`waited`).
    if (openFor) openFor.begin(shellOwner.session);
    const opening = openAtStart?.text || handedOver?.text || "";
    try {
      // The folder as the turn begins, before the model hears of it: what was there before, work not yet committed or
      // edits by hand since the last turn, is never this turn's change (HarnessV3-ACP, AC3's drive D1).
      if (tree && !resume && !host) await tree.begin({ signal: clientAbort?.signal || null });
      // The PDFs the conversation carries, read before the loop weighs it: what each goes as, and its pages.
      if (compact.media) await readPdfs({ messages });
      if (worktreesListed) worktreeReads = await worktreesListed;
      out = await runAgentTurn({
        model,
        messages,
        weights,
        system: fullSystem,
        tools,
        compact,
        modeNow,
        root,
        added: [...added.folders, ...worktreeReads],
        readerModel,
        maxTokens,
        thinking,
        call,
        costOf,
        writingOf,
        cacheSaidOf,
        runHand: runHandFn,
        delegateRead,
        graph: graphArg,
        visuals: off.includes(SHOW_VISUAL) ? null : visualsHere,
        artifacts: off.includes(ARTIFACT) ? null : artifactsHere,
        space: off.includes(SPACE) ? null : spaceHere,
        beside: off.includes(BESIDE_TEAM) ? null : besideHere,
        flow: off.includes(FLOW_NAME) ? null : flowHere,
        thread: off.includes(THREAD) ? null : threadHere,
        craft: craftHere,
        comeBack: comeBackOffered && artifactChain && !off.includes(COME_BACK) ? { session: artifactChain } : null,
        browser: browserOn && browserChain && browsers ? browsers.forAgent(browserChain, browserSeat, browserTeam) : null,
        subagents: off.includes("agent") ? null : launcher,
        inbox: door?.inbox || null,
        // A sub-agent writes the agent that launched it, and answers its letters (the owner's of 11-04).
        letter: host && registry ? (input) => registry.subLetter(host.id, input, { waits: true }) : null,
        // The main agent dismisses lines of what is still open that no longer hold (the owner's of 11-09).
        dismiss: openFor ? (ids) => openFor.dismiss(shellOwner.session, ids) : null,
        // Its background shells' ends, told as the loop takes them: at a round boundary, with the result of work the
        // session keeps; for the turn's first request, held to hand back until a request comes back whole (`startTook`).
        shellNews: () => {
          if (resume || saidKept) return takeShellExits(shellOwner);
          const due = peekShellExits(shellOwner);
          const told = tellShellExits(shellOwner, due.map((d) => d.id));
          startTook.exits = startTook.exits ? { items: [...startTook.exits.items, ...told.items], lost: startTook.exits.lost + told.lost } : told;
          return due;
        },
        // Each block the turn's start puts on the person's message, kept with the turn (`keepSaid`).
        saidAt: saidChain ? (where, text) => (where === "head" ? said.head : said.tail).push(text) : null,
        // The files this agent read that changed since (the owner's word of 10-27), redacted as its reads are. Their
        // sightings move as they are told; those the turn's first request names, once a request comes back whole.
        fileNews: async () => {
          const told = { root, redact, left: (/** @type {string} */ abs) => forgetSighting(seen, abs) };
          if (resume || saidKept) return staleNote(await changedSightings(seen), told);
          const { changes, commit } = await peekSightings(seen);
          startTook.files = commit;
          return staleNote(changes, told);
        },
        // What is still open, where it is due as the turn starts (`openAtStart`), under the session's redaction: with the
        // turn's first request. The chat keeps that the agent heard it once a reply to that request came (the turn's end).
        // What it names is said for the turn: its answers name none of it again (`startSaid`).
        openNews: opening
          ? () => {
              openSaidAtStart = true;
              if (openFor && openAtStart) openFor.startSaid(shellOwner.session, openAtStart.keys);
              return redact ? redact(opening) : opening;
            }
          : null,
        // What is still open, where a change waited long in the turn with nothing said of it (`waited`): at a call, under
        // the session's redaction as at the start; the chat keeps that the agent heard it as it rides the call's result.
        openWaited: openFor
          ? () => {
              const w = openFor.waited(shellOwner.session);
              return w ? { text: redact ? redact(w.text) : w.text, heard: () => openFor.waitedHeard(shellOwner.session, w) } : null;
            }
          : null,
        // A move from a coding agent: the handover carries where the agent stands, which the turn's start says there alone
        // (sw-loop).
        switched: !!handedOver,
        // A compaction since, with nothing open: the request says that and recall's list of the turns alone. A move from a
        // coding agent: what stands, handed over.
        openNote: handedOver
          ? `agent: what stands, handed to the loop with the turn's first request as the chat moved from ${handedOver.from}`
          : openAtStart && openAtStart.why === "lost" && !openAtStart.keys.length
            ? "agent: the chat's context was compacted with nothing said after it, and nothing is open: recall's list of the turns named with the turn's first request"
            : null,
        // A folder below this one tells its instruction files as the agent first works there (the Designer's answer of
        // 10-27), redacted as its reads are.
        // A patch's folders hold none of them until read: they are read in the session's folder, at the same paths.
        folderNews: (worked, told) =>
          patchHold && host?.folder
            ? folderInstructions(host.folder, Array.isArray(doc?.instructions?.files) ? doc.instructions.files : [], worked.map((w) => ({ ...w, path: isAbsolute(w.path) && !relative(root, w.path).startsWith("..") ? relative(root, w.path) : w.path })), told, { redact: redact || undefined })
            : folderInstructions(root, Array.isArray(doc?.instructions?.files) ? doc.instructions.files : [], worked, told, { redact: redact || undefined }),
        // What the language server that serves a file says of its problems once the agent wrote or edited it (the owner's
        // LSP of 11-04): asked as the agent's own lsp tool asks, redacted and cut as its answers are.
        problemsOf: (path, { signal }) => runHandFn(LSP, { action: "diagnostics", path }, { root, signal, afterWrite: true }).then(String),
        // What a patch's move to a worktree said, once, for the result of the call it ran under.
        movedNews: patchHands
          ? () => {
              const s = movedSaid;
              movedSaid = "";
              return s;
            }
          : null,
        // A sub-agent's sparse copy brings in the folder of a file a call reads or writes outside its cone (the owner's
        // plan of 11-09 for big repos).
        widen: host?.widen || null,
        // What waits untold, by kind: the wait's words say what came (an end, lines a watch caught, the time set). The
        // person's Cancel of a come-back ends no wait: it rides the next step (hands.js `wakes`).
        shellDue: () => {
          const kinds = new Set(peekShellExits(shellOwner).filter(wakes).map((x) => x.kind || "exit"));
          return kinds.size === 0 ? null : kinds.size === 1 ? [...kinds][0] : "mixed";
        },
        // The background commands its wait waits for (the gap of 11-10): a sub-agent's own; the session's agent's own,
        // and a sub-agent's whose run no longer hears its end — which then comes to it (commands.js `waitedCommands`).
        shellsWaited: host ? () => runningShellsOf(shellOwner.session).filter((s) => s.agent === shellOwner.agent) : () => waitedCommands(shellOwner.session).running(),
        // A sub-agent's own background commands that still run, said once each as its turn would end (the friction of
        // 11-09): their ends go to whoever launched it once its run is over.
        lead: !!leadTeam,
        shellsRunning: host ? () => runningShellsOf(shellOwner.session).filter((s) => s.agent === shellOwner.agent) : null,
        // A sub-agent's own run hands its conversation to its registry, where its edit cards read their changes as it
        // goes (the transcript audit, 2026-10-23).
        expose: door || host ? (c, roundNow, weigh) => { liveConvo = c; liveRound = roundNow; liveWeigh = weigh; if (host) registry?.runConvo(host.id, c); } : null,
        unattended: host ? unansweredAs(host) : false,
        // A team's worker in a harness session asks the developer, and so does a sub-agent they launched themselves
        // (`hostOf`'s `asks`): the registry holds its question, which the session's route answers, and the run's stop
        // ends the wait (HarnessV3-AtHome P2 step 4; HarnessV4_Tasks E15 step 5, AG-165).
        asker: host?.asks && registry ? (q, signal) => registry.ask(host.id, q, { signal }) : null,
        // Another machine's agents' chat, or a sub-agent's run in one: a command that reads this machine's Filament is no
        // read-only command there (read-only-commands.js `agentsDevice`) — unless under Full control, as the person's.
        agentsChat: fenced,
        // A command on another machine, where bash_background takes machine (the remote-agents plan's c-tools): started
        // there (remote-commands.js), its ask there answered on this run's card by the person's press alone — never in a
        // chat another machine's agents started, which may answer its asks.
        machines: commandsThere
          ? {
              agentsChat: typeof chainMeta.agentDevice === "string",
              answer: (id, o) => (runs ? runs.awaitAnswer(rec.id, id, o) : Promise.resolve(null)),
              start: (input, o) => commandsThere.start(input, { folder: o.root, owner: shellOwner, ask: o.ask, rule: o.rule ?? null, signal: o.signal ?? null, mode: o.mode ?? null }),
            }
          : null,
        // A review rule's second look (HarnessV4_Space_Plan S3b): the Reviewer, read-only, in this chat — a worker's in
        // its session's — on the call that asks, stopped once it is answered.
        secondLook: looks && chainRef ? lookIn(looks, chainRef) : null,
        // A team's worker asks its lead (`hostOf`'s `askLead`, HarnessV3-TaskGraph-v2 TG2-D49, TG2-D58): the registry
        // holds the question — its lead's look shows it, or its lead's door says it — until it is answered.
        askLead: host?.askLead && registry ? (q, o) => registry.askLead(host.id, q, o) : null,
        // A graph task's sub-agent's report names its check in checked (HarnessV3-TaskGraph-v2 TG2-D63): the registry
        // vets the commands as the call is read, by its session's rules and folder.
        checkedVet: host?.task && registry && chainRef ? (c) => registry.checkedProblem(chainRef, c) : null,
        // Its run starts with its changes waiting for its lead's review of its plan (`hostOf`'s `planHeld`, TG2-D50):
        // the gate asks the registry at each call, as its lead's go ends the hold mid-turn.
        planHeld: host?.planHeld && registry ? () => registry.planHeld(host.id) : null,
        // A fork keeps the main agent's tools as they were sent: what its card goes without is refused in words (SA2).
        notCallable: forked
          ? { ...FORK_REFUSALS, ...cardRefusals(host?.card, forked.tools), ...(host?.task ? {} : { report: REPORT_NOT_YOURS.fork }), ...(host?.weighs ? WEIGH_REFUSALS : {}) }
          : carriesReport
            ? { report: REPORT_NOT_YOURS.main }
            : null,
        steerPictures: door ? (pictures) => void heardPictures.push(...pictures) : null,
        mailbox: runs ? runs.mailbox(rec.id) : null,
        permissions,
        rules,
        // A team's worker in a worktree of its own runs what its brief grants without anyone's answer
        // (HarnessV3-TaskGraph-v2 TG2-D44); `hostOf` gives grants only there. In another machine's agents' chat they lift
        // an ask only while that device may run without asking here, read at each call (`unasked`, or Full control).
        grants: host?.grants ? { list: host.grants, folder: host.folder, ...(agentDevice !== null ? { holds: () => heldGrant(deps.devices?.get?.(agentDevice), "unasked") } : {}) } : null,
        // What the chat keeps always allowed (d-allow, chat-always.js), for its own seat alone — its agent, or a team's
        // lead in charge of it: never a sub-agent's run or a worker's, nor a chat another machine's agents started. Read
        // from the chat's meta at each call, so a press holds for the turn's next call, and a Forget too.
        alwaysRun: !host && !agentsChat && (sessionChain || chainRef) ? () => keptNow(archiveOf, sessionChain || chainRef) : null,
        // One with another row of its list to go on to takes a 429 on its first call as its answer (`hostOf`).
        rateMovesOn: host?.rateMovesOn === true,
        // And stays in that worktree whatever the mode (TG2-D38, as a coding agent's worker does): under Auto its hands
        // are not fenced, and a change in the developer's folder would land past its lead's apply.
        fence: host?.workdir && host.folder ? { folder: host.folder } : null,
        hooks,
        reminders,
        observe,
        mcpReadOnly,
        mcpDoor: mcpIndex,
        // A routine's run calls the connections' tools the person switched it on with, without asking
        // (HarnessV4_SpacesPlugins_Plan A2c): Filament marked them on the chat as the run began; its sub-agents get none.
        acts: host ? new Set() : routineActs(chainMeta),
        tree,
        // Where the agent works now rides its run: a chat's own turn's (HarnessV4_Git_Plan GW-D66).
        saysPlace: !host,
        onEvent,
        previewChars,
        // The pictures a call hands the model, kept beside the run files for its card (HarnessV4_Tasks U9).
        keepImages: runs?.keepImages ? (pictures) => runs.keepImages(pictures) : null,
        sink,
        signal: clientAbort?.signal || null,
        resume,
      });
    } catch (/** @type {any} */ e) {
      const aborted = requestWasAborted(e, clientAbort);
      if (host) registry?.finish(host.id, { status: aborted ? "aborted" : "failed", error: String(e.message).slice(0, 300), report: "", convo: null, rounds: 0, toolCalls: 0, tokensIn: 0, tokensOut: 0, spentUsd: tickIds.reduce((n, id) => n + costOf(id), 0), roundIds: [...tickIds] });
      closeRun(aborted ? "aborted" : "error", { error: String(e.message).slice(0, 160) });
      ops.record("agent", `agent turn ${body.model} ${aborted ? "aborted" : "threw"}`, {
        sub: aborted ? "aborted" : "error",
        level: aborted ? "info" : "error",
        detail: { model, error: String(e.message).slice(0, 160) },
        ref: { requestId: rec.id },
      });
      return failWith(aborted ? "client disconnected" : `agent loop failed: ${e.message}`, aborted ? "aborted" : "error");
    } finally {
      // A fork still weighing a note stops: the run's end marks the note unread.
      asides?.close();
      graphTurn?.graphs.detach(graphTurn.chainId, rec.id);
      // A turn that ended on its own leaves each task of the planner's own still running idle where nothing is at work
      // on it, its commands and a come-back it set among what is (d-idle): the next turn's start says so.
      if (graphTurn && !host && out?.status === "done") graphTurn.graphs.turnEnded(graphTurn.chainId, { commands: runningShellsOf(shellOwner.session).length > 0, comeBack: !!comeBackOf(graphTurn.chainId) });
      // A pause's resume reads what the turn's workers ask meanwhile (HarnessV3-TaskGraph-v2 TG2-D58).
      turnSoFar = door?.close({ paused: !!out?.pause && !host }) || null;
      // What the turn's first request took of the shells' ends, where no request of the turn came back whole
      // (`startTook`): it waits untold again. A sub-agent's goes on to the session's main agent as its run leaves, with
      // what came since. The main agent's own is handed back once it has left, so it waits for its next turn and wakes
      // nothing, as what the sessions service gives back of a failed turn does (`carriedEnded`) — less a come-back's
      // note and a check-in where the person stopped the turn, whose Stop drops them.
      const unheard = !startTook.exits || saidKept ? null : out?.stoppedBy ? { ...startTook.exits, items: startTook.exits.items.filter((x) => x.kind !== "wake" && x.kind !== "idle") } : startTook.exits;
      if (unheard && host) untellShellExits(shellOwner, unheard);
      leaveShells();
      if (unheard && !host) untellShellExits(shellOwner, unheard);
      // What the main agent was told is still open, it followed through a turn its model answered — with the list, where
      // one was due: the chat keeps the list as it stands. A turn no reply came to moves nothing.
      if (openFor && out && lastCall && (!openAtStart || openSaidAtStart)) openFor.ended(shellOwner.session, openSaidAtStart);
      // The turn is over, however it ended: Still open weighs a long wait in a running turn alone (`over`).
      if (openFor) openFor.over(shellOwner.session);
      // A worker's own MCP servers and language servers end with its run, before its report lets its copy be given back.
      await Promise.all([mcpLetGo(), lspLetGo()]);
    }
    // The developer's Stop holds the graph and stops its sub-agents (G2-8); a hang-up is no stop, and the work goes on.
    if (graphTurn && out.status === "stopped" && out.stoppedBy) graphTurn.graphs.stop(graphTurn.chainId);
    const t = out.totals;
    // A sub-agent's run reports to the registry before its reply goes out: the launcher reads the outcome from here,
    // and the conversation is kept whole for a follow-up — from the start its earlier exchanges gave way to, where they
    // did (`history`), its message after it as it was sent.
    if (host)
      registry?.finish(host.id, {
        status: out.status,
        error: out.error,
        report: out.final.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n").trim(),
        convo: [...(out.history ? [...out.history, ...messages.slice(-1)] : messages), ...out.work, ...(out.final.length ? [{ role: "assistant", content: out.final }] : [])],
        rounds: t.rounds,
        toolCalls: t.toolCalls,
        tokensIn: t.totalIn,
        tokensOut: t.totalOut,
        spentUsd: t.spentUsd,
        roundIds: t.roundIds,
        stoppedBy: out.stoppedBy ?? null,
        taskReport: out.report ?? null,
        failure: out.failure ?? null,
      });
    // filament_recall runs inside the rounds' own ticks; the turn's record tells the whole story (the footer reads it).
    const recalls = t.roundIds.reduce((n, id) => n + (Number(usage.byId.get(id)?.memory?.recalls) || 0), 0);
    // The turn's worth at list price (Providers P4), over the same rounds as its spend: null while none named one —
    // on a plan the turn paid $0, and this is what the tokens were worth.
    const listed = t.roundIds.map((id) => usage.byId.get(id)?.listCost).filter((v) => typeof v === "number");
    const listUsd = listed.length ? Math.round(listed.reduce((n, v) => n + v, 0) * 1e6) / 1e6 : null;
    rec.agent = { ...rec.agent, status: out.status, ...(out.stoppedBy ? { stoppedBy: out.stoppedBy } : {}), ...(out.forced ? { forced: true } : {}), ...(out.failure ? { failure: out.failure } : {}), rounds: t.rounds, toolCalls: t.toolCalls, learnedRuns: t.learnedRuns, spentUsd: Math.round(t.spentUsd * 1e6) / 1e6, ...(listUsd != null ? { listUsd } : {}), ...(capped ? { cappedResults: capped } : {}), ...(recalls ? { recalls } : {}), ...(t.denied ? { denied: t.denied } : {}), ...(t.ruleRuns ? { ruleRuns: t.ruleRuns } : {}), ...(rules.length ? { rules: rules.length } : {}) };
    // The folders' instruction files told as the agent worked there (explain.js names them).
    if (out.foldersTold?.length) rec.agent.instructions = { ...rec.agent.instructions, told: out.foldersTold };
    // The pipe's estimate is the turn's END state, not its start: whatever the loop last measured (furniture
    // included) re-stamps the record, so a turn that compacted, stood down or stopped at the window leaves the
    // figure it actually ended on.
    if (t.contextTokens != null && rec.context?.window)
      rec.context = {
        ...rec.context,
        estimate: t.contextTokens,
        verdict: fitVerdict({ ...rec.context, estimate: t.contextTokens }),
      };
    // The turn's newest own model call — its prompt as the provider counted it, and what it was made of (sub-agents'
    // calls, results and reports among it). The record's token columns are round one's, where the turn began; the
    // meter reads this for where it ended. A sub-agent's calls are its own record's, never this one.
    // (Read through its declared type: the calls assign it inside a closure, which the flow analysis does not follow.)
    const newest = /** @type {{ messages: any[], reply: any[], sentAt: number, id: string | null } | null} */ (lastCall);
    if (newest) {
      const lt = newest.id ? usage.byId.get(newest.id)?.tokens || null : null;
      try {
        rec.context = {
          ...(rec.context || {}),
          last: {
            held: lt ? (Number(lt.input) || 0) + (Number(lt.cacheRead) || 0) + (Number(lt.cacheWrite) || 0) : null,
            rounds: t.rounds,
            composition: composition(newest.messages, "anthropic", { system: fullSystem, tools }),
          },
        };
      } catch { /* a composition hiccup must never fail the turn */ }
    }
    (rec.changes ||= []).push(...out.notes);
    recordHooks(out.hooks || []);
    if (recalls) (rec.changes ||= []).push(`context: the model brought ${recalls} archived turn${recalls === 1 ? "" : "s"} or result${recalls === 1 ? "" : "s"} back through filament_recall during this turn (Filament answered from the archive)`);
    if (capped) (rec.changes ||= []).push(`agent: ${capped} tool result${capped === 1 ? "" : "s"} longer than ${resultCap.toLocaleString()} characters reached the model as head + pointer (loop.resultCapChars); archived whole, filament_recall brings them back`);
    const summary = { rounds: t.rounds, toolCalls: t.toolCalls, learnedRuns: t.learnedRuns, inputTokens: t.totalIn, outputTokens: t.totalOut, childCostUsd: Math.round(t.spentUsd * 1e6) / 1e6, textBlocks: t.textBlocks, ...(out.forced ? { forced: true } : {}) };
    closeRun(out.status === "failed" ? "error" : out.status, { ...summary, ...(out.error ? { error: String(out.error) } : {}), ...(out.failure ? { failure: out.failure } : {}) });
    ops.record("agent", `agent turn ${body.model} ${out.forced ? "force-stopped" : out.status} after ${t.rounds} round(s), ${t.toolCalls} tool call(s)`, {
      sub: out.status,
      detail: { model, ...summary },
      ref: { requestId: rec.id },
    });
    // The turn's work for the archive (D7). A pause parks the reply whose tool calls are waiting: it is stored with
    // the pause and becomes the first message of the resumed turn's work, so both halves render as valid trajectories.
    const work = out.pause && out.work.at(-1)?.role === "assistant" ? out.work.slice(0, -1) : out.work;
    // What the turn spent (M7-D48): this request's own model calls, the calls of its work, and its time — on top of
    // what the half before a pause spent. A pause keeps it, so the resume's end is the whole turn's.
    const spent = addSpent(resume?.paused?.spent || null, { counts: countCalls(callsOf(work)), tokensIn: ownSpend.tokensIn, tokensOut: ownSpend.tokensOut, usd: pricedSum(ownSpend.costs), ms: Date.now() - startedAt });
    if (out.pause) {
      out.pause.spent = spent;
      out.pause.treeFrom = tree?.next() || null;
      out.pause.treeWaiting = tree?.waiting() || null;
    }
    if (out.pause && !host) parks.park(pendKey, out.pause, turnSoFar, rec.id, knowsPictures ? heardPictures : [], knowsPictures);
    if (sessionChain && archiveOf?.mergeMeta && !host) {
      try {
        const p = out.pause;
        archiveOf.mergeMeta(sessionChain, {
          paused: p
            ? { kind: p.kind, question: p.question || null, ...(p.offer ? { offer: p.offer } : {}), ...(p.keeps ? { keeps: p.keeps } : {}), ...(p.reason ? { reason: p.reason } : {}), ...(p.review ? { review: p.review } : {}), ...(p.look ? { look: p.look } : {}), dangling: p.convo.at(-1), results: p.results, pending: p.pending, remaining: p.remaining, round: p.round, plan: p.plan, root: p.root, readerModel: p.readerModel, heard: p.heard || [], subagentWrote: p.subagentWrote || [], ...(p.wrote ? { wrote: true } : {}), unread: p.unread || [], changed: p.changed || [], spent: p.spent, ...(p.treeFrom ? { treeFrom: p.treeFrom } : {}), ...(p.treeWaiting ? { treeWaiting: p.treeWaiting } : {}), ...(p.supervise ? { supervise: true } : {}), requestId: rec.id, at: Date.now(), expires: Date.now() + PAUSE_TTL_MS }
            : undefined,
          // The MCP servers' mark: a turn that failed or was cut off leaves it for the next turn's note.
          ...(mcpTrack && JSON.stringify(mcpSeen) !== JSON.stringify(mcpNow) && out.status !== "failed" && out.status !== "aborted" ? { mcpSeen: mcpNow } : {}),
          // And for a move's word (GW-D86).
          ...(moved && out.status !== "failed" && out.status !== "aborted" ? toldPatch(chainMeta, moved.ids) : {}),
        });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} pause bookkeeping failed: ${e.message}`);
      }
    }
    // The note the reply ended on (LD-D7), kept with the turn: a page that draws its card leaves the copy out after a
    // reload too. A sub-agent's turn is not archived on the session it rode.
    if (out.notice && memState?.prep?.turn && archiveOf?.mergeTurnMeta && !host) {
      try {
        archiveOf.mergeTurnMeta(memState.prep.turn, { notice: out.notice });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} the turn's note was not kept: ${e.message}`);
      }
    }
    // A turn that answers a pause says so (`answers`), whatever its work opens with: its end is the whole turn's, the
    // asking turn's work with its own. One whose work opens with the reply that asked says that
    // too (`resumes`): the page draws that reply's words on the asking turn, where they were said, and its calls on this
    // one, where they ran — not where a compaction in its middle folded that reply into a summary.
    if (resume && memState?.prep?.turn && archiveOf?.mergeTurnMeta) {
      try {
        archiveOf.mergeTurnMeta(memState.prep.turn, { answers: resume.paused.kind, ...(asking && work[0] === asking.reply ? { resumes: asking.kind } : {}) });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} the turn's resume was not kept: ${e.message}`);
      }
    }
    // A finished turn, or a sub-agent's exchange, is how its model did (M7-D48), kept where memory keeps this session's
    // work (`prep.silent`, the miner's rule, M6-7). A pause is no end: its resume writes the whole turn.
    const ended = endedOf(out.status);
    const prep = memState?.prep;
    if (ended && prep?.chain && !prep.silent)
      memory.recordOutcome({ chain: prep.chain, turn: prep.turn || prep.launchTurn || null, request: rec.id, kind: host ? (host.team ? "worker" : "subagent") : "turn", agent: host ? host.card.tag : null, model, counts: spent.counts, ended, rounds: t.rounds, tokensIn: spent.tokensIn, tokensOut: spent.tokensOut, usd: spent.usd, ms: spent.ms });
    if (out.status === "aborted") return failWith("client disconnected", "aborted", { input: t.firstIn, output: t.totalOut });
    if (out.status === "failed") {
      // A session's turn that failed after doing work stays in the history (HarnessV3-FailurePoints §6 item 1): its
      // work, and why it failed with what it had said, which the next turn reads as its reply (`modelTurnsOf`). One
      // that did nothing drops out, and Retry sends it again. A sub-agent's calls are memory-quiet and open no turn:
      // its conversation is the registry's.
      if (memState?.prep?.turn && work.length && archiveOf?.addWork) {
        try {
          archiveOf.addWork(memState.prep.turn, work);
          const said = out.final.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n").trim();
          archiveOf.mergeTurnMeta(memState.prep.turn, { failed: { at: Date.now(), cause: out.error || "the turn failed", ...(said ? { text: said } : {}), ...(out.failure ? { failure: out.failure } : {}) } });
        } catch (/** @type {any} */ e) {
          log("warn", `${rec.id} the failed turn's work was not kept: ${e.message}`);
        }
      }
      return failWith(out.error || "agent loop failed", "error", { input: t.firstIn, output: t.totalOut }, out.failure ?? null);
    }
    // Round one's cache columns ride along: the client's usage and the parent record then say what the first
    // upstream call actually read/wrote — an agent turn without them reads as "no cache ever" in the meter.
    const usageObj = { input_tokens: t.firstIn, output_tokens: t.totalOut, ...(t.firstCacheRead ? { cache_read_input_tokens: t.firstCacheRead } : {}), ...(t.firstCacheWrite ? { cache_creation_input_tokens: t.firstCacheWrite } : {}) };
    // A tick that produced no text at all still owes the client a message: say so rather than send an empty content
    // array.
    if (!blocks.length) emitText(EMPTY_REPLY_LINE);
    if (stream) {
      await reply.flushPaced();
      reply.endStream("end_turn", usageObj);
    } else reply.sendBlocks(blocks, "end_turn", usageObj);
    // The parent carries round one's tokens for the two-truths contract but no cost: every tick is billed on its own record.
    finish(rec, { status: "ok", httpStatus: 200, tokens: { input: t.firstIn, output: t.totalOut, cacheRead: t.firstCacheRead, cacheWrite: t.firstCacheWrite, ...(t.firstCacheSaid ? { cacheSeen: true } : {}) }, cost: 0 });
    // A sub-agent's conversation is its own: nothing of it is archived on the session it rode.
    if (memState?.prep && !host) {
      try {
        const texts = blocks.filter((b) => b.type === "text");
        // The archived final is the reply that closed the turn: the earlier rounds' words are in the work already, and
        // a turn that ended on a silent reply after tool rounds still needs a final to count as answered.
        const finalContent = out.final.length ? out.final : work.length ? [{ type: "text", text: EMPTY_REPLY_LINE }] : texts;
        memory.afterReply({
          chainId: memState.prep.chain,
          turnId: memState.prep.turn,
          requestId: rec.id,
          finalMessage: { role: "assistant", content: finalContent },
          workMessages: work,
          replyText: texts.map((b) => b.text).join(""),
          outputChars: texts.map((b) => b.text).join("").length,
          injectedIds: memState.prep.ids || [],
          trace: null,
        });
        // A turn the developer stopped carries the stamp a cut reply carries (BUG-07): after a reload its footer says
        // it was stopped — never a normal turn. The loop's own stops (the compaction line under `ask`, the window) are
        // no one's, and are not stamped.
        if (out.stoppedBy) memory.markStopped?.(memState.prep.chain, { requestId: rec.id, by: out.stoppedBy, forced: !!out.forced });
      } catch (/** @type {any} */ e) {
        log("warn", `${rec.id} memory bookkeeping failed: ${e.message}`);
      }
    }
    return undefined;

    /**
     * Fail the turn in whichever shape the response is already in: JSON before any byte went out, an SSE error event
     * after. The record is finished either way. A failure in the one shape sends its words' two parts beside the
     * message (`error.failure`): the page's failure card draws the cause apart from the rest (HarnessV4_Tasks U1).
     * @param {string} message @param {"error" | "aborted"} recStatus @param {{ input: number, output: number } | null} [tokens]
     * @param {import("../../core/failure.js").Failure | null} [failure]
     */
    function failWith(message, recStatus, tokens = null, failure = null) {
      const status = 502;
      const patch = { status: recStatus, httpStatus: status, error: message, ...(tokens ? { tokens } : {}) };
      const parts = failure?.head ? { head: failure.head, more: failure.more || "" } : null;
      if (!res.writableEnded) {
        if (reply.headersSent) reply.endWithError(message, null, parts);
        else {
          const body = errorBody(format, status, message);
          sendJson(res, status, parts ? { ...body, error: { ...body.error, failure: parts } } : body, { "x-filament-request-id": rec.id });
        }
      }
      finish(rec, patch);
      return undefined;
    }
  }
  return {
    turn,
    close: () => Promise.all([mcpPool.closeAll(), lspPool.closeAll()]).then(() => {}),
    /**
     * The project's names an `@#` in the message box asks for (`projectSymbols`), by the language servers of a chat
     * whose settings' `lsp` is given, kept warm with its turns' own. A folder whose files cannot be listed is said so.
     * @param {string} query @param {{ root: string, lsp: unknown, signal?: AbortSignal | null, limit?: number }} o
     */
    symbols: async (query, { root, lsp, signal = null, limit }) => {
      const listed = await listAllFiles(root).catch((/** @type {any} */ e) => ({ failed: String(e?.message || e) }));
      if ("failed" in listed) return { symbols: [], said: `The project's files could not be listed: ${listed.failed}` };
      return projectSymbols(query, { root, files: listed.files, servers: languageServers(lsp), pool: lspPool, signal, ...(limit ? { limit } : {}) });
    },
    /**
     * Let go of a session's paused turn, kept under the key its chain-addressed turns park by (`pendKey`): its question
     * ended with no answer's turn. @param {string} chainId
     */
    letGo: (chainId) => parks.letGo(`chain:${chainId}|agent`),
  };
}

/**
 * hands.js is not yet typed: one typed door to it. `maxBytes` is the caller's budget for the result — the loop asks
 * for a model window's (RESULT_BUDGET_BYTES), so a long result is cut by the hand itself, with the notice that says how
 * to continue; left out, the hands' own 50 KB. `redact` is applied by the hand to what it read, before that cut.
 * `reads`: the folders added to the working folder that read, grep and glob reach too. `readRules`: the session's rules
 * on reading, which keep grep and glob out of the files they refuse. `remote`: bash_background's start on another
 * machine (the remote-agents plan's c-tools). `fetchLfs`: a builder's copy that holds Git LFS's files as their pointers
 * fetches one read opens. `theirs`: the chat is another machine's agents' without Full control (hands.js `runHand`).
 * @param {string} name @param {any} input @param {string} root
 * @param {{ signal?: AbortSignal | null, onOutput?: ((text: string) => void) | null, movable?: ((move: () => { id: string } | null) => () => void) | null, onMoved?: ((m: { id: string, timedOut: boolean }) => void) | null, maxBytes?: number, redact?: ((text: string) => string) | null, fenced?: boolean, theirs?: boolean, owner?: { session: string, agent: string | null }, seen?: import("../../adapters/tools/hands.js").Sightings, reads?: readonly string[], readRules?: { root: string, rules: import("../../core/read-rules.js").ReadRules } | null, remote?: ((input: any) => Promise<{ id: string, s: any }>) | null, fetchLfs?: import("../../adapters/tools/hands.js").FetchLfs | null }} [o]
 * @returns {Promise<string>}
 */
const hand = (name, input, root, o = {}) => /** @type {any} */ (runHand)(name, input, { root, ...o });

/**
 * Why `name` cannot be the model behind the loop (or its reader): it has no route, or its route — primary or any
 * fallback — lands on a coding-agent upstream, which has hands of its own. Null when it is a plain routed model.
 * @param {any} cfg @param {string} name @param {AppDeps["destination"]} destination
 * @returns {{ status: number, why: string } | null}
 */
export function plainModelProblem(cfg, name, destination) {
  const base = parseModelSuffix(name, cfg.rules).base;
  const route = findRoute(cfg, base) || findRoute(cfg, name);
  if (!route) return { status: 404, why: `no route matches model "${name}". Add one on the Routes page.` };
  const upstreams = [route.upstream, ...(Array.isArray(route.fallbacks) ? route.fallbacks.map((f) => (typeof f === "string" ? f : f?.upstream)) : [])].filter(Boolean);
  for (const id of upstreams)
    if (destination(findUpstream(cfg, id))?.agent)
      return { status: 400, why: `"${name}" reaches the coding agent upstream "${id}" (${id === route.upstream ? "its route" : "a fallback"}); the agent loop needs an API model, the agent has hands of its own` };
  return null;
}

