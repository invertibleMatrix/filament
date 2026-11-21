// @ts-check
// Codex through its app-server (HarnessV3-ACP AC2-1). One `codex app-server` per upstream, started on first use and
// closed when idle. A chat is a Codex thread, named in a session map that survives a restart: a new chat starts one
// (`thread/start`), a known one goes on in it, resumed when this process has not loaded it (`thread/resume`). A thread
// started for a chat with history is seeded from Filament's archive as history items (`thread/inject_items`). A turn
// is `turn/start`, read by ./items.js into the events every bridge speaks, so a Codex turn draws the cards a Claude
// turn draws. Codex's approvals are answered by the upstream's permission policy, which also sets Codex's own approval
// policy and sandbox — in a harness session by the session's switch (HarnessV3-ACP AC3-2), which sets the sandbox as
// each turn starts; Filament never sets up Codex's sandbox. The account, its plan's windows, its credits and reset
// credits come from Codex itself (`account/read`, `account/rateLimits/*`), in the one shape every agent's account
// takes (core/agent-limits.js): they go on each turn's record and to the server's store (HarnessV3-ACP AC3-6).
// Filament's standing context goes in a thread's developer instructions as it opens, and Filament's own tools — memory's,
// the task graph's — reach it as an MCP server in the thread's config (HarnessV3-ACP AC4). Only the app-server's stable
// API is used.
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pushNote, appendNotes } from "../../../core/notes.js";
import { readToml } from "../../../core/toml.js";
import { estimateTokens } from "../../../core/tokens.js";
import { flattenMessages, isUserTurn } from "../../../core/wire/flatten.js";
import { ADDS_HEADER, ADDS_NOTHING_LINE, conversationKey } from "../../../core/conversation.js";
import { agentLaunchEnv, agentTitle, catalogueSignIn, signInAdvice } from "../../../core/catalogues.js";
import { accountRecord, codexCredits, codexIdentity, codexMain, codexResetCredits, codexWindows, mergeWindows, sameIdentity } from "../../../core/agent-limits.js";
import { LiveTurn, TurnBridge, addressGiven, addressKept, askingPolicy, describeToolCall, isPolicy, mcpAddress, noteUnanswerable, policyRefused } from "../turn-bridge.js";
import { ENVELOPES_TOOL, ahead, compacted, contextUpdate, givenNote, givenRecord, givenSays, givenTools, notHeldIn, openedWith, promptFor, said, standingFor, standingText, stateOf, withPromptBlocks } from "../context.js";
import { fromCodexQuestion, fromElicitation, toCodexQuestion, toElicitation } from "../asks.js";
import { ClientToolset } from "../client-bridge.js";
import { determineCwd, extractAttachments, findSession } from "../acp/bridge.js";
import { filamentsDoor } from "../acp/toolset.js";
import { modelLabels, typedName } from "../acp/negotiate.js";
import { countTaken, missedTurns, recounted, seenWithin, told } from "../acp/prompt.js";
import { COMPACTED_WORDS, EARLIER_WORDS, compactionOf, earlierTriesOf, lineOf, moveFor, seenOf } from "../compactions.js";
import { idleDropOp, idleStep } from "../idle.js";
import { CodexProcess, codexProfile } from "./app-server.js";
import { codexServers, serversFor } from "../chat-servers.js";
import { PROBE_WAIT_MS, agentEnv } from "../agent-process.js";
import { createCodexReader, powershellCommand, readsOnly } from "./items.js";

/** @typedef {import("../../../core/notes.js").Note} Note */
/**
 * A chat's thread, as the session map keeps it.
 * @typedef {{ sessionId: string, upstreamId: string, cwd: string, turns: number, lastUsed: number, idleMs: number,
 *   modelId: string | null, mode: string, title: string | null, seenUserTurns: number | null, policy: string | null,
 *   effort?: string | null, context?: { used: number, size?: number } | null,
 *   given?: import("../context.js").ContextState, toolsGraph?: boolean, toolsMemory?: boolean, toolsReport?: boolean, toolsAsksLead?: string, toolsTeam?: boolean, toolsReads?: boolean, toolsLaunch?: string, toolsVisuals?: boolean, toolsArtifacts?: boolean, toolsBeside?: boolean, toolsThread?: boolean, toolsFlow?: boolean, toolsBrowser?: boolean, toolsSkills?: boolean, toolsSpace?: boolean, toolsMcp?: string,
 *   mcpToken?: string | null, basedOn?: number, before?: any, made?: boolean, fresh?: boolean, harness?: boolean,
 *   opened?: any, chatServers?: string[], fenced?: boolean, said?: { model: string, asked: string | null } | null,
 *   readOnlySaid?: boolean }} CodexConv
 *   `said`: the model the thread said it is on as it last opened, with the one it was asked for then.
 *   `readOnlySaid`: the chat was told that Codex works read-only in it (`#sandboxNote`).
 *   `given`: what the thread has of Filament's context. `toolsGraph`: whether it was given the task graph's tool as it
 *   last opened; `toolsMemory`, memory's tools (D4 of 11-01); `toolsReport`, a graph task's report (AC6-1); `toolsAsksLead`, the id of the team's worker whose ask_lead it was given (HarnessV3-TaskGraph-v2 TG2-D49), "" for none; `toolsTeam`, a team's tools (AC6-3), `toolsReads` those of a lead that reads along with its workers; `toolsLaunch`, the
 *   word of what the session offered of Filament's sub-agents (HarnessV4_Tasks E12 step 2), "" for nothing;
 *   `toolsVisuals`, the visual tools (HarnessV4_Visuals_Plan E16); `toolsArtifacts`, the artifact tool
 *   (HarnessV4_Artifacts_Plan E18); `toolsBeside`, the team tool (team_v2_plan §5.5); `toolsThread`, the thread tool (app/threads.js); `toolsFlow`, the flow tool (OA3); `toolsBrowser`, the browser (HarnessV4_AgentTools_Plan AT-D7); `toolsSkills`, the skill tool (HarnessV4_Skills_Plan S1-1); `toolsSpace`, the space tool, its project's Space made and on (the owner's of 11-08, h3); `toolsMcp`, the chat's own MCP servers by their key
 *   (`chatKeyOf`, HarnessV4_Overnight_Plan OV-D18), "" for none. `mcpToken`: the
 *   token of the address of Filament's MCP server it was given then, which its record on disk leaves out
 *   (`keptThread`). `basedOn`: the chat's compaction it stands on; `before`: the
 *   thread from before that compaction, while an undo can bring it back (AC5-1). `made`: a thread Filament made, the
 *   fork Codex's own compaction keeps for Undo, deleted once let go (AC5-5). `fresh`: a thread Filament started that has
 *   not had the chat yet, which the next turn hands it (the bug report's L21). `harness`: a harness chat's, whose
 *   record outlives idleness (`idleStep`). `chatServers`: which of the servers it was opened with are the chat's own,
 *   which its record on disk leaves out (`keptThread`). `fenced`: another machine's agents' chat's (`theirsOff`).
 */
/** Filament's own server among the servers a thread is opened with, by its key in Codex's config. */
const OWN_SERVER = "mcp_servers.filament";
/**
 * Codex's own sub-agents (its multi_agent tools: spawn_agent, send_input, wait_agent and the rest), off as a thread
 * opens where Filament's agent tool or its team stands in for them (the owner's of 11-10: "have other agents stop from
 * spawning their sub agents"), as Claude Code's are (acp/toolset.js `CLAUDE_OWN_AGENTS`): its features, as `-c
 * features.<name>=false` sets them (read in Codex 0.163.0: `multi_agent` on by default, `multi_agent_v2` beside it).
 */
export const CODEX_OWN_AGENTS_OFF = Object.freeze({ "features.multi_agent": false, "features.multi_agent_v2": false });
/** Whether a thread was opened without Codex's own sub-agents. @param {any} opened  what it was opened with */
const ownOffIn = (opened) => opened?.config?.["features.multi_agent"] === false;
/** The person's own Codex config: its `config.toml`, in the CODEX_HOME the upstream's process reads. @param {any} upstream */
const codexConfigFile = (upstream) => join(String(agentLaunchEnv(upstream).CODEX_HOME || process.env.CODEX_HOME || "").trim() || join(homedir(), ".codex"), "config.toml");
/**
 * The servers of the person's own Codex config (`codexConfigFile`), switched off by name for a thread of another
 * machine's agents' chat (app/acp-turn.js `fenced`): Codex starts them for any thread it opens, and an `enabled` key of
 * each turns one off however Codex lays a thread's config over its own. A file that is there but cannot be read refuses
 * the thread in words, as its servers would start unseen. `ownGiven`: the thread is given Filament's own server, whose
 * name a server of theirs of that name gives way to.
 * @param {any} upstream @param {boolean} ownGiven
 * @returns {Record<string, false>}
 */
function theirsOff(upstream, ownGiven) {
  const file = codexConfigFile(upstream);
  let doc;
  try {
    doc = readToml(readFileSync(file, "utf8"));
  } catch (/** @type {any} */ e) {
    if (e?.code === "ENOENT") return {};
    throw new Error(`Codex's config (${file}) could not be read, so the MCP servers it names could not be kept from another machine's agents' chat: ${String(e?.message || e).slice(0, 160)}`);
  }
  const named = doc.mcp_servers && typeof doc.mcp_servers === "object" && !Array.isArray(doc.mcp_servers) ? Object.keys(doc.mcp_servers) : [];
  return Object.fromEntries(named.filter((n) => !ownGiven || `mcp_servers.${n}` !== OWN_SERVER).map((n) => [`mcp_servers.${n}.enabled`, /** @type {false} */ (false)]));
}
/**
 * What is said to point a provider built into Codex at another address: a variable it starts with, and a key at the
 * top of its config (the review of 11-11 names them; nothing of this repository shows Codex reading either, and no drive
 * did). Filament reads them only to say on a turn's record that such a provider cannot carry its ask (`addsNothingAt`).
 */
const BUILT_IN_ADDRESS = Object.freeze({ variable: "OPENAI_BASE_URL", key: "openai_base_url" });
/**
 * Filament's ask to add nothing (proxy-twice, core/conversation.js `addsNothing`) as a header of each provider of the
 * person's own Codex config (`codexConfigFile`) whose address is Filament's door, as Settings › Connect sets one up: a
 * thread's model calls that come back through the door get none of Filament's additions again, its memory, context and
 * tools given it already. A key of the thread's config each (`asks`), the provider's own headers kept beside it; a
 * provider elsewhere is given nothing, and one whose headers name the ask already keeps its own, as Claude Code's do
 * (acp/toolset.js `withAddsNothing`). A provider whose name holds a dot is left out, as a dotted key cannot name it.
 * `door`: whether an address is Filament's (acp/toolset.js `filamentsDoor`: any place Filament is reached at, as the
 * address Settings › Connect writes is the one its page was opened at); nothing is weighed where it is not known.
 * `unread`: the file is there and could not be read, with why — its providers go unasked, and the turn's record says so;
 * a file that is not there has none to ask. `builtIn`: what points a provider built into Codex at Filament's door
 * (`BUILT_IN_ADDRESS`), each in words: such a provider has no entry among the config's own, and Filament knows no key
 * of a thread's config that gives it a header, so it is left unasked and the record says that too.
 * @param {any} upstream @param {((url: string) => boolean) | null} door
 * @returns {{ asks: Record<string, string>, unread: string | null, builtIn: string[] }}
 */
function addsNothingAt(upstream, door) {
  if (!door) return { asks: {}, unread: null, builtIn: [] };
  const file = codexConfigFile(upstream);
  /** @type {Record<string, any>} */
  let doc = {};
  let unread = null;
  try {
    doc = readToml(readFileSync(file, "utf8"));
  } catch (/** @type {any} */ e) {
    if (e?.code !== "ENOENT") unread = `its config (${file}) could not be read (${String(e?.message || e).slice(0, 160)})`;
  }
  const providers = doc.model_providers && typeof doc.model_providers === "object" && !Array.isArray(doc.model_providers) ? doc.model_providers : {};
  /** @param {unknown} h */
  const names = (h) => (h && typeof h === "object" ? Object.keys(h) : []).some((k) => k.toLowerCase() === ADDS_HEADER);
  const asks = Object.fromEntries(
    Object.entries(providers)
      .filter(([id, p]) => !id.includes(".") && typeof p?.base_url === "string" && door(p.base_url) && !names(p.http_headers) && !names(p.env_http_headers))
      .map(([id]) => [`model_providers.${id}.http_headers.${ADDS_HEADER}`, "none"]),
  );
  // The variable as Codex starts with it: its launch's, else the one it inherits unless its upstream takes it out, its
  // name in any case on Windows.
  const started = agentEnv(agentLaunchEnv(upstream), upstream.acp?.envRemove).env;
  const variable = process.platform === "win32" ? Object.entries(started).find(([k]) => k.toUpperCase() === BUILT_IN_ADDRESS.variable)?.[1] : started[BUILT_IN_ADDRESS.variable];
  const key = doc[BUILT_IN_ADDRESS.key];
  const builtIn = [
    ...(typeof variable === "string" && door(variable) ? [`${BUILT_IN_ADDRESS.variable} in its environment`] : []),
    ...(typeof key === "string" && door(key) ? [`${BUILT_IN_ADDRESS.key} in its config (${file})`] : []),
  ];
  return { asks, unread, builtIn };
}
/** Whether a key of a thread's config is Filament's ask of a provider (`addsNothingAt`). @param {string} k */
const askKey = (k) => k.startsWith("model_providers.") && k.endsWith(`.http_headers.${ADDS_HEADER}`);
/**
 * A thread's record as written to disk: of the MCP servers it was opened with, Filament's own alone, by its address
 * without its token, the thread's capability (`addressKept`); the record holds no token either. The chat's own servers
 * (HarnessV4_Overnight_Plan OV-D18) and the upstream's own (`acp.mcpServers`), whose env and headers may carry a
 * secret, are left out. A thread resumed from it after a restart (`#openAgain`) is given its upstream's servers again
 * from the configuration and Filament's own a new token; it has none of the chat's, and the chat's next turn opens it
 * again with them (its `toolsMcp` kept empty).
 * @param {CodexConv} c
 * @returns {CodexConv}
 */
const keptThread = (c) => {
  const names = Array.isArray(c.chatServers) ? c.chatServers : [];
  const { mcpToken: _token, ...rest } = c;
  const before = c.before ? keptThread(c.before) : c.before;
  if (!c.opened?.config) return { ...rest, before };
  const config = Object.fromEntries(
    Object.entries(c.opened.config)
      .filter(([k]) => k === OWN_SERVER || !k.startsWith("mcp_servers."))
      .map(([k, v]) => [k, k === OWN_SERVER && typeof v?.url === "string" ? { ...v, url: addressKept(v.url) } : v]),
  );
  return { ...rest, before, opened: { ...c.opened, config }, ...(names.length ? { toolsMcp: "", chatServers: [] } : {}) };
};
/**
 * What Codex says of the account it runs on: who (`none` when signed out), its plan's windows, its credits and reset
 * credits, why it last stopped, and when that was last heard.
 * @typedef {{ identity: import("../../../core/agent-limits.js").Identity,
 *   windows: import("../../../core/agent-limits.js").PlanWindow[],
 *   credits: import("../../../core/agent-limits.js").Credits | null,
 *   resetCredits: import("../../../core/agent-limits.js").ResetCredits | null, reached: string | null,
 *   at: number }} CodexAccount
 */

/** How long a model list is kept before Codex is asked again. */
const MODELS_TTL = 3600_000;
/**
 * How long Codex lets one call of Filament's tools run (its server entry's `tool_timeout_sec`, Codex's own config): a
 * team's lead's wait answers within it (HarnessV3-ACP AC6-4).
 */
const TOOL_TIMEOUT_SEC = 600;
const short = (/** @type {unknown} */ id) => String(id || "").slice(0, 8);
/** The words an approval question is phrased for, by what Codex asks. */
const ASKS = /** @type {const} */ (["command", "file", "permissions"]);
/**
 * What Codex asks before one of an MCP server's tools runs (its `mcp_tool_call` approval): the server, the tool by the
 * name its question says, and the arguments. A question Codex words otherwise (an app's) names the tool by its title.
 * @param {any} params
 */
function mcpToolAsked(params) {
  const meta = params._meta;
  const tool = /to run tool "(.+)"\?$/.exec(String(params.message || ""))?.[1] || String(meta.tool_title || "a tool");
  return { server: String(params.serverName || ""), tool, input: meta.tool_params && typeof meta.tool_params === "object" ? meta.tool_params : {} };
}
/**
 * Codex's ways to sign in (HarnessV3-ACP AC3-7): ChatGPT's page, which returns to this computer, a code typed on that
 * page in another computer's browser, and an OpenAI API key pasted here (the review of 11-10: someone with a key alone
 * could not sign in), which Codex keeps in its own folder.
 * @type {import("../../../core/ports.js").SignInWay[]}
 */
const CODEX_WAYS = [
  { id: "chatgpt", name: "ChatGPT", description: "Sign in on ChatGPT's page, in this computer's browser", kind: "browser" },
  { id: "chatgpt-code", name: "ChatGPT on another device", description: "For a browser on another computer: open ChatGPT's page there and type the code it shows here", kind: "browser", far: true },
  { id: "api-key", name: "OpenAI API key", description: "Paste a key from your OpenAI account: Codex keeps it in its own folder, and Filament keeps none", kind: "key", label: "OpenAI API key" },
];
/**
 * Codex's own CLI sign-in, `codex login`, for where its app-server can't start: the catalogue's (the configured
 * program, with the options before its `app-server` kept, in the account's folder).
 * @param {any} u
 * @returns {import("../../../core/ports.js").SignInWay}
 */
function codexLogin(u) {
  const own = /** @type {NonNullable<ReturnType<typeof catalogueSignIn>>} */ (catalogueSignIn(u));
  return { id: "cli", description: "Its own CLI's sign-in, in a terminal", kind: "terminal", ...own };
}

/**
 * Filament's permission policy as Codex's own approval policy and sandbox. `allow-all` needs no approvals and has full
 * access. `read-only` and `reject` keep Codex read-only and bring Filament every command Codex does not know to be safe,
 * and so does a word that is none of the policies, which lets nothing be written unasked (`askingPolicy`). `allow-once`
 * and `ask` let it write in the project folder where its sandbox is set up (Codex itself makes that read-only where it
 * is not, as on Windows until the person sets it up) and bring Filament anything else.
 * @param {string} policy
 * @returns {{ approvalPolicy: "never" | "untrusted", sandbox: "danger-full-access" | "read-only" | "workspace-write" }}
 */
export function codexPolicy(policy) {
  if (policy === "allow-all") return { approvalPolicy: "never", sandbox: "danger-full-access" };
  if (policy === "read-only" || policy === "reject" || !isPolicy(policy)) return { approvalPolicy: "untrusted", sandbox: "read-only" };
  return { approvalPolicy: "untrusted", sandbox: "workspace-write" };
}

/**
 * The session's switch as Codex's approval policy and sandbox (HarnessV3-ACP AC3-2): Codex asks Filament before each
 * change and each command it does not know to be safe, in every mode, so the session's rules hold in auto too; the
 * sandbox follows the mode — read-only's reads only, auto's full access, the project folder's otherwise.
 * @param {string} mode  the switch's mode as the turn starts
 * @returns {{ approvalPolicy: "untrusted", sandbox: "danger-full-access" | "read-only" | "workspace-write" }}
 */
const switchPolicy = (mode) => ({ approvalPolicy: "untrusted", sandbox: mode === "read-only" ? "read-only" : mode === "auto" ? "danger-full-access" : "workspace-write" });

/**
 * Said to Codex as a thread opens under a switch that only reads, on Windows. Codex reads through its shell, which is
 * PowerShell there; Filament judges each script before it runs (adapters/tools/read-only-powershell.js: cmdlets that
 * read, no program), and Codex tells its model only that a refused one was rejected — never why, nor what would run.
 */
export const READS_ON_WINDOWS =
  "This session only reads, and Filament judges each command before it runs. PowerShell's own reading commands run: Get-Content, Get-ChildItem, Select-String, Select-Object, Measure-Object, Sort-Object, Get-Item, Test-Path, Resolve-Path, Get-Location, on paths inside the working folder. A program (rg, git, node, python) is refused here, and so is anything that writes; a refusal reaches you as rejected by the user, though nobody was asked. So search with Select-String and read with Get-Content.";

/** A sandbox mode as the policy object a turn takes, and as a thread reports it. @param {string} mode */
const sandboxPolicy = (mode) =>
  mode === "danger-full-access"
    ? { type: "dangerFullAccess" }
    : mode === "read-only"
      ? { type: "readOnly", networkAccess: false }
      : { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };

/** The names a client can ask for: each model, and each model with an effort it takes. @param {any[]} items */
export function expandCodexModels(items) {
  /** @type {string[]} */
  const names = [];
  for (const m of items || []) {
    if (!m?.id || m.hidden) continue;
    names.push(String(m.id));
    for (const e of m.supportedReasoningEfforts || []) if (e?.reasoningEffort) names.push(`${m.id}-${e.reasoningEffort}`);
  }
  return [...new Set(names)];
}

/**
 * A model name from the route (`gpt-6-astra`, `gpt-6-astra-high`, `auto`) as Codex's model and effort. `auto`, or a
 * name Codex does not offer, leaves the model to Codex (its default); an effort the model does not take is left out.
 * Each says so: a line for the record, or a note the person may be told — always told when they typed the name on the
 * upstream's card (`typed`, its `models`: HarnessV4_Tasks E9).
 * @param {string} modelId @param {string | null} effort @param {any[]} items @param {readonly string[]} [typed]
 * @returns {{ model: string | null, effort: string | null, notes: (string | Note)[] }}
 */
export function selectCodexModel(modelId, effort, items, typed = []) {
  /** @type {(string | Note)[]} */
  const notes = [];
  const list = (Array.isArray(items) ? items : []).filter((m) => m?.id && !m.hidden);
  const wanted = String(modelId || "").trim();
  const def = list.find((m) => m.isDefault) || null;
  /** @param {any} m @returns {string[]} */
  const effortsOf = (m) => (m?.supportedReasoningEfforts || []).map((/** @type {any} */ e) => String(e?.reasoningEffort || "")).filter(Boolean);
  /** The effort, when the model takes it. @param {any} m @param {string | null} e */
  const take = (m, e) => {
    if (!e || !m) return e || null;
    if (effortsOf(m).includes(e)) return e;
    const offers = effortsOf(m);
    notes.push({ kind: "effort-not-applied", effort: e, reason: offers.length ? `${m.id} offers ${offers.join("/")}` : `${m.id} has no effort setting` });
    return null;
  };
  /** @param {any} m @param {string | null} e */
  const say = (m, e) => `codex: model ${m.id}${e ? ` (effort ${e})` : ""}`;
  if (!wanted || /^(auto|default)$/i.test(wanted)) {
    const e = take(def, effort);
    notes.push(def ? `${say(def, e)}, Codex's default` : "codex: model Codex's default");
    return { model: null, effort: e, notes };
  }
  if (!list.length) {
    notes.push(`codex: model ${wanted} (model list unavailable; sent as is)`);
    return { model: wanted, effort: effort || null, notes };
  }
  const exact = list.find((m) => m.id === wanted || m.model === wanted);
  if (exact) {
    const e = take(exact, effort);
    notes.push(say(exact, e));
    return { model: String(exact.model || exact.id), effort: e, notes };
  }
  // `<model>-<effort>`: the longest model id the name begins with, and an effort that model takes.
  const base = list.filter((m) => wanted.startsWith(`${m.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
  const suffix = base ? wanted.slice(base.id.length + 1) : "";
  if (base && effortsOf(base).includes(suffix)) {
    notes.push(say(base, suffix));
    return { model: String(base.model || base.id), effort: suffix, notes };
  }
  const e = take(def, effort);
  // A typed name, whatever effort Filament left on the id (acp/negotiate.js `typedName`): named without it.
  const card = typedName(wanted, typed);
  notes.push({ kind: "model-not-offered", model: card ? wanted.slice(0, card.length) : wanted, offers: list.map((m) => String(m.id)), keeping: def ? String(def.id) : "Codex's default", ...(card ? { typed: true } : {}) });
  return { model: null, effort: e, notes };
}

/**
 * A failed turn's error, as an Error the failure reader sorts (acp/failures.js reads `data.errorKind`): Codex's own
 * kind (`codexErrorInfo`), a word or an object named by its one key.
 * @param {any} err
 */
export function codexError(err) {
  const info = err?.codexErrorInfo;
  const kind = typeof info === "string" ? info : info && typeof info === "object" ? Object.keys(info)[0] || "" : "";
  const details = typeof err?.additionalDetails === "string" ? err.additionalDetails.trim() : "";
  const words = String(err?.message || "Codex's turn failed");
  return Object.assign(new Error(details ? `${words}: ${details}` : words), { code: "CODEX_TURN", data: { errorKind: kind } });
}

/** A message of the client's history as an item of Codex's history. @param {{ role: string, text: string }} m */
const historyItem = (m) =>
  m.role === "assistant"
    ? { type: "message", role: "assistant", content: [{ type: "output_text", text: m.text }] }
    : { type: "message", role: "user", content: [{ type: "input_text", text: m.text }] };

export class CodexBridge extends TurnBridge {
  /** @param {{ log?: (level: string, msg: string) => void, stateFile?: string | null, profiles?: { put: (id: string, p: any) => void } | null }} [o] */
  constructor({ log = () => {}, stateFile = null, profiles = null } = {}) {
    super({ log });
    this.stateFile = stateFile;
    /** Where Codex's profile is kept, beside the ACP agents' (the ACP bridge's store). */
    this.profiles = profiles;
    /** @type {Map<string, CodexConv>} conversation key -> its thread */
    this.convs = new Map();
    /** @type {Map<string, CodexProcess>} upstream id -> its app-server */
    this.procs = new Map();
    /** @type {Map<string, CodexAccount>} upstream id -> its account, as Codex last said */
    this.accounts = new Map();
    /**
     * MCP token -> where Filament's tools stand, while a thread opens with it: Codex connects to its MCP servers as the
     * thread starts or resumes, before the thread is the chat's. `confined`: the opening turn's caller reaches its own
     * project's sessions alone; `by` and `space`, the sub-agent it is and a card without the Space; `held`, Codex's own
     * sub-agents off beside Filament's. @type {Map<string, { cwd: string, upstream: any, chain: string | null, graph: boolean, report: boolean, asksLead: string | null, team: boolean, reads?: boolean, launch: boolean, held?: boolean, visuals?: boolean, artifacts?: boolean, beside?: boolean, thread?: boolean, flow?: boolean, browser?: boolean, skills?: boolean, leftOut?: boolean, confined: boolean, by?: any, space?: boolean, at: number }>}
     */
    this.pendingMcp = new Map();
    /**
     * Upstream id -> the key of a reset credit being spent, kept until Codex says how it went: a second press after a
     * timeout is the same attempt, never a second credit. @type {Map<string, string>}
     */
    this.resetKeys = new Map();
    /**
     * Upstream id -> the ChatGPT sign-in under way in its app-server (HarnessV3-ACP AC3-7): Codex's id for it, the
     * app-server running it, and how its waiter is told it ended.
     * @type {Map<string, { loginId: string, proc: CodexProcess, end: (r: { ok: boolean, error: string | null }) => void }>}
     */
    this.logins = new Map();
    /** @type {Map<string, { at: number, items: any[], names: string[], labels: Record<string, import("../../../core/ports.js").ModelLabel> }>} */
    this.modelCache = new Map();
    /** The last 200 approval decisions, for the Agents page. @type {any[]} */
    this.permissionLog = [];
    /** The turns being read now. @type {Set<{ proc: CodexProcess, reader: ReturnType<typeof createCodexReader>, turn: LiveTurn }>} */
    this.readers = new Set();
    /** Fork thread -> its reader, while Codex writes Filament's summary in it (HarnessV3-ACP AC5-4). @type {Map<string, ReturnType<typeof createCodexReader>>} */
    this.summaries = new Map();
    /** The chats a summary is being written for: Filament's tools refuse their calls meanwhile (AC5-4). @type {Set<CodexConv>} */
    this.writing = new Set();
    /** A chat's thread -> what reads it while Codex compacts it, asked to (HarnessV3-ACP AC5-5). @type {Map<string, { read: (method: string, params: any) => void }>} */
    this.compacting = new Map();
    /** The archive's version of a chat, for seeding a new thread (the server's hook; null without memory). */
    /** @type {((args: any, opts: any) => any) | null} */
    this.archivedTranscript = null;
    /** Agent lifecycle as durable operations (the server's hook). @type {((title: string, opts?: any) => void) | null} */
    this.onOp = null;
    /**
     * Where Filament is reached (the server's hook, its `ownPlaces`): every port it listens on, this machine's names and
     * addresses, where Tailscale serves it. A provider of Codex's config at any of them is Filament's door
     * (`addsNothingAt`). Without it, only the address a turn was given Filament's own server at is known.
     * @type {(() => { ports: number[], names: string[], origins: string[] }) | null}
     */
    this.ownPlaces = null;
    /** @type {any} */
    this.saveTimer = null;
    this.#load();
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref?.();
  }

  #load() {
    if (!this.stateFile) return;
    try {
      const j = JSON.parse(readFileSync(this.stateFile, "utf8"));
      for (const [k, c] of Object.entries(j.conversations || {})) this.convs.set(k, /** @type {CodexConv} */ (c));
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") this.log("warn", `[codex] could not restore the thread map from ${this.stateFile} (${e.message}); every chat starts a new thread`);
    }
  }
  #save() {
    if (!this.stateFile) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.#write(), 300);
    this.saveTimer.unref?.();
  }
  /** Write the thread map now, a save still waiting with it. */
  #write() {
    clearTimeout(this.saveTimer);
    if (!this.stateFile) return;
    try {
      // Written beside the map, then put in its place: a write cut short leaves the map as it was, never torn.
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, conversations: Object.fromEntries([...this.convs].map(([k, c]) => [k, keptThread(c)])) }, null, 1));
      renameSync(tmp, this.stateFile);
    } catch (/** @type {any} */ e) {
      this.log("warn", `[codex] could not save the thread map: ${e.message}`);
    }
  }
  /** @param {string} title @param {any} [opts] */
  #op(title, opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break an agent turn */
    }
  }

  /**
   * The upstream's app-server, started on first use: its handshake, its profile kept, its account read. A turn asking
   * (`turn`) runs on it from now, before the handshake and its thread open, and keeps to it to its end, a second
   * attempt of it included, even once it is let go of (the bug report's H11). A turn waits for the handshake until
   * its stop (`signal`); anyone else is a probe and waits `PROBE_WAIT_MS` (HarnessV3-FailurePoints FP-D2).
   * @param {any} upstream @param {{ turn?: LiveTurn | null, signal?: AbortSignal | null }} [o] @returns {Promise<CodexProcess>}
   */
  async getProcess(upstream, { turn = null, signal = null } = {}) {
    const waiting = turn ? { waitMs: 0, signal } : { waitMs: PROBE_WAIT_MS };
    // A turn names the wait while Codex starts (HarnessV3-FailurePoints §5.1 item 2).
    /** @param {CodexProcess} proc */
    const starting = (proc) => {
      if (turn && !proc.initResult) turn.emit({ type: "step", step: "starting" });
    };
    if (turn?.proc && !turn.proc.exited) {
      starting(turn.proc);
      await turn.proc.initialize(waiting);
      return turn.proc;
    }
    const running = this.procs.get(upstream.id);
    if (running && !running.exited) {
      running.lastUsed = Date.now();
      if (turn) turn.proc = running;
      starting(running);
      await running.initialize(waiting); // a second caller waits for the handshake the first one started
      return running;
    }
    const acp = upstream.acp || {};
    const proc = new CodexProcess({
      command: acp.command || "codex",
      args: Array.isArray(acp.args) && acp.args.length ? acp.args : ["app-server"],
      env: agentLaunchEnv(upstream),
      envRemove: acp.envRemove,
      log: this.log,
    }).start();
    const key = `${upstream.id}|app-server`;
    this.procs.set(upstream.id, proc);
    if (turn) turn.proc = proc;
    starting(proc);
    this.latestAcp.set(upstream.id, acp);
    this.#serve(proc, upstream);
    proc.on("exit", (/** @type {any} */ info) => {
      if (this.procs.get(upstream.id) === proc) this.procs.delete(upstream.id);
      const login = this.logins.get(upstream.id);
      if (login?.proc === proc) {
        this.logins.delete(upstream.id);
        login.end({ ok: false, error: "Codex's app-server stopped before the sign-in finished" });
      }
      this.#op(`agent process ${key} exited (code ${info?.code ?? "?"}${info?.signal ? ", signal " + info.signal : ""})`, {
        sub: "exit",
        level: info?.code === 0 || info?.code == null ? "info" : "warn",
        detail: { key, code: info?.code ?? null, signal: info?.signal || null, stderrLines: proc.stderr.length },
        ref: { upstreamId: upstream.id },
      });
    });
    this.log("info", `[codex] started ${proc.spec.resolved} ${proc.spec.args.slice(-2).join(" ")}`);
    try {
      await proc.initialize(waiting);
    } catch (/** @type {any} */ e) {
      // A stop ended the turn's wait: the handshake goes on, for whoever comes next.
      if (signal?.aborted) throw e;
      proc.kill();
      if (this.procs.get(upstream.id) === proc) this.procs.delete(upstream.id);
      // A program that could not be run is an install to do; Codex that ran and stopped said why, in its own words.
      const unrun = !!proc.exitInfo && "error" in proc.exitInfo;
      throw Object.assign(
        new Error(
          unrun
            ? `Codex could not be run (${e.message}). Install it with \`npm install -g @openai/codex\`, or set the upstream's command, then try again.`
            : `Codex's app-server did not start: ${e.message}. Run \`codex app-server\` in a terminal to see its whole message.`,
        ),
        { code: "CODEX_START" },
      );
    }
    this.profiles?.put(upstream.id, codexProfile(proc.version));
    await this.#readAccount(upstream, proc).catch((e) => this.log("debug", `[codex] account/read: ${e.message}`));
    return proc;
  }

  /** The app-server's own requests, and its notifications to their turn. @param {CodexProcess} proc @param {any} upstream */
  #serve(proc, upstream) {
    for (const what of ASKS)
      proc.onRequest(
        what === "command" ? "item/commandExecution/requestApproval" : what === "file" ? "item/fileChange/requestApproval" : "item/permissions/requestApproval",
        (params, { signal }) => this.#approve(upstream, what, params || {}, signal),
      );
    proc.onRequest("item/tool/requestUserInput", (params, { signal }) => this.#question(upstream, params || {}, signal));
    proc.onRequest("mcpServer/elicitation/request", (params, { signal }) => this.#elicit(upstream, params || {}, signal));
    proc.on("notification", (/** @type {string} */ method, /** @type {any} */ params) => this.#hear(proc, upstream, method, params || {}));
  }

  /** @param {CodexProcess} proc @param {any} upstream @param {string} method @param {any} params */
  #hear(proc, upstream, method, params) {
    if (method === "account/rateLimits/updated") return this.#mergeLimits(upstream.id, params.rateLimits, false);
    if (method === "account/login/completed") return this.#loginEnded(upstream, proc, params);
    if (method === "account/updated") {
      this.#readAccount(upstream, proc).catch((e) => this.log("debug", `[codex] account/read: ${e.message}`));
      return;
    }
    const tid = String(params.threadId || params.thread?.id || "");
    if (!tid) return;
    // A fork writing Filament's summary (AC5-4), and any thread it starts, are the summary's own; a thread compacting
    // itself, asked to (AC5-5), its compaction's.
    for (const r of this.summaries.values()) if (r.owns(tid, params)) return r.read(method, params);
    const compacting = this.compacting.get(tid);
    if (compacting) return compacting.read(method, params);
    if (method === "thread/name/updated" && typeof params.threadName === "string" && params.threadName.trim())
      for (const c of this.convs.values()) if (c.sessionId === tid) c.title = params.threadName.trim().slice(0, 120);
    const here = [...this.readers].filter((r) => r.proc === proc);
    // The thread's own turn first, then the turn whose sub-agent it is. A thread nobody owns may be a sub-agent's whose
    // spawn call is not matched yet: the one turn waiting for one takes it, but never a chat's own thread, nor a thread
    // Codex says has no parent.
    const expecting = here.filter((r) => r.reader.expecting());
    const orphan = !proc.loaded.has(tid) && !(method === "thread/started" && !params.thread?.parentThreadId);
    const owner =
      here.find((r) => r.reader.threadId === tid) ||
      here.find((r) => r.reader.owns(tid, params)) ||
      (orphan && expecting.length === 1 ? expecting[0] : null);
    owner?.reader.read(method, params);
  }

  /**
   * A sign-in Codex says ended: the account is read again, then the sign-in's waiter is told how it went.
   * @param {any} upstream @param {CodexProcess} proc @param {any} params
   */
  #loginEnded(upstream, proc, params) {
    const read = this.#readAccount(upstream, proc).catch((e) => this.log("debug", `[codex] account/read: ${e.message}`));
    const l = this.logins.get(upstream.id);
    if (!l || l.proc !== proc || (params.loginId && params.loginId !== l.loginId)) return;
    this.logins.delete(upstream.id);
    const ok = params.success === true;
    void read.then(() => l.end({ ok, error: ok ? null : String(params.error || "the sign-in did not finish") }));
  }

  /** The live turn a thread's request is for: the thread's own, or the turn whose sub-agent the thread is. @param {string} threadId */
  #turnOf(threadId) {
    const own = this.turns.get(threadId);
    if (own && !own.done) return own;
    for (const r of this.readers) if (r.reader.owns(threadId, null)) return r.turn;
    return null;
  }

  /**
   * One of Codex's approvals: a command, a file change, more access, or an MCP server's tool (Codex's question before
   * it runs). In a harness session the session's switch
   * answers it (HarnessV3-ACP AC3-2): read as the loop's calls and judged as the loop judges its own, a yes is Codex's
   * allow-once — never its "for this chat", which would keep the grant in Codex instead of Filament. Plan mode reads
   * only, whatever the switch says. Otherwise the upstream's policy answers: under `ask` the person decides through the
   * client's question tool when the turn has one, and it is otherwise allowed once with a note; under a word that is
   * none of the policies the person decides the same way, and it is otherwise refused. A command or a change the answer
   * keeps from running ends saying why (the reader's `notRun`).
   * @param {any} upstream @param {(typeof ASKS)[number] | "mcp"} what @param {any} params @param {AbortSignal} signal
   */
  async #approve(upstream, what, params, signal) {
    const turn = /** @type {any} */ (this.#turnOf(String(params.threadId || "")));
    const policy = turn?.policy || this.policyOf(this.latestAcp.get(upstream.id) || upstream.acp || {}, upstream.id);
    const call = this.#askedFor(what, params);
    const agentName = String(upstream.name || upstream.id);
    const switched = !!turn?.permits && !turn.plan && !turn.done;
    // A fork writing Filament's summary (HarnessV3-ACP AC5-4) reads only: whatever it asks is refused.
    const writing = [...this.summaries.values()].some((r) => r.owns(String(params.threadId || ""), null));
    let allow = false;
    let how = policy;
    /** How a command or a change the answer keeps from running ends: the person's no declines it, a refusal refuses it
     *  (`why`: what refused it), and a question a stop or a hang-up left unanswered stops it with the turn.
     *  @type {{ how: "declined" | "refused" | "stopped", why: string } | null} */
    let kept = null;
    if (writing) {
      how = "refused: Codex writes Filament's summary, which reads only";
      kept = { how: "refused", why: "Filament, as Codex writes its summary" };
    } else if (switched) {
      const j = await this.judged(turn, this.#loopCallsOf(upstream, what, params), { agent: agentName, what: describeToolCall(call), call: params.itemId ? String(params.itemId) : null, signal });
      allow = j.outcome === "run";
      how = `the session's switch (${j.mode}): ${j.outcome}`;
      // A request Codex withdrew is Codex's to end.
      if (j.outcome === "refused" || j.outcome === "declined") kept = { how: j.outcome, why: j.outcome === "refused" ? String(j.why || "") : "" };
      else if (j.outcome === "cancelled" && !signal?.aborted) kept = { how: "stopped", why: "" };
    } else if (askingPolicy(policy) && turn && !turn.done && turn.bridge !== "off" && turn.clientTools.has("ask")) {
      const options = [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ];
      const question = `${agentName} wants to ${describeToolCall(call)}. Allow it?`;
      try {
        const id = await this.askClient(turn, {
          kind: "permission",
          call: turn.clientTools.buildAsk({ question, header: "Permission", options }),
          parse: (/** @type {string} */ t) => ClientToolset.parseAskAnswer(t, options, question, turn.clientTools.askShown(options)),
        });
        allow = id === "allow";
        how = id ? "asked the user" : "asked the user (no clear answer)";
        if (id === "reject") kept = { how: "declined", why: "" };
      } catch (/** @type {any} */ e) {
        how = `asked the user (${e.message})`;
      }
    } else {
      allow =
        policy === "allow-all" ||
        policy === "allow-once" ||
        policy === "ask" ||
        (policy === "read-only" && what === "command" && readsOnly(params.commandActions));
      if (!allow) kept = { how: "refused", why: turn?.plan ? "plan mode" : policyRefused(policy) };
      if (policy === "ask") {
        how = "ask (client has no question tool; allowed once)";
        if (turn && !turn.done) noteUnanswerable(turn);
      } else if (!isPolicy(policy)) how = `"${policy}", none of the policies: nobody to ask, refused`;
    }
    /** Codex's decision, in its own words. A question left unanswered declines it and stops the turn (Codex's `cancel`).
     *  A yes is Codex's once, under every policy, an MCP tool's elicitation too: its "for this session" would keep the
     *  grant in Codex, and a policy changed since would go unheard for what it covers. */
    const decision =
      what === "permissions"
        ? allow ? "granted" : "refused"
        : allow ? "accept" : kept?.how === "stopped" ? "cancel" : "decline";
    this.log("info", `[codex] approval (${how}) ${call.title} -> ${decision}`);
    this.permissionLog.push({ at: Date.now(), upstream: upstream.id, policy: how, title: call.title, kind: call.kind, decision });
    if (this.permissionLog.length > 200) this.permissionLog.shift();
    this.#op(`agent permission on ${upstream.id}: ${call.kind} → ${decision}`, {
      sub: "permission",
      detail: { upstream: upstream.id, policy: how, kind: call.kind, decision },
      ref: { upstreamId: upstream.id },
    });
    if (what === "mcp") return { action: decision, content: null };
    if (what !== "permissions") {
      // Said before the answer goes, so the item Codex ends as declined ends saying why.
      if (kept && params.itemId) this.#readerOf(String(params.threadId || ""))?.notRun(String(params.itemId), kept.how, kept.why);
      return { decision };
    }
    const p = params.permissions || {};
    if (decision === "refused") return { permissions: {}, scope: "turn" };
    return { permissions: { network: p.network ?? null, fileSystem: p.fileSystem ?? null }, scope: "turn" };
  }

  /** The reader of the turn a thread's notifications go to: its own, or the turn whose sub-agent it is. @param {string} threadId */
  #readerOf(threadId) {
    return [...this.readers].find((r) => r.reader.owns(threadId, null))?.reader || null;
  }

  /**
   * What one of Codex's approvals asks to do, as the loop's calls the session's switch judges (HarnessV3-ACP AC3-2): a
   * command is `bash` — or `powershell`, with the script alone, the program Codex names and the folder it runs in,
   * where Codex wraps it in PowerShell (`powershellCommand`) — and the network a running command wants to reach
   * `web_fetch`; a file change writes each of its
   * files (`write` a new one, `edit` any other); input to a running command, and more access than the sandbox gives,
   * are judged as an MCP call is, as Codex's own tools (`mcp__codex__permissions`); an MCP server's tool as itself.
   * @param {any} upstream @param {(typeof ASKS)[number] | "mcp"} what @param {any} params
   * @returns {import("../turn-bridge.js").LoopCall[]}
   */
  #loopCallsOf(upstream, what, params) {
    if (what === "mcp") {
      const { server, tool, input } = mcpToolAsked(params);
      return [{ name: `mcp__${server}__${tool}`, input }];
    }
    const own = (/** @type {string} */ tool, /** @type {any} */ input) => [{ name: `mcp__${upstream.id}__${tool}`, input }];
    if (what === "command") {
      const command = String(params.command || "");
      if (params.kind === "writeStdin") return own("write_stdin", { input: command });
      const net = params.networkApprovalContext;
      if (net?.host) return [{ name: "web_fetch", input: { url: `${String(net.protocol || "https").replace(/^socks5.*/, "socks5")}://${net.host}` } }];
      const ps = powershellCommand(command);
      if (ps) return [{ name: "powershell", input: { command: ps.script, program: ps.program, ...(params.cwd ? { cwd: String(params.cwd) } : {}) } }];
      return [{ name: "bash", input: { command } }];
    }
    if (what === "file") {
      const files = this.#readerOf(String(params.threadId || ""))?.itemOf(String(params.itemId || ""))?.files || [];
      return files.length ? files.map((f) => ({ name: f.tool, input: f.input })) : [{ name: "edit", input: { path: String(params.grantRoot || "") } }];
    }
    return own("permissions", { ...(params.permissions || {}), ...(params.reason ? { reason: String(params.reason) } : {}) });
  }

  /** What an approval is for, as a call a question can name. @param {(typeof ASKS)[number] | "mcp"} what @param {any} params */
  #askedFor(what, params) {
    if (what === "command") return { kind: "execute", title: String(params.command || params.reason || "a command") };
    if (what === "mcp") {
      const { server, tool } = mcpToolAsked(params);
      return { kind: "other", title: `run ${tool} from the ${server} MCP server` };
    }
    if (what === "file") {
      const files = this.#readerOf(String(params.threadId || ""))?.itemOf(String(params.itemId || ""))?.files || [];
      return { kind: "edit", title: files.map((f) => f.path).filter(Boolean).join(", ") || String(params.grantRoot || "files") };
    }
    const p = params.permissions || {};
    const fs = p.fileSystem || {};
    const wants = [
      p.network?.enabled ? "reach the network" : "",
      (fs.write || []).length ? `write to ${fs.write.join(", ")}` : "",
      (fs.read || []).length ? `read ${fs.read.join(", ")}` : "",
    ].filter(Boolean);
    return { kind: "other", title: wants.join(" and ") || `have more access${params.reason ? ` (${params.reason})` : ""}` };
  }

  /**
   * A question Codex asks the person (`requestUserInput`; HarnessV3-ACP AC2-4), answered by the chosen labels and the
   * person's words, each by its question's id. One with nothing to ask is skipped at once, with a note.
   * @param {any} upstream @param {any} params @param {AbortSignal} signal
   */
  async #question(upstream, params, signal) {
    const turn = this.#turnOf(String(params.threadId || ""));
    const form = fromCodexQuestion(params, { agent: String(upstream.name || upstream.id) });
    if (typeof form !== "string") return toCodexQuestion(form, await this.askPerson(turn, form, { signal }));
    this.unaskable(turn, "a question", form, "Skipped");
    return { answers: {} };
  }

  /**
   * An MCP server's elicitation Codex relays (HarnessV3-ACP AC2-4): its form, or a link to open, put to the person,
   * with the server that asks beside it. Codex says nothing when a link completes: the person's answer settles it.
   * Codex's own question before an MCP server's tool runs comes this way too, as a form that asks nothing: it is one of
   * Codex's approvals, answered as the others are (AC4's drive).
   * @param {any} upstream @param {any} params @param {AbortSignal} signal
   */
  async #elicit(upstream, params, signal) {
    if (params._meta?.codex_approval_kind === "mcp_tool_call") return this.#approve(upstream, "mcp", params, signal);
    const turn = this.#turnOf(String(params.threadId || ""));
    const server = String(params.serverName || "an MCP server");
    const form = fromElicitation(params, { agent: String(upstream.name || upstream.id) });
    if (typeof form === "string") {
      this.unaskable(turn, String(params.message || `a question from ${server}`), form, "Declined");
      return { action: "decline", content: null };
    }
    form.detail = `asked by its MCP server “${server}”`;
    const a = toElicitation(form, await this.askPerson(turn, form, { signal }));
    return { action: a.action, content: a.content ?? null };
  }

  /**
   * What Codex says of its account now, and its plan once signed in: its windows, credits and reset credits, read
   * whole. @param {any} upstream @param {CodexProcess} proc
   */
  async #readAccount(upstream, proc) {
    const r = await proc.request("account/read", { refreshToken: false }, 15000);
    const prev = this.accounts.get(upstream.id);
    const identity = codexIdentity(r?.account || null, r?.requiresOpenaiAuth === true);
    // What was said of the plan is this account's while it is the same one (a read of it that fails keeps it);
    // another account's is not.
    const same = sameIdentity(prev?.identity, identity);
    /** @type {CodexAccount} */
    const a = {
      identity,
      windows: same ? prev?.windows || [] : [],
      credits: same ? (prev?.credits ?? null) : null,
      resetCredits: same ? (prev?.resetCredits ?? null) : null,
      reached: same ? (prev?.reached ?? null) : null,
      at: Date.now(),
    };
    this.accounts.set(upstream.id, a);
    this.heardAccount(upstream.id, {
      source: "account/read",
      identity,
      noWindows:
        identity.kind === "api-key"
          ? "An OpenAI API key has no plan windows: it is billed by the token"
          : identity.kind === "external"
            ? `${identity.label} has no plan windows`
            : null,
    });
    if (identity.kind === "account") await this.#readLimits(upstream, proc);
    return a;
  }

  /** The plan read whole: a reading that fails keeps what was said. @param {any} upstream @param {CodexProcess} proc */
  async #readLimits(upstream, proc) {
    try {
      const read = await proc.request("account/rateLimits/read", undefined, 15000);
      this.#mergeLimits(upstream.id, codexMain(read), true, codexResetCredits(read?.rateLimitResetCredits));
    } catch (/** @type {any} */ e) {
      this.log("debug", `[codex] account/rateLimits/read: ${e.message}`);
    }
  }

  /**
   * A reading of the plan, merged: a whole one (`account/rateLimits/read`) or Codex's sparse update, whose missing
   * fields keep what was known. Another allowance's (a model's own) is not the plan's.
   * @param {string} upstreamId @param {any} rl @param {boolean} whole
   * @param {import("../../../core/agent-limits.js").ResetCredits | null} [resetCredits]
   */
  #mergeLimits(upstreamId, rl, whole, resetCredits = null) {
    const a = this.accounts.get(upstreamId);
    if (!a || !rl || typeof rl !== "object" || (rl.limitId && rl.limitId !== "codex")) return;
    const windows = codexWindows(rl);
    a.windows = mergeWindows(a.windows, windows);
    const credits = codexCredits(rl);
    if (credits) a.credits = credits;
    if (resetCredits) a.resetCredits = resetCredits;
    // Why the plan stopped: a whole reading says it, or that it hasn't; an update that leaves it out says nothing.
    const reached = rl.rateLimitReachedType ? String(rl.rateLimitReachedType) : whole ? null : undefined;
    if (reached !== undefined) a.reached = reached;
    if (rl.planType && a.identity.kind === "account") a.identity = codexIdentity({ type: "chatgpt", email: a.identity.email, planType: rl.planType }, true);
    a.at = Date.now();
    this.heardAccount(upstreamId, {
      source: whole ? "account/rateLimits/read" : "account/rateLimits/updated",
      identity: a.identity,
      windows,
      credits,
      resetCredits,
      ...(reached !== undefined ? { reached } : {}),
    });
  }

  /** The account as a turn's record keeps it, or null when Codex has not said or nobody is signed in. @param {string} upstreamId */
  #accountRecord(upstreamId) {
    const a = this.accounts.get(upstreamId);
    if (!a || a.identity.kind === "none") return null;
    return accountRecord(a.identity, a.windows, a.at, { credits: a.credits, resetCredits: a.resetCredits, reached: a.reached });
  }

  /**
   * Codex's account before a turn: read again when it was signed out (a sign-in in a terminal since counts), and a
   * turn refused in words while it still is. A plan that stopped, or a window that was spent, is read again too: its
   * reset may have come. @param {any} upstream @param {CodexProcess} proc
   */
  async #signedIn(upstream, proc) {
    const was = this.accounts.get(upstream.id);
    const a = was && was.identity.kind !== "none" ? was : await this.#readAccount(upstream, proc);
    if (a === was && a.identity.kind === "account" && (a.reached || a.windows.some((w) => (w.usedPercent ?? 0) >= 100))) await this.#readLimits(upstream, proc);
    if (a.identity.kind === "none")
      throw Object.assign(
        new Error(`${agentTitle(upstream)} is not signed in. ${signInAdvice(upstream, process.platform)}, then send your message again.`),
        { code: "CODEX_AUTH", data: { errorKind: "unauthorized" } },
      );
    return a;
  }

  /** @param {any} upstream @param {{ force?: boolean }} [o] */
  async listModels(upstream, { force = false } = {}) {
    const c = this.modelCache.get(upstream.id);
    if (c && !force && Date.now() - c.at < MODELS_TTL) return { names: c.names, items: c.items, labels: c.labels, source: "cache" };
    const proc = await this.getProcess(upstream);
    /** @type {any[]} */
    const items = [];
    /** @type {string | null} */
    let cursor = null;
    for (let page = 0; page < 5; page++) {
      const r = await proc.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }, 30000);
      items.push(...(Array.isArray(r?.data) ? r.data : []));
      cursor = r?.nextCursor || null;
      if (!cursor) break;
    }
    const names = expandCodexModels(items);
    const labels = modelLabels(items);
    this.modelCache.set(upstream.id, { at: Date.now(), items, names, labels });
    return { names, items, labels, source: "model/list" };
  }

  /** The threads Codex knows, newest first, its sub-agents' left out. @param {any} upstream */
  async listSessions(upstream) {
    try {
      const proc = await this.getProcess(upstream);
      const r = await proc.request("thread/list", { limit: 50 }, 30000);
      const sessions = (Array.isArray(r?.data) ? r.data : [])
        .filter((/** @type {any} */ t) => t?.id && !t.parentThreadId)
        .map((/** @type {any} */ t) => ({
          sessionId: String(t.id),
          cwd: t.cwd || null,
          title: t.name || t.preview || null,
          updatedAt: t.updatedAt || t.createdAt ? new Date(Number(t.updatedAt || t.createdAt) * 1000).toISOString() : null,
        }));
      return { ok: true, sessions };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: e.message, sessions: [] };
    }
  }

  /**
   * A chat set to a thread Codex already has (`/resume`): resumed at its next turn, standing on the chat's newest
   * compaction as the command's request names it (AC5-1).
   * @param {any} args
   */
  async attach({ upstream, format, body, cwdHint, conversationId, sessionId, headers = {} }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    const l = await this.listSessions(upstream);
    if (!l.ok) return { ok: false, error: l.error };
    const { found, candidates } = findSession(l.sessions, sessionId);
    if (!found)
      return {
        ok: false,
        error:
          candidates.length > 1
            ? `"${sessionId}" matches ${candidates.length} Codex threads; use more of the id or title`
            : `no Codex thread matches "${sessionId}" (${l.sessions.length} known; /sessions lists them)`,
      };
    this.convs.set(conversationKey(upstream.id, cwd, flat, conversationId), this.#newConv(upstream, found.sessionId, found.cwd || cwd, found.title, compactionOf(headers, upstream.id) ?? 0));
    this.#save();
    return { ok: true, session: found, cwd: found.cwd || cwd };
  }

  /**
   * @param {any} upstream @param {string} threadId @param {string} cwd @param {string | null} title
   * @param {number} basedOn  the chat's compaction the thread stands on (AC5-1)
   * @returns {CodexConv}
   */
  #newConv(upstream, threadId, cwd, title, basedOn) {
    return {
      sessionId: threadId,
      upstreamId: upstream.id,
      cwd,
      turns: 0,
      lastUsed: Date.now(),
      idleMs: Math.max(1, Number(upstream.acp?.sessionIdleMinutes) || 240) * 60000,
      modelId: null,
      mode: "agent",
      title: title || null,
      seenUserTurns: null,
      policy: null,
      basedOn,
    };
  }

  /** @param {any} upstream */
  async offer(upstream) {
    try {
      const m = await this.listModels(upstream);
      const efforts = [...new Set(m.items.flatMap((/** @type {any} */ i) => (i.supportedReasoningEfforts || []).map((/** @type {any} */ e) => String(e?.reasoningEffort || ""))))].filter(Boolean);
      const proc = this.procs.get(upstream.id);
      return { ok: true, profile: codexProfile(proc?.version || ""), commands: [], models: m.names, currentModel: null, modes: ["agent", "plan"], efforts, params: [] };
    } catch (/** @type {any} */ e) {
      return { ok: false, error: e.message, commands: [], models: [], modes: ["agent", "plan"], efforts: [] };
    }
  }

  /** The connection test: Codex starts, says its account, lists its models. @param {any} upstream */
  async test(upstream) {
    const t0 = Date.now();
    try {
      const proc = await this.getProcess(upstream);
      const a = await this.#readAccount(upstream, proc);
      const m = await this.listModels(upstream, { force: true });
      return {
        ok: true,
        ms: Date.now() - t0,
        command: proc.spec.resolved,
        agent: { name: "codex", version: proc.version },
        profile: codexProfile(proc.version),
        signedIn: a.identity.kind !== "none",
        auth:
          a.identity.kind === "none"
            ? `not signed in. ${signInAdvice(upstream, process.platform)}`
            : `${a.identity.label}${a.identity.email || a.identity.detail ? ` (${a.identity.email || a.identity.detail})` : ""}`,
        modes: ["agent", "plan"],
        currentModel: m.items.find((/** @type {any} */ i) => i.isDefault)?.id || null,
        models: m.items.length,
        sample: m.items.slice(0, 12).map((/** @type {any} */ i) => i.id).join(", "),
        efforts: [...new Set(m.items.flatMap((/** @type {any} */ i) => (i.supportedReasoningEfforts || []).map((/** @type {any} */ e) => e?.reasoningEffort)))].filter(Boolean),
        cwd: determineCwd(upstream.acp || {}, [], null).cwd,
      };
    } catch (/** @type {any} */ e) {
      return { ok: false, ms: Date.now() - t0, error: e.message, code: e.code };
    }
  }

  /** Codex's account and its plan read afresh, at the person's word (*Check now*). @param {any} upstream */
  async checkAccount(upstream) {
    await this.#readAccount(upstream, await this.getProcess(upstream));
  }

  /**
   * One of the account's reset credits spent, at the person's word (HarnessV3-ACP AC3-6): Codex resets the plan's
   * spent windows, which are then read again. The attempt keeps its key until Codex answers, so pressing again after
   * a timeout never spends a second credit. Resolves with Codex's word: `reset`, `nothingToReset`, `noCredit` or
   * `alreadyRedeemed`.
   * @param {any} upstream
   * @returns {Promise<string>}
   */
  async useResetCredit(upstream) {
    const proc = await this.getProcess(upstream);
    const key = this.resetKeys.get(upstream.id) || randomUUID();
    this.resetKeys.set(upstream.id, key);
    const r = await proc.request("account/rateLimitResetCredit/consume", { idempotencyKey: key }, 20000);
    this.resetKeys.delete(upstream.id);
    this.#op(`a reset credit asked for on ${upstream.id}: ${r?.outcome}`, {
      sub: "reset-credit",
      level: r?.outcome === "reset" ? "info" : "warn",
      detail: { outcome: r?.outcome },
      ref: { upstreamId: upstream.id },
    });
    await this.#readAccount(upstream, proc).catch((e) => this.log("debug", `[codex] account/read: ${e.message}`));
    return String(r?.outcome || "");
  }

  /** Codex's ways to sign in, each through its app-server (HarnessV3-ACP AC3-7). */
  async signInWays() {
    return CODEX_WAYS;
  }
  /** Codex signs out of its own (`account/logout`). */
  signsOut() {
    return true;
  }
  /**
   * Codex's own ChatGPT sign-in, in the account's app-server (HarnessV3-ACP AC3-7): `account/login/start` names the
   * page to open — or, `chatgpt-code`, a page and a code to type there, for a browser on another computer, which the
   * first page's return to this one can't reach — and `account/login/completed` ends it. One sign-in an account at a
   * time: a new one takes the last one's place. Where its app-server can't start, the error names `codex login` to run
   * in a terminal instead. An OpenAI API key (`api-key`) goes to `account/login/start` alone, which signs Codex in at
   * once and keeps the key in its CODEX_HOME; the account is read then, and nothing waits: no page, nothing kept here.
   * @param {any} upstream @param {{ way?: string, key?: string }} [o]
   * @returns {Promise<{ url: string | null, code: string | null, done: Promise<{ ok: boolean, error: string | null }> }>}
   *   `done`: how it ended; no error and not signed in is a sign-in cancelled
   */
  async signIn(upstream, { way = "chatgpt", key = "" } = {}) {
    const device = way === "chatgpt-code";
    const withKey = way === "api-key";
    const proc = await this.getProcess(upstream).catch((/** @type {any} */ e) => {
      // `codex login` in a terminal signs in on ChatGPT's page: no way for a key pasted here.
      throw e.code === "CODEX_START" && !withKey ? Object.assign(e, { instead: codexLogin(upstream) }) : e;
    });
    await this.cancelSignIn(upstream);
    if (withKey) {
      if (!key) throw new Error("no key given: paste the OpenAI API key to sign Codex in with");
      await proc.request("account/login/start", { type: "apiKey", apiKey: key }, 30000);
      await this.#readAccount(upstream, proc).catch((e) => this.log("debug", `[codex] account/read: ${e.message}`));
      return { url: null, code: null, done: Promise.resolve({ ok: true, error: null }) };
    }
    const r = await proc.request("account/login/start", { type: device ? "chatgptDeviceCode" : "chatgpt" }, 30000);
    const url = String((device ? r?.verificationUrl : r?.authUrl) || "");
    const loginId = String(r?.loginId || "");
    if (!url || !loginId) throw new Error(`Codex started no sign-in (account/login/start answered without ${device ? "its page and code" : "its page"})`);
    /** @type {(r: { ok: boolean, error: string | null }) => void} */
    let end = () => {};
    /** @type {Promise<{ ok: boolean, error: string | null }>} */
    const done = new Promise((res) => (end = res));
    this.logins.set(upstream.id, { loginId, proc, end });
    return { url, code: device ? String(r?.userCode || "") || null : null, done };
  }

  /** The sign-in under way stopped at the person's word. @param {any} upstream @returns {Promise<boolean>} */
  async cancelSignIn(upstream) {
    const l = this.logins.get(upstream.id);
    if (!l) return false;
    this.logins.delete(upstream.id);
    if (!l.proc.exited)
      await l.proc.request("account/login/cancel", { loginId: l.loginId }, 15000).catch((e) => this.log("debug", `[codex] account/login/cancel: ${e.message}`));
    l.end({ ok: false, error: null });
    return true;
  }

  /** Codex signed out of its account (`account/logout`). @param {any} upstream */
  async signOut(upstream) {
    const proc = await this.getProcess(upstream);
    await proc.request("account/logout", undefined, 30000);
  }

  /**
   * The upstream's app-server let go of (HarnessV3-ACP AC3-7): a sign-in made outside it (`codex login` in a
   * terminal) is read by the next one. One with a turn running ends when its turns do; its threads load again in the
   * next.
   * @param {string} upstreamId
   */
  letGo(upstreamId) {
    const p = this.procs.get(upstreamId);
    if (!p) return;
    this.procs.delete(upstreamId);
    if (this.runsOn(p)) p.retire = true;
    else p.kill();
  }

  /** What is known about an upstream's Codex: its version, the account it runs on. @param {string} upstreamId */
  processInfo(upstreamId) {
    const p = this.procs.get(upstreamId);
    const a = this.accounts.get(upstreamId);
    if (!p && !a) return null;
    return {
      agent: p ? { name: "codex", title: "Codex", version: p.version } : null,
      identity: a?.identity ?? null,
      processes: p && !p.exited ? 1 : 0,
      pid: p?.child?.pid ?? null,
      models: [],
    };
  }

  status() {
    const now = Date.now();
    return {
      permissions: this.permissionLog.slice(-50).reverse(),
      processes: [...this.procs.entries()].map(([id, p]) => ({
        key: `${id}|app-server`,
        command: p.spec.resolved,
        args: p.spec.args.slice(-4),
        pid: p.child?.pid,
        startedAt: p.startedAt,
        idleMs: now - p.lastUsed,
        exited: p.exited,
        stderr: p.stderr.slice(-8).map((l) => String(l).trim().slice(0, 300)),
      })),
      conversations: [...this.convs.entries()].map(([key, c]) => {
        const t = this.turns.get(c.sessionId);
        return {
          key,
          sessionId: c.sessionId,
          upstreamId: c.upstreamId,
          cwd: c.cwd,
          turns: c.turns,
          idleMs: now - c.lastUsed,
          modelId: c.modelId,
          mode: c.mode,
          title: c.title || null,
          commands: [],
          live: !!this.procs.get(c.upstreamId)?.loaded.has(c.sessionId),
          bridge: t?.bridgeEffective || null,
          bridgeConfigured: t?.bridge || null,
          bridgeNote: null,
          steering: false,
          clientTools: t?.clientTools?.summary?.() || null,
        };
      }),
      turns: [...this.turns.values()].map((t) => t.describe()),
    };
  }

  /** @param {string} key */
  killProcess(key) {
    const id = String(key).replace(/\|app-server$/, "");
    const p = this.procs.get(id);
    if (!p || key !== `${id}|app-server`) return false;
    p.kill();
    this.procs.delete(id);
    this.#op(`agent process ${key} was killed from the console`, { sub: "kill", level: "warn", detail: { key }, ref: { upstreamId: id } });
    return true;
  }

  /**
   * Let go of a chat's thread in the app-server that has it loaded, unless another chat still holds it. One Filament
   * made — the fork Codex's own compaction kept for Undo (AC5-5), never loaded — is deleted where Codex deletes one.
   * Settled once Codex answered, or at once where there is nothing to let go of.
   * @param {CodexConv} c @returns {Promise<void>}
   */
  #unload(c) {
    if (c.made) return this.#dropMade(c);
    const p = this.procs.get(c.upstreamId);
    if (!p || p.exited || !p.loaded.has(c.sessionId)) return Promise.resolve();
    for (const other of this.convs.values()) if (other !== c && other.sessionId === c.sessionId) return Promise.resolve();
    p.loaded.delete(c.sessionId);
    p.opened.delete(c.sessionId);
    return p.request("thread/unsubscribe", { threadId: c.sessionId }, 15000).then(
      () => {},
      (/** @type {any} */ e) => this.log("debug", `[codex] thread/unsubscribe ${short(c.sessionId)}: ${e.message}`),
    );
  }
  /**
   * A thread Filament made, let go of: deleted, where Codex deletes one, through the app-server that holds it — the
   * upstream's, or one let go of under the compaction that made it. Settled once Codex answered, or at once.
   * @param {CodexConv} c @param {any} [p]
   */
  #dropMade(c, p = this.procs.get(c.upstreamId)) {
    if (!p || p.exited || !codexProfile(p.version).sessions.delete) return Promise.resolve();
    return p.request("thread/delete", { threadId: c.sessionId }, 15000).then(
      () =>
        this.#op(`deleted the thread kept from before Codex's own compaction, on ${c.upstreamId} (${short(c.sessionId)})`, {
          sub: "delete",
          detail: { upstream: c.upstreamId, method: "thread/delete", sessionId: c.sessionId },
          ref: { upstreamId: c.upstreamId, sessionId: c.sessionId },
        }),
      (/** @type {any} */ e) => this.log("debug", `[codex] thread/delete ${short(c.sessionId)}: ${e.message}`),
    );
  }
  /** @param {string} key */
  forgetConversation(key) {
    const c = this.convs.get(key);
    if (!c) return false;
    this.convs.delete(key);
    this.#save();
    this.#unload(c);
    return true;
  }
  /** @param {any} args */
  peekByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    return this.convs.get(conversationKey(upstream.id, cwd, flat, conversationId)) || null;
  }
  /** @param {any} args */
  forgetByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    return this.forgetConversation(conversationKey(upstream.id, cwd, flat, conversationId));
  }
  /**
   * A chat whose job is over for now (a sub-agent's exchange): Codex unloads its thread, so nothing of Codex's stands
   * in the chat's folder, and the chat keeps the thread, which its next message resumes. Settled once Codex answered.
   * @param {any} args
   */
  async restByRequest(args) {
    const c = this.peekByRequest(args);
    if (c && !c.made) await this.#unload(c);
  }

  /**
   * Chats idle past their limit let go of their threads (`idleStep`): an outside client's is dropped, a harness chat's
   * keeps its thread, which its next message opens again. An app-server idle 90 minutes with no recent chat closes.
   */
  sweep(now = Date.now()) {
    let dropped = 0;
    for (const [k, c] of this.convs) {
      const step = idleStep(c, now, this.inUse(k));
      if (step === "drop") {
        this.convs.delete(k);
        this.#unload(c);
        this.#op(...idleDropOp(c, now));
        dropped++;
      } else if (step === "rest" && !c.made) this.#unload(c);
    }
    if (dropped) this.#save();
    for (const [tok, p] of this.pendingMcp) if (now - p.at > 30 * 60_000) this.pendingMcp.delete(tok);
    // Codex's process stops once it has gone 90 minutes unasked and none of its chats has work queued or running, or
    // was used in the last 30.
    for (const [id, p] of this.procs)
      if (
        now - p.lastUsed > 90 * 60_000 &&
        ![...this.convs].some(([k, c]) => c.upstreamId === id && (this.inUse(k) || now - c.lastUsed < 30 * 60_000))
      ) {
        p.kill();
        this.procs.delete(id);
      }
    this.sweepTurns(now);
    return dropped;
  }
  shutdown() {
    clearInterval(this.timer);
    // The map is written as it stands, the chats with work running used until now: a save still waiting would end with
    // the process (the bug report's H10).
    this.usedUntilNow(this.convs);
    this.#write();
    for (const p of this.procs.values()) p.kill();
    this.procs.clear();
    this.stopLetGo();
  }

  /** Resolves with the finished turn, or with { clientAction, turn } when the turn needs the client's hands first. @param {any} opts */
  async run(opts) {
    const acp = opts.upstream.acp || {};
    const flat = flattenMessages(opts.format, opts.body);
    const { cwd } = determineCwd(acp, flat, opts.cwdHint);
    const convKey = conversationKey(opts.upstream.id, cwd, flat, opts.conversationId);
    const turn = new LiveTurn({
      convKey,
      upstreamId: opts.upstream.id,
      clientTools: opts.clientTools || ClientToolset.from(opts.format, opts.body),
      bridge: acp.clientBridge || "prompts",
      onEvent: opts.onEvent || (() => {}),
      log: this.log,
      clientWaitMs: Math.max(1, Number(acp.clientWaitMinutes) || 60) * 60000,
      asker: opts.asker || null,
      permits: opts.permits || null,
      toolsAt: opts.toolsAt || null,
      asks: opts.asks || null,
    });
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const at = { flat, convKey, cwd, turn };
    const mine = prev
      .catch(() => {})
      .then(() => this.#runTurn(opts, at))
      .catch((e) =>
        this.retrySeed(e, opts, turn, {
          session: "thread",
          drop: () => {
            const conv = this.convs.get(convKey);
            if (!conv) return;
            this.convs.delete(convKey);
            this.#save();
            this.#unload(conv);
          },
          again: (o) => this.#runTurn({ ...opts, ...o }, "body" in o ? { ...at, flat: flattenMessages(opts.format, o.body) } : at),
        }),
      );
    this.turnQueues.set(convKey, mine);
    return this.trackTurn(turn, mine, () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    });
  }

  /**
   * Whether the bridge keeps a thread for a harness chat (HarnessV4_Tasks C26): the one the chat's next turn goes on
   * in, open in the app-server or resumed by its id. False where it keeps none — the chat never ran on Codex, its
   * record is gone, or the chat was compacted under it since (`base`) — so that turn starts a new thread, seeded from
   * the harness's composition of the chat.
   * @param {import("../../../core/ports.js").AgentChat} where
   */
  holds(where) {
    const conv = this.convs.get(this.#chatKey(where));
    return !!conv && !conv.fresh && moveFor(conv, where.base ?? null).move !== "fresh";
  }
  /**
   * How Codex can write Filament's summary of a harness chat (HarnessV3-ACP AC5-4): in a fork of the chat's thread, as
   * its app-server holds it open — the thread itself stays as it was, for Undo. Null with no such thread: nothing warm
   * to write from.
   * @param {import("../../../core/ports.js").AgentChat} where
   * @returns {"fork" | null}
   */
  summarizes(where) {
    const conv = this.convs.get(this.#chatKey(where));
    if (!conv || !this.#ownAt(conv, where.upstream) || moveFor(conv, where.base ?? null).move !== "stay") return null;
    return codexProfile(this.#versionAt(where.upstream)).sessions.fork ? "fork" : null;
  }
  /**
   * Whether a way of Codex's own resumes the chat's thread first (HarnessV4_Tasks C33): no app-server holds it now —
   * Filament restarted, or the idle one was let go — and its record says how it was opened.
   * @param {import("../../../core/ports.js").AgentChat} where
   */
  closed(where) {
    const conv = this.convs.get(this.#chatKey(where));
    return !!conv && this.#ownAt(conv, where.upstream) === "closed" && moveFor(conv, where.base ?? null).move === "stay";
  }
  /** The app-server's version where one runs, else none: the profile of the schema Filament speaks. @param {any} upstream */
  #versionAt(upstream) {
    const proc = this.procs.get(upstream.id);
    return proc && !proc.exited ? proc.version || "" : "";
  }
  /**
   * Where the chat's thread stands for a way of Codex's own: "open" in the app-server, "closed" where none holds it
   * and its record keeps what it was opened with (`opened`) — resumed first then (`#openAgain`) — else null.
   * @param {any} conv @param {any} upstream @returns {"open" | "closed" | null}
   */
  #ownAt(conv, upstream) {
    const proc = this.procs.get(upstream.id);
    if (proc && !proc.exited && proc.opened.has(conv.sessionId)) return "open";
    return conv.opened && !conv.fresh ? "closed" : null;
  }
  /**
   * The chat's thread resumed in the app-server, started where none runs, with what it was last opened with: as a turn
   * resumes it, outside one. A stop ends the wait; a thread Codex no longer has fails in its words.
   * @param {any} upstream @param {any} conv @param {AbortSignal | null} signal
   */
  async #openAgain(upstream, conv, signal) {
    const proc = await this.getProcess(upstream, { signal });
    if (proc.opened.has(conv.sessionId)) return proc;
    const release = await this.lockSession(conv.sessionId, signal);
    try {
      if (signal?.aborted) throw new Error("stopped before the thread was opened");
      // What the record on disk leaves out (`keptThread`) is given again: the upstream's own servers as the
      // configuration holds them now, where it names none of theirs, ahead of the rest as a turn's open gives them;
      // and Filament's own server a new token, which the thread holds from then on — its next turn goes on there. Another
      // machine's agents' chat's is given none of its upstream's, and those of the person's own Codex config off again.
      // Filament's ask to add nothing goes to the providers whose address is Filament's door as the person's config holds
      // them now (`addsNothingAt`): at Filament's places, else — no server told them — at the address its own server was
      // given at, and to none where it was given none.
      const held = Object.fromEntries(Object.entries(conv.opened?.config || {}).filter(([k]) => !askKey(k)));
      const upstreamServers = conv.fenced
        ? theirsOff(upstream, !!held[OWN_SERVER])
        : codexServers(serversFor(upstream.acp || {}, [], { title: agentTitle(upstream), http: true, cwd: true }).servers);
      const own = held[OWN_SERVER];
      const again = typeof own?.url === "string" ? addressGiven(own.url) : null;
      if (again) conv.mcpToken = again.token;
      const { asks } = addsNothingAt(upstream, filamentsDoor(this.ownPlaces, typeof own?.url === "string" ? own.url : null));
      conv.opened = {
        ...conv.opened,
        config: { ...Object.fromEntries(Object.entries(upstreamServers).filter(([k]) => !(k in held))), ...held, ...asks, ...(again ? { [OWN_SERVER]: { ...own, url: again.url } } : {}) },
      };
      await proc.request("thread/resume", { threadId: conv.sessionId, cwd: conv.cwd, excludeTurns: true, ...conv.opened }, 0, signal);
      proc.loaded.add(conv.sessionId);
      proc.opened.set(conv.sessionId, conv.opened);
      this.#op(`resumed a Codex thread on ${upstream.id} (${short(conv.sessionId)})`, {
        sub: "resume",
        detail: { upstream: upstream.id, method: "thread/resume", sessionId: conv.sessionId },
        ref: { upstreamId: upstream.id, sessionId: conv.sessionId },
      });
    } finally {
      release();
    }
    return proc;
  }
  /** A harness chat's conversation, keyed as `run` keys its turns. @param {{ upstream: any, cwdHint?: string | null, conversationId: string }} where */
  #chatKey({ upstream, cwdHint, conversationId }) {
    return conversationKey(upstream.id, determineCwd(upstream.acp || {}, [], cwdHint).cwd, [], conversationId);
  }
  /**
   * Codex writes Filament's summary of a harness chat (HarnessV3-ACP AC5-4), prompted with `instruction`, after the
   * chat's turns: in an ephemeral fork of its thread, opened as the thread was — its developer instructions, Filament's
   * MCP server — on the model and effort its turns ran, so Codex reads its warm cache; let go of after. Read-only: in
   * Codex's read-only sandbox, whatever it asks refused, and Filament's own tools refusing their calls. No clock ends it
   * (HarnessV3-FailurePoints §4 B): a stop does.
   * @param {{ upstream: any, cwdHint?: string | null, conversationId: string, instruction: string, signal?: AbortSignal | null }} o
   * @returns {Promise<import("../../../core/ports.js").AgentSummary>}
   */
  summarize(o) {
    const convKey = this.#chatKey(o);
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const mine = prev.catch(() => {}).then(() => this.#summarize(o, convKey));
    this.turnQueues.set(convKey, mine);
    const done = () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    };
    mine.then(done, done);
    return mine;
  }
  /**
   * @param {{ upstream: any, instruction: string, signal?: AbortSignal | null }} o
   * @param {string} convKey
   * @returns {Promise<import("../../../core/ports.js").AgentSummary>}
   */
  async #summarize({ upstream, instruction, signal = null }, convKey) {
    const conv = this.convs.get(convKey);
    if (!conv || !this.#ownAt(conv, upstream)) throw new Error("Codex holds no open thread of this chat to write the summary in");
    const proc = await this.#openAgain(upstream, conv, signal);
    const settings = proc.opened.get(conv.sessionId);
    const out = { text: "", tools: [], linesAdded: 0, linesRemoved: 0, title: null, agentModel: null, error: null };
    let forkId = "";
    /** @type {ReturnType<typeof createCodexReader> | null} */
    let reader = null;
    /** @type {() => void} */
    let unhook = () => {};
    const interrupt = () => {
      const turnId = reader?.turnId();
      if (turnId) void proc.request("turn/interrupt", { threadId: forkId, turnId }, 15000).catch(() => {});
    };
    signal?.addEventListener("abort", interrupt, { once: true });
    // The app-server is not let go of while Codex writes (the bug report's P3).
    const free = this.working(proc, upstream.id);
    this.writing.add(conv);
    try {
      // Codex asks before anything its read-only sandbox would not run, and the answer is no (`#approve`).
      const made = await proc.request(
        "thread/fork",
        { ...settings, threadId: conv.sessionId, cwd: conv.cwd, ephemeral: true, excludeTurns: true, approvalPolicy: "untrusted", sandbox: "read-only", ...(conv.modelId ? { model: conv.modelId } : {}) },
        0,
        signal,
      );
      forkId = String(made?.thread?.id || "");
      if (!forkId) throw new Error("Codex forked no thread (its thread/fork answered without one)");
      const r = createCodexReader({ threadId: forkId, out, onEvent: () => {}, notes: [], turn: { bridgePlan: () => false }, version: proc.version });
      reader = r;
      this.summaries.set(forkId, r);
      this.#op(`forked a Codex thread on ${upstream.id} for Filament's summary (${short(forkId)})`, {
        sub: "fork",
        detail: { upstream: upstream.id, method: "thread/fork", sessionId: forkId, from: conv.sessionId },
        ref: { upstreamId: upstream.id, sessionId: forkId },
      });
      if (signal?.aborted) throw new Error("stopped before Codex was asked");
      const res = await proc.request("turn/start", { threadId: forkId, input: [{ type: "text", text: instruction, text_elements: [] }], ...(conv.effort ? { effort: conv.effort } : {}) });
      r.turnId(String(res?.turn?.id || ""));
      // A stop while the turn was being started had no turn to interrupt yet.
      if (signal?.aborted) interrupt();
      const exit = proc.ending("its summary");
      unhook = exit.unhook;
      const ended = /** @type {any} */ (await Promise.race([r.ended, exit.gone]));
      if (signal?.aborted || String(ended?.status) === "interrupted") throw new Error("stopped while Codex wrote the summary");
      if (String(ended?.status) === "failed") throw codexError(ended?.error || out.error);
      return { text: out.text, how: "fork", usage: r.usage().usage };
    } finally {
      unhook();
      this.writing.delete(conv);
      signal?.removeEventListener("abort", interrupt);
      if (forkId) this.summaries.delete(forkId);
      // An app-server let go of meanwhile stops once the fork is let go of.
      void (forkId && !proc.exited
        ? proc.request("thread/unsubscribe", { threadId: forkId }, 15000).catch((e) => this.log("debug", `[codex] thread/unsubscribe ${short(forkId)}: ${e.message}`))
        : Promise.resolve()
      ).finally(free);
    }
  }

  /**
   * Whether Codex compacts a harness chat's thread itself when asked (HarnessV3-ACP AC5-5: `thread/compact/start`), as
   * its app-server holds the thread open: "fork" where its version forks a thread, which keeps the thread from before
   * for Undo; else "session". Null with no such thread, one the chat's next turn leaves (`base`), or a version without
   * it.
   * @param {import("../../../core/ports.js").AgentChat} where
   * @returns {"fork" | "session" | null}
   */
  compacts(where) {
    const conv = this.convs.get(this.#chatKey(where));
    if (!conv || !this.#ownAt(conv, where.upstream) || moveFor(conv, where.base ?? null).move !== "stay") return null;
    const p = codexProfile(this.#versionAt(where.upstream));
    return !p.reportsCompaction ? null : p.sessions.fork ? "fork" : "session";
  }
  /**
   * Codex compacts a harness chat's thread itself (HarnessV3-ACP AC5-5), queued after the chat's turns: forked first
   * where it forks one and `fork` asks — the copy, kept on disk and not loaded, is the thread from before — then
   * `thread/compact/start`, which takes no instructions, its compaction a turn of its own. Once Codex says it
   * compacted, `record` lists it and names the row the thread stands on from then on, and the fork stays on the record
   * as the thread from before it, for Undo; a failure, a stop or a refusal from `record` deletes the fork. No clock ends
   * it (HarnessV3-FailurePoints §4 B): a stop does.
   * @param {import("../../../core/ports.js").AgentOwnAsk} o
   * @returns {Promise<import("../../../core/ports.js").AgentOwnCompaction>}
   */
  compactOwn(o) {
    const convKey = this.#chatKey(o);
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const mine = prev.catch(() => {}).then(() => this.#compactOwn(o, convKey));
    this.turnQueues.set(convKey, mine);
    const done = () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    };
    mine.then(done, done);
    return mine;
  }
  /**
   * @param {import("../../../core/ports.js").AgentOwnAsk} o @param {string} convKey
   * @returns {Promise<import("../../../core/ports.js").AgentOwnCompaction>}
   */
  async #compactOwn({ upstream, fork, record, base = null, signal = null, onEvent = null }, convKey) {
    const conv = this.convs.get(convKey);
    if (!conv || !this.#ownAt(conv, upstream)) throw new Error("Codex holds no open thread of this chat to compact");
    if (moveFor(conv, base).move !== "stay") throw new Error("the chat's next message leaves this thread (a compaction was undone, or made since): nothing to compact in it");
    const proc = await this.#openAgain(upstream, conv, signal);
    // Its app-server says for itself whether this version has a compaction of its own.
    if (!codexProfile(proc.version).reportsCompaction) throw new Error("Codex has no compaction of its own that Filament can ask for in this version");
    const tid = conv.sessionId;
    const out = { text: "", tools: [], linesAdded: 0, linesRemoved: 0, title: null, agentModel: null, error: null };
    let forkId = "";
    let compactedNow = false;
    /** @type {ReturnType<typeof createCodexReader> | null} */
    let reader = null;
    /** @type {{ read: (method: string, params: any) => void } | null} */
    let hearing = null;
    /** @type {() => void} */
    let unhook = () => {};
    let interrupted = false;
    // Its turn is named only once Codex starts it (`thread/compact/start` answers without one): a stop before then
    // interrupts it as it starts.
    const interrupt = () => {
      const turnId = reader?.turnId();
      if (!turnId || interrupted) return;
      interrupted = true;
      void proc.request("turn/interrupt", { threadId: tid, turnId }, 15000).catch(() => {});
    };
    signal?.addEventListener("abort", interrupt, { once: true });
    // Another chat's turn on the thread (each resumed it) ends first (the bug report's X5).
    const release = await this.lockSession(tid, signal);
    // The app-server is not let go of while Codex compacts (the bug report's P3).
    const free = this.working(proc, upstream.id);
    const started = Date.now();
    try {
      if (signal?.aborted) throw new Error("stopped before Codex was asked");
      if (fork && codexProfile(proc.version).sessions.fork) {
        const made = await proc.request("thread/fork", { threadId: tid, cwd: conv.cwd, ephemeral: false, excludeTurns: true }, 0, signal);
        forkId = String(made?.thread?.id || "");
        if (!forkId) throw new Error("Codex forked no thread (its thread/fork answered without one)");
        // Kept on disk, not loaded: an undo resumes it.
        await proc.request("thread/unsubscribe", { threadId: forkId }, 15000).catch((e) => this.log("debug", `[codex] thread/unsubscribe ${short(forkId)}: ${e.message}`));
        this.#op(`forked a Codex thread on ${upstream.id}: the thread from before its own compaction (${short(forkId)})`, {
          sub: "fork",
          detail: { upstream: upstream.id, method: "thread/fork", sessionId: forkId, from: tid },
          ref: { upstreamId: upstream.id, sessionId: forkId },
        });
      }
      if (signal?.aborted) throw new Error("stopped before Codex was asked");
      const r = createCodexReader({
        threadId: tid,
        out,
        onEvent: (/** @type {any} */ ev) => {
          if (ev.type === "compaction") onEvent?.(ev);
        },
        notes: [],
        turn: { bridgePlan: () => false },
        version: proc.version,
        onCompacted: () => (compactedNow = true),
      });
      reader = r;
      hearing = {
        read: (method, params) => {
          r.read(method, params);
          if (signal?.aborted) interrupt();
        },
      };
      this.compacting.set(tid, hearing);
      await proc.request("thread/compact/start", { threadId: tid });
      if (signal?.aborted) interrupt();
      const exit = proc.ending("its compaction");
      unhook = exit.unhook;
      const ended = /** @type {any} */ (await Promise.race([r.ended, exit.gone]));
      // A compaction Codex finished stands, even with a stop that came too late for it.
      if (!compactedNow) {
        if (signal?.aborted || String(ended?.status) === "interrupted") throw new Error("stopped while Codex compacted");
        if (String(ended?.status) === "failed") throw codexError(ended?.error || out.error);
        throw new Error("its compaction ended without a compaction");
      }
      /** @type {import("../../../core/ports.js").AgentOwnCompaction} */
      const facts = { tokensBefore: Number(conv.context?.used) || 0, tokensAfter: 0, ms: Date.now() - started, usage: r.usage().usage, forked: !!forkId, instructed: false };
      // The thread as it stood before, with what it had of Filament's context then.
      const was = forkId ? { ...conv, sessionId: forkId, given: conv.given ? stateOf(conv.given) : conv.given, before: conv.before ?? null, made: true } : null;
      // What Filament said ahead of its prompts may be summarised away: the next prompt says it again (AC4-1).
      if (conv.given) compacted(conv.given);
      const id = record(facts);
      if (was) conv.before = was;
      conv.basedOn = id;
      this.#save();
      forkId = "";
      return facts;
    } finally {
      unhook();
      signal?.removeEventListener("abort", interrupt);
      if (hearing && this.compacting.get(tid) === hearing) this.compacting.delete(tid);
      release();
      // An app-server let go of meanwhile stops once the thread it made is let go of.
      void (forkId ? this.#dropMade({ ...conv, sessionId: forkId, made: true }, proc) : Promise.resolve()).finally(free);
    }
  }

  /**
   * Where Filament's tools stand for a thread given this MCP token (HarnessV3-ACP AC4-2, AC4-5): its chat's session and
   * the turn running in it, and the graph's tool where the thread was given it. Codex runs its own commands and edits,
   * so the file tools are never its (`native: false`). Null for a token no thread has.
   * @param {string} token @returns {import("../../../core/ports.js").McpContext | null}
   */
  contextForMcpToken(token) {
    if (!token) return null;
    for (const c of this.convs.values())
      if (c.mcpToken === token) {
        const turn = this.turns.get(c.sessionId) || null;
        const live = turn && !turn.done ? turn : null;
        return {
          conv: c,
          turn,
          cwd: c.cwd,
          upstream: { id: c.upstreamId, name: c.upstreamId, acp: this.latestAcp.get(c.upstreamId) || {} },
          native: false,
          chain: turn?.toolsAt?.chain ?? null,
          turnId: live?.toolsAt?.turn ?? null,
          graph: c.toolsGraph === true,
          report: c.toolsReport === true,
          asksLead: c.toolsAsksLead || null,
          team: c.toolsTeam === true,
          launch: !!c.toolsLaunch,
          // Codex's own sub-agents off beside Filament's (`CODEX_OWN_AGENTS_OFF`), so the words say so plainly.
          held: !!c.toolsLaunch && ownOffIn(c.opened),
          reads: c.toolsReads === true,
          visuals: c.toolsVisuals === true,
          artifacts: c.toolsArtifacts === true,
          beside: c.toolsBeside === true,
          thread: c.toolsThread === true,
          flow: c.toolsFlow === true,
          browser: c.toolsBrowser === true,
          skills: c.toolsSkills === true,
          // The sub-agent, and a card without the Space, as its newest turn says them: the token the thread opened with
          // goes as it opens (the bug hunt of 11-08: its calls were nobody's, and the Space its card has none of given).
          by: turn?.toolsAt?.by ?? null,
          ...(turn?.toolsAt?.space === false ? { space: false } : {}),
          // A chat Memory settings leave out, as its newest turn says: none of memory's tools.
          leftOut: turn?.toolsAt?.leftOut === true,
          // A caller that reaches its own project's sessions alone, as its newest turn says; with none to place the caller
          // (a restart, a turn ended long ago), unsaid: Filament's server keeps memory's tools to the project then.
          ...(turn ? { confined: turn.toolsAt?.confined === true } : {}),
          patienceMs: TOOL_TIMEOUT_SEC * 1000,
          // What the call says once it is done goes to the request it came in under, should the turn end meanwhile (`sayer`).
          emit: live ? live.sayer() : null,
          // A call of Filament's own that acts for the agent — the browser — judged by the chat's switch (AT-D7).
          permit: (/** @type {any[]} */ calls, /** @type {string} */ what) => this.permitCalls(live, { id: c.upstreamId, name: c.upstreamId }, calls, what),
          judgeNow: (/** @type {any[]} */ calls) => this.judgeNow(live, calls),
          modeNow: () => this.modeNow(live),
          // A command's ask on another machine, put to the person on the turn's card (the remote-agents plan's c-tools),
          // and the session's rule that asks first for one.
          askPerson: (/** @type {any} */ form, /** @type {any} */ o) => this.askPerson(live, form, o),
          rulesAsk: (/** @type {any[]} */ calls) => this.rulesAsk(live, calls),
          // A fork of the thread writes Filament's summary (AC5-4): Filament's tools refuse their calls.
          writing: this.writing.has(c),
        };
      }
    const p = this.pendingMcp.get(token);
    return p ? { conv: null, turn: null, cwd: p.cwd, upstream: p.upstream, native: false, chain: p.chain, turnId: null, graph: p.graph, report: p.report, asksLead: p.asksLead || null, team: p.team, reads: p.reads === true, launch: p.launch, held: p.launch === true && p.held === true, visuals: p.visuals === true, artifacts: p.artifacts === true, beside: p.beside === true, thread: p.thread === true, flow: p.flow === true, browser: p.browser === true, skills: p.skills === true, leftOut: p.leftOut === true, confined: p.confined === true, by: p.by ?? null, ...(p.space === false ? { space: false } : {}), patienceMs: TOOL_TIMEOUT_SEC * 1000, emit: null } : null;
  }

  /**
   * One turn: the thread found or started, what it missed handed over as history, `turn/start`, and Codex's
   * notifications read until it completes. The thread's lock, once the turn takes it, is let go of at its end.
   * @param {any} opts @param {{ flat: any[], convKey: string, cwd: string, turn: any }} at
   */
  async #runTurn(opts, at) {
    const held = { release: () => {} };
    try {
      return await this.#turnOn(opts, at, held);
    } catch (/** @type {any} */ e) {
      // A stop that ended a wait on Codex's answer — its start, the thread opened, its history handed over — ends the
      // turn as Codex's own interrupt does (HarnessV3-FailurePoints §4 B).
      if (!opts.signal?.aborted || e?.name !== "AbortError") throw e;
      const { turn, cwd } = at;
      const notes = turn.notes || [];
      notes.push(`codex: ${e.message}`);
      return { tools: [], stopReason: "cancelled", sessionId: null, reused: false, seeded: false, resumed: false, cwd, notes, structured: turn.structured || [], bridge: turn.bridgeEffective ?? null, steering: false };
    } finally {
      held.release();
    }
  }
  /**
   * The turn's work (`#runTurn`): `held.release` lets go of the thread's lock once the turn takes it.
   * @param {any} opts @param {{ flat: any[], convKey: string, cwd: string, turn: any }} ctx
   * @param {{ release: () => void }} held
   */
  async #turnOn(opts, { flat, convKey, cwd, turn }, held) {
    const { upstream, modelId, format, body, cwdHint, headers = {}, signal, conversationId = null, effort = null, resumeSessionId = null } = opts;
    const { mcpBase = null, context = null, bare = false } = opts;
    const acp = upstream.acp || {};
    this.latestAcp.set(upstream.id, acp);
    const onEvent = turn.emit;
    const lastIdx = flat.map((m) => m.role).lastIndexOf("user");
    const last = lastIdx >= 0 ? flat[lastIdx] : { role: "user", text: "Continue." };
    const history = flat.slice(0, lastIdx >= 0 ? lastIdx : flat.length);
    const where = determineCwd(acp, flat, cwdHint);
    /** @type {string[]} */
    const notes = [];
    /** @type {import("../../../core/notes.js").Positioned[]} */
    const structured = [];
    turn.notes = notes;
    turn.structured = structured;
    pushNote(notes, structured, { kind: "cwd", cwd, where: where.where, blocked: where.blocked, ignored: where.ignored });
    notes.push(`codex: conversation ${convKey} (${conversationId ? "client session id" : "fingerprint of the first message"})`);
    const reminders = flat.reduce((n, m) => n + (m.reminders || 0), 0);
    if (reminders) notes.push(`codex: ${reminders} <system-reminder> block(s) from the client removed (they address the client's own model, not the agent)`);
    const proc = await this.getProcess(upstream, { turn, signal });
    await this.#signedIn(upstream, proc);
    const models = await this.listModels(upstream).catch((e) => {
      notes.push(`codex: model list unavailable (${String(e.message).slice(0, 120)})`);
      return { items: [], names: [] };
    });
    const sel = selectCodexModel(modelId, effort, models.items, upstream.models || []);
    for (const n of sel.notes) typeof n === "string" ? notes.push(n) : pushNote(notes, structured, n);
    const mode = /^(plan|ask|read-only)$/i.test(String(opts.mode || acp.mode || "agent")) ? "plan" : "agent";
    // Plan mode reads only, whatever the policy or the switch: Codex's sandbox read-only, every command it does not
    // know to be safe brought to Filament, and only reads allowed. In a harness session the session's switch answers
    // Codex otherwise (AC3-2), and its mode as the turn starts sets the sandbox.
    const policy = mode === "plan" ? "read-only" : this.policyOf(acp, upstream.id);
    const switched = mode !== "plan" && turn.permits ? String(turn.permits.mode()) : null;
    const want = switched ? switchPolicy(switched) : codexPolicy(policy);
    turn.policy = policy;
    turn.plan = mode === "plan";
    if (mode === "plan") notes.push("codex: plan mode: Codex reads only (its sandbox read-only, its commands asked of Filament)");
    if (switched) notes.push(`codex: the session's switch (${switched}) answers Codex: it asks before each change and each command it does not know to be safe, in a ${want.sandbox} sandbox`);
    turn.bridgeEffective = turn.bridge === "off" ? "off" : "prompts";
    if (turn.bridge === "full" || turn.bridge === "native")
      notes.push(`codex: client bridge ${turn.bridge} is not available for Codex, which runs its own commands and edits; its plan and its questions still reach the client`);
    const sysText = acp.forwardSystemPrompt === true ? history.filter((m) => m.role === "system").map((m) => m.text).join("\n\n") : "";
    // Filament's own tools reach a thread as an MCP server in its config, as it opens: memory's while their switch is
    // on — never for a chat Memory settings leave out (D4 of 11-01) — the task graph's while the session's is (AC4-2,
    // AC4-5). The dotted key adds Filament's server beside the
    // person's own; `mcp_servers` whole would replace theirs. Codex runs them without asking (`approve`): Filament
    // judges its tools where they act, as it does an ACP agent's calls to them (turn-bridge `loopCalls`). Codex's own
    // way (`auto`) asks the person before each call of a tool that doesn't say it only reads (AC4's drive).
    const memoryWanted = !turn.toolsAt?.none && !turn.toolsAt?.leftOut && !!this.agentTools?.memoryOn();
    const graphWanted = !!turn.toolsAt?.graph;
    // A graph task's sub-agent's report (AC6-1): its thread is its own, opened for it.
    const reportWanted = !!turn.toolsAt?.report;
    // A team's worker whose lead reads along asks it with ask_lead (HarnessV3-TaskGraph-v2 TG2-D49), by its id.
    const asksLeadWanted = String(turn.toolsAt?.asksLead || "");
    // A team's tools for Codex leading the session's team (AC6-3).
    const teamWanted = !!turn.toolsAt?.team;
    // What the session offers Codex of Filament's sub-agents (HarnessV4_Tasks E12 step 2, E15 step 3), as one word: a
    // plain chat's agent tool, and whom a lead may ask.
    const launchWanted = String(turn.toolsAt?.launch || "");
    // Its lead reads along with its workers (HarnessV3-TaskGraph-v2 V2-0b): the worker and the wait that say so.
    const readsWanted = teamWanted && !!turn.toolsAt?.reads;
    // A harness chat shows the agent's visuals (HarnessV4_Visuals_Plan E16).
    const visualsWanted = !!turn.toolsAt?.visuals;
    // And makes its artifacts (HarnessV4_Artifacts_Plan E18).
    const artifactsWanted = !!turn.toolsAt?.artifacts;
    // And fires teams beside its chat, where it is its own agent (team_v2_plan §5.5), designs flows beside it (OA3), and
    // starts threads of it (app/threads.js).
    const besideWanted = !!turn.toolsAt?.beside;
    const threadWanted = !!turn.toolsAt?.thread;
    const flowWanted = !!turn.toolsAt?.flow;
    // And its agents drive the chat's browser (HarnessV4_AgentTools_Plan AT-D7).
    const browserWanted = !!turn.toolsAt?.browser;
    // And its chat offers skills (HarnessV4_Skills_Plan S1-1).
    const skillsWanted = !!turn.toolsAt?.skills;
    // And its chat's project has its Space, made and switched on (the owner's of 11-08, h3): made partway through, it
    // reaches the thread at the next message; switched off or deleted, it goes the same way.
    const spaceWanted = !!turn.toolsAt?.spaceOn;
    const wantMcp = !!mcpBase && (memoryWanted || graphWanted || reportWanted || !!asksLeadWanted || teamWanted || !!launchWanted || visualsWanted || artifactsWanted || besideWanted || threadWanted || flowWanted || browserWanted || skillsWanted || spaceWanted);
    // Its own sub-agents off where Filament's agent tool or its team stands in for them (`CODEX_OWN_AGENTS_OFF`).
    const ownHeld = wantMcp && (teamWanted || !!launchWanted);
    // The standing context (AC4-1) goes in the developer instructions at every open, after the client's own.
    const opening = standingFor(context, givenTools({ graph: wantMcp && graphWanted, launch: wantMcp && !!launchWanted, skills: wantMcp && skillsWanted }), ownHeld);
    const readsBy = switched === "read-only" && process.platform === "win32" ? READS_ON_WINDOWS : "";
    const devText = [sysText, standingText(opening), readsBy].filter(Boolean).join("\n\n");
    const settings = { approvalPolicy: want.approvalPolicy, sandbox: want.sandbox, ...(sel.model ? { model: sel.model } : {}), ...(devText ? { developerInstructions: devText } : {}) };
    /** A token for this open: what a thread connects with stands for the tools it is given now. */
    const mcpToken = wantMcp ? randomBytes(12).toString("hex") : null;
    // The person's own MCP servers (HarnessV4_Overnight_Plan OV-D15, OV-D16): the card's and the chat's, one dotted
    // config key each beside Filament's, so the servers in the person's own Codex config stay. Codex asks before each
    // call of theirs its own way, which reaches the chat's switch.
    // Another machine's agents' chat (app/acp-turn.js `fenced`) is given none of them, and those of the person's own
    // Codex config are off (`theirsOff`).
    const fenced = turn.toolsAt?.agentsChat === true;
    const chat = serversFor(acp, turn.toolsAt?.mcp, { title: agentTitle(upstream), http: true, cwd: true, fenced });
    // A side agent's compaction line, handed as Claude Code's is: Codex compacts its thread by itself once a turn's
    // context crosses it (`model_auto_compact_token_limit`), in the middle of a turn. A main chat's line is weighed by
    // Filament between turns.
    const sideLine = headers?.["x-filament-subagent"] ? lineOf(headers) : null;
    // Its model calls that the person's own config sends through Filament's door ask it to add nothing (`addsNothingAt`):
    // the door known by Filament's places, a turn given no address of Filament's too, else by the turn's own.
    const doorAsk = addsNothingAt(upstream, filamentsDoor(this.ownPlaces, mcpBase));
    const own = { ...codexServers(chat.servers), ...(fenced ? theirsOff(upstream, !!mcpToken) : {}), ...(sideLine ? { model_auto_compact_token_limit: sideLine } : {}), ...(ownHeld ? CODEX_OWN_AGENTS_OFF : {}), ...doorAsk.asks };
    const openWith = () => {
      if (!mcpToken) return Object.keys(own).length ? { ...settings, config: own } : settings;
      this.pendingMcp.set(mcpToken, { cwd, upstream: { id: upstream.id, name: upstream.name || upstream.id, acp }, chain: turn.toolsAt?.chain ?? null, graph: graphWanted, report: reportWanted, asksLead: asksLeadWanted || null, team: teamWanted, reads: readsWanted, launch: !!launchWanted && !teamWanted, held: ownHeld, visuals: visualsWanted, artifacts: artifactsWanted, beside: besideWanted, thread: threadWanted, flow: flowWanted, browser: browserWanted, skills: skillsWanted, ...(turn.toolsAt?.leftOut ? { leftOut: true } : {}), confined: turn.toolsAt?.confined === true, ...(turn.toolsAt?.by ? { by: turn.toolsAt.by } : {}), ...(turn.toolsAt?.space === false ? { space: false } : {}), at: Date.now() });
      return { ...settings, config: { ...own, [OWN_SERVER]: { url: mcpAddress(String(mcpBase), mcpToken), default_tools_approval_mode: "approve", tool_timeout_sec: TOOL_TIMEOUT_SEC } } };
    };

    // The compaction this agent's session of the chat stands on, as a harness turn names it (AC5-1, HarnessV4_Tasks
    // A8): the chat's newest, or a newer one of Filament's copy alone that moved it; null for anyone else's request.
    const base = compactionOf(headers, upstream.id);
    /** @type {CodexConv | null} */
    let conv = this.convs.get(convKey) || null;
    // The chat was told that Codex works read-only in it (`#sandboxNote`): a thread that replaces this one keeps that.
    const toldReadOnly = conv?.readOnlySaid === true;
    /** What the thread's sandbox has to tell the chat (`#sandboxNote`), said once the turn's session is up. @type {any} */
    let sandboxSaid = null;
    let resumed = false;
    let reused = false;
    let started = false;
    /** What `thread/start` or `thread/resume` answered, when this turn opened the thread. @type {any} */
    let opened = null;
    if (resumeSessionId && !(conv && conv.sessionId.startsWith(resumeSessionId))) {
      const l = await this.listSessions(upstream);
      const { found, candidates } = l.ok ? findSession(l.sessions, resumeSessionId) : { found: null, candidates: [] };
      if (!found) {
        notes.push(`codex: no Codex thread matches "${resumeSessionId}"; starting a new one`);
        onEvent({ type: "text", own: true, text: `⚠ No Codex thread matches "${resumeSessionId}"${candidates.length > 1 ? " uniquely" : ""} (Home → Agents lists them). Continuing in a new one.\n\n` });
      } else {
        conv = this.#newConv(upstream, found.sessionId, found.cwd || cwd, found.title, base ?? 0);
        this.convs.set(convKey, conv);
        resumed = true;
        notes.push(`codex: resumed Codex thread ${short(found.sessionId)}${found.title ? ` “${String(found.title).slice(0, 60)}”` : ""}`);
      }
    }
    // A thread standing on a compaction other than the chat's newest gives way (AC5-1): to the thread from before,
    // where an undo brought the chat back to it, else to a fresh one. Once a turn runs on the compacted thread, those
    // from before can no longer come back.
    if (conv && !resumed) {
      const step = moveFor(conv, base);
      if (step.move === "back") {
        notes.push(`codex: back to thread ${short(step.to.sessionId)}, from before the compaction undone (thread ${short(conv.sessionId)} let go)`);
        conv = { ...step.to, made: false };
        this.convs.set(convKey, conv);
      } else if (step.move === "fresh") {
        notes.push(`codex: the chat was compacted since thread ${short(conv.sessionId)} started: it is let go, and a fresh thread starts from the compaction`);
        this.convs.delete(convKey);
        conv = null;
      } else if (step.gone.length) conv.before = null;
      for (const c of step.gone) this.#unload(c);
    }
    // Two chats can share one thread (each resumed it): the turn acts on it (opens it again, hands it history, starts
    // on it) once the turn running on it has ended. Codex takes a message sent meanwhile into the running turn, so the
    // other chat's turn answered it, and this one waited for an end that never came (the bug report's X5). A stop
    // while it waits ends it there, the thread untouched.
    if (conv) {
      held.release = await this.lockSession(conv.sessionId, signal);
      if (signal?.aborted)
        return { tools: [], stopReason: "cancelled", sessionId: conv.sessionId, reused: false, seeded: false, resumed, cwd: conv.cwd || cwd, notes, structured, bridge: turn.bridgeEffective, steering: false };
    }
    // Whether it has the task graph or memory's tools (the chat left out or taken back in, memory's tools switched),
    // whether Codex leads the session's team or reads along with its workers, what Filament's agent tool offers it, the
    // project's Space, or the visuals' or the artifacts' switch, changed since the thread opened — or, for a worker's
    // follow-up, whether its lead reads along with it, or the chat's own MCP servers (OV-D18): it opens again, with the
    // tools it takes now —
    // Codex keeps a loaded thread's MCP servers as they were. So it does where a sub-agent's compaction line is other
    // than the one its thread opened with (none, where nobody knew its window yet): Codex keeps a loaded thread's
    // auto-compact limit as it opened.
    const toolsMoved = !!conv && ((conv.toolsGraph === true) !== (wantMcp && graphWanted) || (conv.toolsMemory === true) !== (wantMcp && memoryWanted) || (conv.toolsTeam === true) !== (wantMcp && teamWanted) || (conv.toolsReads === true) !== (wantMcp && readsWanted) || (conv.toolsVisuals === true) !== (wantMcp && visualsWanted) || (conv.toolsArtifacts === true) !== (wantMcp && artifactsWanted) || (conv.toolsBeside === true) !== (wantMcp && besideWanted) || (conv.toolsThread === true) !== (wantMcp && threadWanted) || (conv.toolsFlow === true) !== (wantMcp && flowWanted) || (conv.toolsBrowser === true) !== (wantMcp && browserWanted) || (conv.toolsSkills === true) !== (wantMcp && skillsWanted) || (conv.toolsSpace === true) !== (wantMcp && spaceWanted) || String(conv.toolsLaunch || "") !== (wantMcp ? launchWanted : "") || String(conv.toolsAsksLead || "") !== (wantMcp ? asksLeadWanted : ""));
    const chatMoved = !!conv && String(conv.toolsMcp || "") !== chat.key;
    const lineHeld = conv ? (proc.opened.get(conv.sessionId)?.config?.model_auto_compact_token_limit ?? null) : null;
    const lineMoved = !!conv && !!sideLine && lineHeld !== sideLine;
    // Another machine's agents' chat whose Full control was switched since the thread opened (app/acp-turn.js `fenced`):
    // Codex keeps a loaded thread's MCP servers as they were, the person's own config's on or off with them.
    const fenceMoved = !!conv && (conv.fenced === true) !== fenced;
    // A thread loaded with its own sub-agents on or off other than this turn wants them: Codex keeps a loaded thread's
    // features as it opened.
    const ownMoved = !!conv && proc.opened.has(conv.sessionId) && ownOffIn(proc.opened.get(conv.sessionId)) !== ownHeld;
    if (conv && proc.loaded.has(conv.sessionId) && (toolsMoved || chatMoved || lineMoved || fenceMoved || ownMoved)) {
      proc.loaded.delete(conv.sessionId);
      proc.opened.delete(conv.sessionId);
      await proc.request("thread/unsubscribe", { threadId: conv.sessionId }, 0, signal).catch((e) => this.log("debug", `[codex] thread/unsubscribe ${short(conv?.sessionId)}: ${e.message}`));
      const why = [toolsMoved && "the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, the project's Space, or the visuals', the artifacts' or the team tool's switch,", chatMoved && "the chat's own MCP servers"].filter(Boolean);
      if (why.length) notes.push(`codex: thread ${short(conv.sessionId)} opened again: ${why.join(" and ")} changed the tools it takes`);
      if (fenceMoved) notes.push(`codex: thread ${short(conv.sessionId)} opened again: another machine's agents' chat, its Full control switched ${fenced ? "off" : "on"}, takes the person's own Codex MCP servers ${fenced ? "off" : "on"}`);
      if (lineMoved) notes.push(`codex: thread ${short(conv.sessionId)} opened again: it opened with ${lineHeld ? `a compaction line of ${Number(lineHeld).toLocaleString()} tokens` : "no compaction line"}, and Codex keeps a loaded thread's auto-compact limit as it opened`);
      if (ownMoved && !toolsMoved) notes.push(`codex: thread ${short(conv.sessionId)} opened again: it opened with Codex's own sub-agents ${ownHeld ? "on, which Filament's agent tool stands in for now" : "off, and Filament's agent tool is not offered now"}`);
    }
    if (conv && proc.loaded.has(conv.sessionId)) {
      reused = true;
      if (!resumed) notes.push(`codex: thread ${short(conv.sessionId)} reused (turn ${conv.turns + 1})`);
    } else if (conv) {
      try {
        const openSettings = openWith();
        onEvent({ type: "step", step: "resuming" });
        opened = await proc.request("thread/resume", { threadId: conv.sessionId, cwd: conv.cwd || cwd, excludeTurns: true, ...openSettings }, 0, signal);
        proc.loaded.add(conv.sessionId);
        proc.opened.set(conv.sessionId, openSettings);
        reused = true;
        this.#op(`resumed a Codex thread on ${upstream.id} (${short(conv.sessionId)})`, {
          sub: "resume",
          detail: { upstream: upstream.id, method: "thread/resume", sessionId: conv.sessionId },
          ref: { upstreamId: upstream.id, sessionId: conv.sessionId },
        });
        if (!resumed) notes.push(`codex: thread ${short(conv.sessionId)} loaded again`);
      } catch (/** @type {any} */ e) {
        if (signal?.aborted) throw e;
        notes.push(`codex: could not resume thread ${short(conv.sessionId)} (${String(e.message).slice(0, 120)}); starting a new one`);
        this.convs.delete(convKey);
        conv = null;
        resumed = false;
      }
    }
    if (!conv) {
      const openSettings = openWith();
      onEvent({ type: "step", step: "opening" });
      opened = await proc.request("thread/start", { cwd, ephemeral: false, ...openSettings }, 0, signal);
      const threadId = String(opened?.thread?.id || "");
      if (!threadId) throw new Error("Codex started no thread (thread/start answered without one)");
      proc.loaded.add(threadId);
      proc.opened.set(threadId, openSettings);
      started = true;
      const title = String(last.text || "").replace(/\s+/g, " ").trim().slice(0, 60) || null;
      // Fresh until the chat goes in: a turn stopped first leaves the next to hand it over (the bug report's L21).
      conv = { ...this.#newConv(upstream, threadId, cwd, title, base ?? 0), fresh: true };
      this.convs.set(convKey, conv);
      this.#op(`started a Codex thread on ${upstream.id} (${short(threadId)})`, {
        sub: "new",
        detail: { upstream: upstream.id, method: "thread/start", sessionId: threadId, mode },
        ref: { upstreamId: upstream.id, sessionId: threadId },
      });
      notes.push(`codex: new Codex thread ${short(threadId)}`);
    }
    const threadId = conv.sessionId;
    // A harness chat's, whose turns name its compaction: its record outlives idleness (`idleStep`).
    if (base != null) conv.harness = true;
    if (mcpToken) this.pendingMcp.delete(mcpToken);
    if (opened) {
      // The model the thread says it is on as it opens, with the one it was asked for then: the thread's own word,
      // which a turn asked for the same model is answered by whatever it was asked.
      conv.said = opened.model ? { model: String(opened.model), asked: sel.model || null } : null;
      if (toldReadOnly) conv.readOnlySaid = true;
      sandboxSaid = await this.#sandboxNote(proc, opened, want, notes, conv);
      if (sideLine) notes.push(`codex: given its own compaction line, ${sideLine.toLocaleString()} tokens (its auto-compact limit): it makes room by itself when a turn crosses it`);
      const toDoor = Object.keys(doorAsk.asks).map((k) => k.split(".")[1]);
      if (toDoor.length) notes.push(`codex: its model calls to Filament's door (its provider${toDoor.length > 1 ? "s" : ""} ${toDoor.join(", ")}) ask Filament to add nothing (${ADDS_NOTHING_LINE}): the thread has Filament's additions already`);
      // What could not be asked is said, never left silent: a config Filament's reader of TOML could not read, and a
      // provider built into Codex that a variable or a key points at Filament's door.
      if (doorAsk.unread) notes.push(`codex: ${doorAsk.unread}: Filament cannot tell whether a provider of it points at Filament's door, so none carries its ask to add nothing (${ADDS_NOTHING_LINE}), and model calls that go there get Filament's additions again`);
      for (const by of doorAsk.builtIn) notes.push(`codex: ${by} is Filament's door, and Filament knows no key of a thread's config that gives a provider built into Codex a header: model calls that go there by it do not ask Filament to add nothing (${ADDS_NOTHING_LINE}), and get Filament's additions again`);
      conv.mcpToken = mcpToken;
      // What the thread was opened with (HarnessV4_Tasks C33): a way of Codex's own — its compaction, its summary —
      // resumes the thread with the same where no app-server holds it (a restart, an idle one let go).
      conv.opened = proc.opened.get(conv.sessionId) || null;
      conv.chatServers = (turn.toolsAt?.mcp || []).map((m) => m.name).filter((n) => !!conv.opened?.config?.[`mcp_servers.${n}`]);
      conv.toolsGraph = wantMcp && graphWanted;
      conv.toolsMemory = wantMcp && memoryWanted;
      conv.toolsReport = wantMcp && reportWanted;
      conv.toolsAsksLead = wantMcp ? asksLeadWanted : "";
      conv.toolsTeam = wantMcp && teamWanted;
      conv.toolsLaunch = wantMcp ? launchWanted : "";
      conv.toolsReads = wantMcp && readsWanted;
      conv.toolsVisuals = wantMcp && visualsWanted;
      conv.toolsArtifacts = wantMcp && artifactsWanted;
      conv.toolsBeside = wantMcp && besideWanted;
      conv.toolsThread = wantMcp && threadWanted;
      conv.toolsFlow = wantMcp && flowWanted;
      conv.toolsBrowser = wantMcp && browserWanted;
      conv.toolsSkills = wantMcp && skillsWanted;
      conv.toolsSpace = wantMcp && spaceWanted;
      conv.toolsMcp = chat.key;
      notes.push(...chat.words);
      conv.fenced = fenced;
      if (fenced) notes.push("codex: the MCP servers of the person's own Codex config are off: the thread is another machine's agents' chat");
      // The chat's added folders (OV-D23) need nothing given: Codex's sandbox reads anywhere, and Filament's judge of
      // its commands takes them as readable.
      if (turn.toolsAt?.dirs?.length) notes.push(`codex: the chat's added folders are readable to Codex as they stand: its sandbox reads anywhere, and Filament's judge of its commands takes ${turn.toolsAt.dirs.join(", ")} as readable`);
      if (mcpToken)
        notes.push(`codex: Filament's MCP server given to the thread: ${[memoryWanted ? "memory's tools" : "", conv.toolsGraph ? "the task graph's" : "", conv.toolsReport ? "the task's report" : "", conv.toolsAsksLead ? "ask_lead" : "", conv.toolsTeam ? "the team's" : "", conv.toolsLaunch && !conv.toolsTeam ? "Filament's agent tool" : "", conv.toolsVisuals ? "the visual tools" : "", conv.toolsArtifacts ? "the artifact tool" : ""].filter(Boolean).join(" and ")}`);
    }
    // What the thread has of Filament's context (AC4-1): a new one's developer instructions carry the standing context
    // whole. A resumed one may keep the instructions it started with, so what changed since goes ahead of the prompt
    // too — said twice at worst, never lost.
    conv.given = stateOf(conv.given);
    if (started) openedWith(conv.given, opening);
    const has = givenTools({ graph: conv?.toolsGraph === true, launch: !!conv?.toolsLaunch, team: conv?.toolsTeam === true, skills: conv?.toolsSkills === true });
    // In the words for its own sub-agents as the thread holds them, on or off (`CODEX_OWN_AGENTS_OFF`).
    const standing = standingFor(context, has, ownOffIn(conv.opened));
    const update = context ? contextUpdate(conv.given, standing) : null;
    // A thread already loaded keeps the settings it was opened with: a policy, or a switch, changed since goes with
    // this turn.
    const setting = switched ? `switch:${switched}` : policy;
    const override = !opened && conv.policy !== setting ? { approvalPolicy: want.approvalPolicy, sandboxPolicy: sandboxPolicy(want.sandbox) } : {};
    conv.policy = setting;
    turn.sessionId = threadId;
    turn.conv = conv;
    this.takeSession(threadId, turn, onEvent);

    // What the thread did not see, handed over as its history: the chat so far for a fresh thread (a harness chat's:
    // the harness's composition of it, compacted or not, AC5-1 and AC-R1; an outside client's: the archive's version
    // first), the turns another model answered since its last for a known one.
    // An earlier try of this message that the chat kept is one turn with it (HarnessV4_Tasks B8): counted once.
    const tried = earlierTriesOf(headers);
    const userTurns = flat.filter(isUserTurn).length - tried;
    // The copy took a new start under this thread since it last counted: the harness's count is the one.
    if (recounted(conv, seenOf(headers))) notes.push("codex: Filament's copy of the chat starts from a summary written since this thread's last prompt, while the thread went on: its place in the copy is the harness's count");
    // What the person said while the thread's last turn ran is in that turn, and the thread heard it there.
    const within = seenWithin(conv, history);
    if (within) notes.push(`codex: ${within} message(s) sent while Codex's last turn ran are in that turn: the thread heard them there, so they are not handed back`);
    let seeded = false;
    /** @type {any[]} */
    let carry = [];
    /** @type {string} */
    let carried = "";
    if (bare) notes.push("codex: the earlier conversation was too long for Codex (overflow): this new thread goes on without it");
    else if (conv.fresh && acp.seedHistory !== false) {
      const arch =
        base == null && acp.seedFromArchive !== false && typeof this.archivedTranscript === "function"
          ? this.#archivedSeed({ format, body, headers, cwdHint, model: body?.model || "" }, acp, last.text || "")
          : null;
      const prior = history.filter((m) => m.role !== "system");
      if (arch) {
        carry = [{ type: "message", role: "developer", content: [{ type: "input_text", text: `${EARLIER_WORDS}:\n\n${arch.text}` }] }];
        carried = `seeded from Filament's archive (${arch.view} view): ${arch.turns} turn(s), ~${arch.tokens} tokens${arch.dropped ? `, ${arch.dropped} older turn(s) dropped to fit the ${arch.budget}-token budget` : ""}`;
      } else if (prior.length && base != null) {
        // The harness's composition whole: each call with its whole input, each result whole (HarnessV4_Tasks A7).
        const all = flattenMessages(format, body, { whole: true }).slice(0, history.length).filter((m) => m.role !== "system");
        carry = all.map(historyItem);
        const what = `the harness's composition, ${prior.length} message(s), ~${estimateTokens(all.map((/** @type {any} */ m) => m.text).join("\n\n"))} tokens`;
        carried = base ? `seeded from the chat as its compaction ${base} left it: ${what}` : `seeded from the whole chat: ${what}`;
      } else if (prior.length) {
        carry = prior.map(historyItem);
        carried = `seeded with the client's ${prior.length} earlier message(s)${acp.seedFromArchive === false ? " (acp.seedFromArchive is off)" : " (no archived turns for this chat)"}`;
      }
      seeded = carry.length > 0;
    } else if (acp.catchUp !== false && reused && !resumed && conv.seenUserTurns != null && userTurns - 1 > conv.seenUserTurns) {
      const missed = missedTurns(base != null ? flattenMessages(format, body, { whole: true }).slice(0, history.length) : history, conv.seenUserTurns).filter((/** @type {any} */ m) => m.role !== "system");
      carry = missed.map(historyItem);
      carried = `${missed.filter(isUserTurn).length} turn(s) handled elsewhere since this thread's last turn were handed over so Codex catches up`;
    }
    // The prompt's blocks, as a thread that begins from the chat's history takes them where it does (`promptFor`). What
    // the history handed over says already goes with the prompt once: there (`notHeldIn`).
    const recall = promptFor(context, has, seeded);
    const kept = notHeldIn(recall, carry.flatMap((/** @type {any} */ it) => (Array.isArray(it?.content) ? it.content : []).map((/** @type {any} */ p) => String(p?.text ?? ""))).join("\n\n"));
    for (const id of kept.held) notes.push(`codex: what the ${id} block says came with the thread's ${seeded ? "seed" : "catch-up"} — not said again with its prompt`);
    let promptText = withPromptBlocks(String(last.text || "Continue."), kept.blocks);
    // The thread has the chat before this message once its history went in (or it was owed none), and the message once
    // it goes out (`told`): a turn stopped between told it only the first (the bug report's L21). History Codex refused
    // goes in the prompt, and with it.
    let inPrompt = false;
    if (carry.length)
      try {
        await proc.request("thread/inject_items", { threadId, items: carry }, 0, signal);
        notes.push(`codex: ${carried}, as the thread's history`);
      } catch (/** @type {any} */ e) {
        if (signal?.aborted) throw e;
        const text = carry.map((it) => `### ${it.role === "assistant" ? "Assistant" : it.role === "user" ? "User" : "Earlier"}\n${it.content[0].text}`).join("\n\n");
        inPrompt = true;
        promptText = `${seeded ? (base ? COMPACTED_WORDS : EARLIER_WORDS) : "Meanwhile, this conversation continued with another assistant (you did not see these turns; continue from them, do not repeat them)"}:\n\n${text}\n\n---\nLatest user message:\n\n${promptText}`;
        notes.push(`codex: ${carried}, in the prompt (Codex refused them as history: ${String(e.message).slice(0, 120)})`);
      }
    if (update) promptText = ahead(update.text, promptText);
    if (!inPrompt) {
      conv.seenUserTurns = history.filter(isUserTurn).length - tried;
      delete conv.fresh;
    }
    const given = givenRecord({ opened: opened ? opening : null, update, recall: kept.blocks, held: kept.held });
    if (given && givenSays(given)) notes.push(givenNote("codex", given, "Codex's developer instructions"));
    const att = extractAttachments(format, body, { image: true, embeddedContext: false });
    appendNotes(notes, structured, att);
    const input = [
      { type: "text", text: promptText + att.inlineText, text_elements: [] },
      ...att.blocks.map((/** @type {any} */ b) => ({ type: "image", url: b.data ? `data:${b.mimeType};base64,${b.data}` : b.uri })),
    ];

    const out = {
      text: "",
      /** @type {any[]} */ tools: [],
      /** @type {string | null} */ stopReason: null,
      sessionId: threadId,
      reused,
      seeded,
      resumed,
      cwd: conv.cwd || cwd,
      notes,
      structured,
      linesAdded: 0,
      linesRemoved: 0,
      bridge: turn.bridgeEffective,
      steering: false,
      // Filament's envelope tool reached the thread (HarnessV4_Envelopes_Plan EN3): without it a result comes whole.
      opensEnvelopes: has(ENVELOPES_TOOL),
      /** @type {any} */ usage: null,
      /** @type {any} */ context: null,
      // Who Codex runs as and the model, from the turn's start, so a turn that fails keeps them (HarnessV3-ACP AC2-5).
      // The model: the thread's own word where it opened asked for what this turn asks (`conv.said`) — another than
      // the one asked for is the one that answers —, else the one asked for; a turn Codex moves names its own
      // (items.js `model/rerouted`).
      /** @type {any} */ account: this.#accountRecord(upstream.id),
      /** @type {string | null} */ agentModel: (conv.said && conv.said.asked === (sel.model || null) ? conv.said.model : null) || sel.model || conv.modelId || null,
      /** @type {string | null} */ title: null,
      /** @type {any} */ error: null,
      ...(given ? { given } : {}),
      // Where Codex makes room by itself (acp/bridge.js `pointOf` says Claude Code's): a side agent's line is its
      // thread's auto-compact limit, which the thread holds by now — opened with it, or opened again for it above.
      ...(sideLine ? { point: { at: sideLine, line: sideLine } } : {}),
    };
    let answered = false;
    /** @param {any} ev */
    const heard = (ev) => {
      if (ev?.type === "text" || ev?.type === "thought" || ev?.type === "tool") answered = true;
      return onEvent(ev);
    };
    const state = /** @type {import("../context.js").ContextState} */ (conv.given);
    /** Codex compacted the thread during this turn, after the turn's prompt (AC-R4). */
    let compactedHere = false;
    const reader = createCodexReader({
      threadId,
      out,
      onEvent: heard,
      notes,
      turn,
      version: proc.version,
      onCompacted: () => {
        compactedHere = true;
        compacted(state);
      },
    });
    const entry = { proc, reader, turn };
    this.readers.add(entry);
    turn.cancel = async () => {
      const id = reader.turnId();
      if (id) await proc.request("turn/interrupt", { threadId, turnId: id }, 15000).catch(() => {});
    };
    const onAbort = () => void turn.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    /** @type {() => void} */
    let unhook = () => {};
    try {
      // A stop or a hang-up while the thread was being readied: the message never goes out.
      if (signal?.aborted) {
        out.stopReason = "cancelled";
        return out;
      }
      // The turn's run starts here, with the turn's facts as they stand: a turn that fails keeps them (HarnessV3-ACP
      // AC2-5). The person's words go into the running turn (`turn/steer`, AC3-1), naming it: one that has ended, or
      // one Codex keeps to itself (a review, a compaction), refuses them, and they go as the next message. What it
      // takes, the thread has: a later turn's catch-up counts it. The pictures they carry go with them, as a turn's
      // own do (HarnessV4_Tasks C22).
      /** @type {(id: string) => void} */
      let started = () => {};
      /** @type {Promise<string>} */
      const startedAs = new Promise((resolve) => (started = resolve));
      /** @type {import("../turn-bridge.js").Steer} */
      const steer = {
        at: "live",
        images: true,
        send: countTaken(conv, userTurns, async (text, images = []) => {
          const expectedTurnId = await startedAs;
          if (!expectedTurnId) return false;
          const input = [
            ...(text ? [{ type: "text", text, text_elements: [] }] : []),
            ...images.map((p) => ({ type: "image", url: `data:${p.mediaType};base64,${p.data}` })),
          ];
          // No clock, and a stop does not end the wait: the words went, and whether Codex took them is its answer.
          await proc.request("turn/steer", { threadId, input, expectedTurnId });
          return true;
        }),
      };
      // The reader notes where the working tree stands before Codex hears the message; a stop meanwhile ends here.
      await onEvent({ type: "session", sessionId: threadId, cwd: out.cwd, rawMessages: false, facts: out, steer });
      // Said now, on the run the session's event opened; a turn that ended before it leaves it for the thread's next open.
      if (sandboxSaid) {
        onEvent(sandboxSaid);
        conv.readOnlySaid = true;
      }
      if (signal?.aborted) {
        started("");
        out.stopReason = "cancelled";
        return out;
      }
      // The thread has the message once it goes out (the bug report's L21).
      told(conv, { userTurns, command: false });
      // No signal: a stop while the turn is being started waits for its id, to interrupt it.
      const starting = proc.request("turn/start", { threadId, input, ...(sel.model ? { model: sel.model } : {}), ...(sel.effort ? { effort: sel.effort } : {}), ...override }).catch((/** @type {any} */ e) => {
        started("");
        throw e;
      });
      // The message is out: the turn says so until Codex's first word (HarnessV3-FailurePoints §5.1 item 2).
      onEvent({ type: "step", step: "sent" });
      const res = await starting;
      reader.turnId(String(res?.turn?.id || ""));
      started(reader.turnId() || "");
      // A stop while the turn was being started had no turn to interrupt yet.
      if (signal?.aborted) await turn.cancel();
      const exit = proc.ending("the turn");
      unhook = exit.unhook;
      const ended = /** @type {any} */ (await Promise.race([reader.ended, exit.gone]));
      // The plan's windows as Codex last said them, a failed turn's too: one that hit the limit shows the window
      // that ran out.
      out.account = this.#accountRecord(upstream.id);
      if (String(ended?.status) === "failed") throw codexError(ended?.error || out.error);
      out.stopReason = String(ended?.status) === "interrupted" ? "cancelled" : "end_turn";
      const u = reader.usage();
      out.usage = u.usage;
      out.context = u.context;
      if (reader.unmatched()) notes.push(`codex: ${reader.unmatched()} sub-agent thread(s) of this turn were never matched to the call that started them; their work is not on the cards`);
      conv.turns++;
      conv.lastUsed = Date.now();
      conv.modelId = out.agentModel || conv.modelId;
      conv.mode = mode;
      conv.effort = sel.effort || null;
      if (out.context) conv.context = out.context; // the last fill Codex reported, for /status and /compact
      // What the prompt said is the thread's — unless Codex compacted after it, and its summary may have dropped it
      // (AC-R4).
      if (update) said(state, standing, update, compactedHere);
      this.#save();
      return out;
    } catch (e) {
      // What its model calls spent as Codex reported them, and its context as the newest left it: a turn that failed, or
      // lost its app-server, after some keeps them in its facts.
      const u = reader.usage();
      out.usage = u.usage;
      out.context = u.context;
      // The chat is idle from its turn's end, a failed turn's too (the bug report's H8): idle from before the turn, a
      // sweep would take the thread a "continue" goes on in.
      conv.lastUsed = Date.now();
      this.#save();
      // A seeded first turn refused before any answer may go again, its seed compacted or none (`retrySeed`).
      if (seeded && !answered && !bare && e && typeof e === "object") /** @type {any} */ (e).seededUnanswered = true;
      throw e;
    } finally {
      unhook();
      this.readers.delete(entry);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * The sandbox the thread got, when it is not the one asked for: Codex makes workspace-write read-only where its own
   * sandbox is not set up, and on Windows says why. Filament leaves that setup to the person. The record says it at
   * every open; the chat is told too (the review of 11-10: only the record said it, and the person never saw why Codex
   * wrote nothing): → the notice for it, which the turn says once its session is up — said as the thread opened, ahead
   * of the session's event, a harness chat had no run to draw it on yet (the re-read of 11-11). Once for the chat
   * (`readOnlySaid`), whatever opens its thread again — a restart, an idle thread, a change of its tools —, and again
   * once a thread of it has opened able to write. Its words follow what Codex asks: under allow-all it asks nothing, so
   * what its sandbox refuses reaches nobody.
   * @param {CodexProcess} proc @param {any} opened
   * @param {{ approvalPolicy: string, sandbox: string }} want  what the thread was asked to open with
   * @param {string[]} notes @param {CodexConv} conv
   * @returns {Promise<{ type: "agent-notice", severity: string, title: string, description: string } | null>}
   */
  async #sandboxNote(proc, opened, want, notes, conv) {
    const got = String(opened?.sandbox?.type || "");
    const wanted = sandboxPolicy(want.sandbox).type;
    if (got && got !== "readOnly") conv.readOnlySaid = false;
    if (!got || got === wanted) return null;
    let why = "";
    if (process.platform === "win32" && want.sandbox === "workspace-write") {
      const r = await proc.request("windowsSandbox/readiness", undefined, 15000).catch(() => null);
      if (r?.status && r.status !== "ready") why = `: Codex's Windows sandbox is ${r.status === "notConfigured" ? "not set up" : "out of date"} (Codex's own setup turns it on; Filament never changes the machine's security setup)`;
    }
    notes.push(`codex: Codex runs this thread with a ${got} sandbox, not ${wanted}${why}`);
    if (got !== "readOnly" || conv.readOnlySaid) return null;
    const description = want.approvalPolicy === "never" ? "under the allow-all policy it asks for nothing, so the changes and commands its sandbox refuses fail there, and none comes to Filament" : "its changes and commands come to Filament to approve, one by one";
    return { type: "agent-notice", severity: "warning", title: `Codex works read-only in this chat${why}`, description };
  }

  /**
   * The archived version of this chat, for seeding a new thread (the same hook the other bridges read). Null when there
   * is nothing to seed from; never throws, as a memory failure must not stop a turn.
   * @param {any} args @param {any} acp @param {string} newestText
   */
  #archivedSeed({ format, body, headers, cwdHint, model }, acp, newestText) {
    try {
      return (
        this.archivedTranscript?.(
          { format, body, headers: headers || {}, cwdHint: cwdHint || "", model: model || "", newestText },
          { view: acp.seedView || "chat", budgetTokens: Number(acp.seedBudgetTokens) > 0 ? Number(acp.seedBudgetTokens) : 0 },
        ) || null
      );
    } catch (/** @type {any} */ e) {
      this.log("warn", `[codex] archived seed unavailable (${String(e.message).slice(0, 120)})`);
      return null;
    }
  }
}
