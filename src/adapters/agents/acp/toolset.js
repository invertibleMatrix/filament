// What Filament offers an agent session: the client-bridge mode actually in force, the MCP servers the session is
// handed (the upstream's own, the chat's, Filament's toolset), the folders it may read besides its own and the
// steering experiment — decided before the session is opened, and explained on the record after it, so the notes
// claim only what the agent was really given.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentTitle, nativeCapable as canGoNative } from "../../../core/catalogues.js";
import { FILAMENT_PR_LINE, FILAMENT_TRAILER } from "../../../core/schema.js";
import { ADDS_HEADER, ADDS_NOTHING_LINE } from "../../../core/conversation.js";
import { filamentsOwn } from "../../../core/browser.js";
import { acpServers, serversFor } from "../chat-servers.js";
import { mcpAddress } from "../turn-bridge.js";
import { RELAY_ADDRESS_VAR } from "./mcp-relay.js";

/** Filament's MCP relay over stdio (mcp-relay.js), for an agent that takes no MCP server over HTTP. */
export const RELAY_SCRIPT = fileURLToPath(new URL("./mcp-relay.js", import.meta.url));
/**
 * Whether the relay works here, which reaches any agent: ACP asks every agent to take MCP over stdio. Off where the
 * install lacks it, or where FILAMENT_MCP_RELAY=off keeps it off: an agent that takes no MCP server over HTTP then
 * goes without Filament's tools.
 */
export const relayHere = () => process.env.FILAMENT_MCP_RELAY !== "off" && existsSync(RELAY_SCRIPT);
/** Why the relay doesn't work here, in the record's words. */
const relayAway = () => (process.env.FILAMENT_MCP_RELAY === "off" ? "is off here (FILAMENT_MCP_RELAY=off)" : `is missing from its install (${RELAY_SCRIPT})`);

/**
 * Filament's own server as an agent that takes MCP over stdio alone starts it: the relay, on the program Filament runs on
 * — the desktop app's own as Node — given the address it carries the agent's messages to in its variable, which only
 * its own user can read: a command line anyone on the computer can, and the address holds the session's token (the
 * review of 11-10).
 * @param {string} url @param {{ execPath?: string, electron?: boolean }} [o]
 */
export const relayServer = (url, { execPath = process.execPath, electron = !!process.versions.electron } = {}) => ({
  name: "filament",
  command: execPath,
  args: [RELAY_SCRIPT],
  env: [{ name: RELAY_ADDRESS_VAR, value: url }, ...(electron ? [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }] : [])],
});

/**
 * The raw SDK messages a turn asks Claude's adapter for (HarnessV3-ACP AC1-2): the model's own messages, the tool
 * results it read, the turn's result, compaction's boundaries, a background task's end, each model call's start
 * (`status`) and Claude's word for whether it is working; and each change of the plan's windows (AC3-6), which the
 * adapter otherwise forwards only once the turn has used some context, so a window spent before the first answer
 * would go unsaid. A task's start, change and progress, and the model's thinking so far, say the work while it runs
 * (HarnessV3-FailurePoints §5.1 item 2). The conversation begun again (`conversation_reset`: a /clear, a plan's way on
 * with a fresh context) begins the session's running totals again. Never the stream's events: the updates carry those.
 */
const RAW_SDK_MESSAGES = [
  { type: "assistant" },
  { type: "user" },
  { type: "result" },
  { type: "conversation_reset" },
  { type: "system", subtype: "compact_boundary" },
  { type: "system", subtype: "task_notification" },
  { type: "system", subtype: "task_started" },
  { type: "system", subtype: "task_updated" },
  { type: "system", subtype: "task_progress" },
  { type: "system", subtype: "thinking_tokens" },
  { type: "system", subtype: "status" },
  { type: "system", subtype: "session_state_changed" },
  { type: "rate_limit_event" },
];

/**
 * What Claude Code keeps free under its auto-compact window: it makes room once its context is within this of the
 * window (HarnessV4_Tasks A3). So the window a session is given is its chat's line plus this, and Claude Code acts
 * at the line. Seen live (Claude Code under claude-agent-acp 0.87.0, the logs page has the drive): given 113,000 it
 * made room three times in one turn, each on the step that crossed 80,000 — the last count it let pass was 77,663,
 * the counts it acted at 80,350 to 82,522.
 */
export const CLAUDE_COMPACT_RESERVE = 33_000;
/**
 * The auto-compact windows Claude Code takes. One under the least is ignored whole, not raised to it: given 83,000
 * it read on to 93,852 and never made room. Its own `/autocompact` names both ends ("100k–1M tokens"); the least
 * was driven, the most was not.
 */
export const CLAUDE_COMPACT_WINDOWS = { least: 100_000, most: 1_000_000 };

/**
 * Claude Code's own sub-agent tool, by both its names (`Agent`, `Task` before it), which a session that leads a team
 * (HarnessV3-TaskGraph-v2 TG2-D40), or is offered Filament's agent tool (the owner's list of 11-08), is opened without.
 * Claude's adapter (0.87.0) adds the session's `disallowedTools` to its own.
 */
export const CLAUDE_OWN_AGENTS = Object.freeze(["Agent", "Task"]);
/**
 * Claude Code's own timers (x50), which live in its process alone — gone once Filament lets an idle agent's process go
 * (bridge.js `sweep`), or on a restart, so a wake set for later never came: a session Filament's server serves as a
 * chat's agent, a team's lead or a sub-agent is opened without them. The chat's own agent comes back with Filament's
 * come_back instead (agent/come-back.js), kept across both.
 */
export const CLAUDE_OWN_WAKES = Object.freeze(["CronCreate", "CronDelete", "CronList", "ScheduleWakeup"]);
/**
 * The variables that switch Claude Code's own ways off where Filament's tools stand in for them (the owner's list of
 * 11-08; read in claude.exe of claude-agent-sdk 0.3.300, its environment flags): its auto memory, its background tasks
 * and its artifacts.
 */
export const CLAUDE_OFF = Object.freeze({
  memory: Object.freeze(["CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1"]),
  background: Object.freeze(["CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1"]),
  artifact: Object.freeze(["CLAUDE_CODE_DISABLE_ARTIFACT", "1"]),
});
/** Claude Code's commit and pull request attribution, hidden: its `attribution` setting, where an empty text hides it. */
export const CLAUDE_NO_ATTRIBUTION = Object.freeze({ commit: "", pr: "" });
/**
 * Claude Code's attribution as Filament's (the owner's of 11-10): its commits end with Filament's co-author line, never
 * its own, and its pull requests say they were made with Filament.
 */
export const CLAUDE_FILAMENT_ATTRIBUTION = Object.freeze({ commit: FILAMENT_TRAILER, pr: FILAMENT_PR_LINE });
/**
 * The built-ins a native session of Claude Code keeps (HarnessV4_Skills_Plan S1-4): its Skill, which loads the skills of
 * its own folders and plugins. Claude's adapter takes the session's `tools` before `disableBuiltInTools`.
 */
export const CLAUDE_KEPT_IN_NATIVE = Object.freeze(["Skill"]);

/**
 * Claude Code's variable of the headers it sends with every model call, `Name: value` a line (read in claude-agent-acp
 * 0.93.0): Filament's ask to add nothing rides it (proxy-twice, core/conversation.js `addsNothing`), so a model call that comes back
 * through Filament's door, where the person's own settings point Claude Code there, gets none of Filament's additions
 * again.
 */
export const CLAUDE_HEADERS_VAR = "ANTHROPIC_CUSTOM_HEADERS";
/**
 * Claude Code's variable of the address its model calls go to, which Settings › Connect has the person set to Filament's:
 * with none set anywhere they go to Anthropic. Filament's ask rides the calls that come back to Filament's door and no
 * other (the review of 11-11: Anthropic and the person's own gateway saw it on every call).
 */
export const CLAUDE_BASE_VAR = "ANTHROPIC_BASE_URL";
/**
 * Whether an address is Filament's door, as a coding agent's own settings name where its model calls go: at any place
 * Filament is reached (`places`, the server's `ownPlaces`: every port it listens on, this machine's names and addresses,
 * where Tailscale serves it — Settings › Connect writes the address its page was opened at); else, for a bridge no server
 * told them, at the address a turn was given Filament's own server at (`base`, its `mcpBase`), on this machine. Null where
 * neither is known: nothing is asked of anyone.
 * @param {(() => { ports: number[], names: string[], origins: string[] }) | null | undefined} places @param {string | null} [base]
 * @returns {((url: string) => boolean) | null}
 */
export function filamentsDoor(places, base = null) {
  if (typeof places === "function")
    return (url) => {
      const o = places();
      return filamentsOwn(url, o.ports, o.names, o.origins);
    };
  if (!base || !URL.canParse(base)) return null;
  const at = new URL(base);
  const port = Number(at.port || (at.protocol === "https:" ? 443 : 80));
  return (url) => filamentsOwn(url, port, [at.hostname]);
}
/** Whether headers name Filament's ask, whatever they ask of it. @param {unknown} headers */
const namesAsk = (headers) => new RegExp(`^\\s*${ADDS_HEADER}\\s*:`, "im").test(String(headers ?? ""));
/**
 * Headers with Filament's ask to add nothing after them, once: the person's own kept, as Claude Code takes one variable
 * for them all. @param {unknown} own
 */
export function withAddsNothing(own) {
  const s = String(own ?? "").replace(/\s+$/, "");
  if (namesAsk(s)) return s;
  return s ? `${s}\n${ADDS_NOTHING_LINE}` : ADDS_NOTHING_LINE;
}
/**
 * A variable among those a process starts with, its name matched as its system matches it: in any case on Windows.
 * @param {Record<string, unknown>} env @param {string} name  in capitals @param {boolean} win
 */
const startedWith = (env, name, win) => (win ? Object.entries(env).find(([k]) => k.toUpperCase() === name)?.[1] : env[name]);
/**
 * Whether Claude Code's model calls go to Filament's door (`door`, `filamentsDoor`): by the address its own settings set
 * (`claudeSettingsVar`), else its process's variable (`env`: what it starts with, agent-process.js `agentEnv`); with none
 * set they go to Anthropic. Without a `cwd`, as its process stands before any session's folder is known. Never where
 * Filament's address is not known.
 * @param {{ cwd?: string | null, env?: Record<string, string | undefined>, read?: (file: string) => string, door?: ((url: string) => boolean) | null, win?: boolean }} [o]
 */
export function claudeAtDoor({ cwd = null, env = process.env, read, door = null, win = process.platform === "win32" } = {}) {
  if (!door) return false;
  const at = claudeSettingsVar(CLAUDE_BASE_VAR, { cwd, env, read }) ?? startedWith(env, CLAUDE_BASE_VAR, win);
  return typeof at === "string" && door(at.trim());
}
/**
 * The variables Claude Code's process starts with: its launch's as they are, and where its model calls go to Filament's
 * door (`claudeAtDoor`: the address its launch names, else the one it inherits, its account's own settings over both) its
 * headers with Filament's ask after the person's own — the launch's, else Filament's own environment's, which the process
 * inherits unless its upstream's `envRemove` names them (agent-process.js `agentEnv`; the review of c04dd3507: a variable
 * taken out came back with the ask). Names match as `agentEnv` matches them: in any case on Windows, the launch's own
 * name for it replaced. Calls that go anywhere else carry nothing of Filament's, and the launch comes back as it was
 * given (the review of 11-11).
 * @param {Record<string, unknown>} env
 * @param {{ base?: Record<string, string | undefined>, remove?: unknown, win?: boolean, door?: ((url: string) => boolean) | null, read?: (file: string) => string }} [o]
 */
export function claudeLaunchEnv(env, { base = process.env, remove = [], win = process.platform === "win32", door = null, read } = {}) {
  /** @param {unknown} k */
  const fold = (k) => (win ? String(k).toUpperCase() : String(k));
  /** A variable as the process starts with it: the launch's own name for it and its value there, else the one inherited. @param {string} variable */
  const starts = (variable) => {
    const name = fold(variable);
    const own = Object.keys(env).find((k) => fold(k) === name);
    const removed = Array.isArray(remove) && remove.some((k) => fold(String(k ?? "").trim()) === name);
    const inherited = removed ? undefined : Object.entries(base).find(([k]) => fold(k) === name)?.[1];
    const value = own != null ? env[own] : inherited;
    return { own, value: value == null ? undefined : String(value) };
  };
  if (!claudeAtDoor({ env: { [CLAUDE_BASE_VAR]: starts(CLAUDE_BASE_VAR).value, CLAUDE_CONFIG_DIR: starts("CLAUDE_CONFIG_DIR").value }, read, door, win: false })) return env;
  const headers = starts(CLAUDE_HEADERS_VAR);
  const rest = Object.fromEntries(Object.entries(env).filter(([k]) => k !== headers.own));
  return { ...rest, [CLAUDE_HEADERS_VAR]: withAddsNothing(headers.value) };
}
/**
 * The person's own headers a session's settings are to say for Claude Code (`ownHeaders`, null where they need say none),
 * and whether that session's model calls go to Filament's door (`atDoor`, `claudeAtDoor` by its folder's settings too:
 * a project's may send them another way than the process's variable does), where Filament's ask rides after them. Their
 * settings' own headers stand over the process's variable: at the door they are said with the ask, in the tier over
 * them, and elsewhere they stand by themselves. With none of theirs the process's variable speaks, and the settings say
 * its own headers (`env`: the variables it starts with, without Filament's ask) only where it started the other way
 * (`started`, the variables it was started with, `claudeLaunchEnv`): with the ask and this session's calls go elsewhere —
 * an empty value where it has none, which stands over the ask — or without it and they go to the door.
 * @param {{ cwd?: string | null, env?: Record<string, string | undefined>, read?: (file: string) => string, door?: ((url: string) => boolean) | null, started?: Record<string, unknown> | null, win?: boolean }} [o]
 * @returns {{ ownHeaders: string | null, atDoor: boolean }}
 */
export function claudeSessionHeaders({ cwd = null, env = process.env, read, door = null, started = null, win = process.platform === "win32" } = {}) {
  const atDoor = claudeAtDoor({ cwd, env, read, door, win });
  const theirs = claudeSettingsHeaders({ cwd, env, read });
  if (theirs != null) return { ownHeaders: atDoor ? theirs : null, atDoor };
  const asked = namesAsk(started?.[CLAUDE_HEADERS_VAR]);
  return { ownHeaders: asked === atDoor ? null : String(startedWith(env, CLAUDE_HEADERS_VAR, win) ?? ""), atDoor };
}
/**
 * A session's options with the person's own headers in its settings (`own`, `claudeSessionHeaders`), Filament's ask
 * after them where the session's model calls go to Filament's door (`atDoor`), or without any where they need say none:
 * what a session opened again from its record is given — the record keeps none of them, as they may carry a secret
 * (sessions.js `keptOpened`). One whose options hold no settings takes none.
 * @param {any} meta @param {string | null} own @param {boolean} [atDoor]
 */
export function withSettingsHeaders(meta, own, atDoor = false) {
  const options = meta?._meta?.claudeCode?.options;
  if (!options?.settings) return meta;
  const { env: _, ...settings } = options.settings;
  const next = own != null ? { ...settings, env: { [CLAUDE_HEADERS_VAR]: atDoor ? withAddsNothing(own) : own } } : settings;
  return { ...meta, _meta: { ...meta._meta, claudeCode: { ...meta._meta.claudeCode, options: { ...options, settings: next } } } };
}
/**
 * A variable the person's own Claude Code settings set (`env.<name>`), which Claude Code lays over its process's
 * variables: the session folder's local settings over its project's over the person's own (CLAUDE_CONFIG_DIR, else
 * ~/.claude); null where none sets it. A file that cannot be read or parsed sets nothing.
 * @param {string} name
 * @param {{ cwd?: string | null, env?: Record<string, string | undefined>, read?: (file: string) => string }} [o]
 * @returns {string | null}
 */
export function claudeSettingsVar(name, { cwd = null, env = process.env, read = (file) => readFileSync(file, "utf8") } = {}) {
  const user = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const files = [...(cwd ? [join(cwd, ".claude", "settings.local.json"), join(cwd, ".claude", "settings.json")] : []), join(user, "settings.json")];
  for (const file of files) {
    try {
      const v = JSON.parse(read(file))?.env?.[name];
      if (typeof v === "string") return v;
    } catch {}
  }
  return null;
}
/**
 * The headers the person's own Claude Code settings set (`env.ANTHROPIC_CUSTOM_HEADERS`, `claudeSettingsVar`); null
 * where none sets them.
 * @param {{ cwd?: string | null, env?: Record<string, string | undefined>, read?: (file: string) => string }} [o]
 * @returns {string | null}
 */
export const claudeSettingsHeaders = (o = {}) => claudeSettingsVar(CLAUDE_HEADERS_VAR, o);
/**
 * Claude Code's own tools a session of another machine's agents' chat is opened without, as Filament's own agent there
 * is without their like (agent/turn.js AGENTS_CHAT_OFF): the web, its skills, its ways of coming back later, and those
 * that reach the person's own devices, sessions and account (read in claude.exe of claude-agent-sdk 0.3.300). Its
 * artifacts and auto memory go by their variables (`CLAUDE_OFF`).
 */
export const CLAUDE_AGENTS_CHAT_OFF = Object.freeze(["WebFetch", "WebSearch", "Skill", "CronCreate", "ScheduleWakeup", "RemoteTrigger", "PushNotification", "SendMessage", "DesignSync"]);

/**
 * The auto-compact window that makes Claude Code act nearest a line: the line plus what it keeps free, within the
 * windows it takes. → the window, where Claude Code makes room under it (`at`: the line, but for a line under
 * 67,000 or over 967,000), and the record's words for a session opened with it. `side`: a side agent's own line, the
 * default share of its window, which no check between turns stands behind.
 * @param {number} line @param {boolean} [side]
 * @returns {{ window: number, at: number, words: string }}
 */
export function claudeCompactWindow(line, side = false) {
  const { least, most } = CLAUDE_COMPACT_WINDOWS;
  const window = Math.min(most, Math.max(least, line + CLAUDE_COMPACT_RESERVE));
  const at = window - CLAUDE_COMPACT_RESERVE;
  const n = (/** @type {number} */ v) => v.toLocaleString();
  const whose = side ? "its own" : "the session's";
  const words =
    at === line
      ? `acp: Claude Code is given ${side ? "its own compaction line" : "the session's compaction line"}, ${n(line)} tokens (its auto-compact window: ${n(window)}): it makes room by itself when a turn crosses it`
      : at > line
        ? `acp: Claude Code is given the least auto-compact window it takes, ${n(window)} tokens: it makes room by itself at ${n(at)}, past ${whose} ${n(line)}-token compaction line${side ? "" : ", which Filament checks between turns"}`
        : `acp: Claude Code is given the most auto-compact window it takes, ${n(window)} tokens: it makes room by itself at ${n(at)}, before ${whose} ${n(line)}-token compaction line`;
  return { window, at, words };
}

/** The upstream's own MCP servers in ACP's wire shape, for a session opened only to know it opens. @param {any} acp */
export const configuredMcpServers = (acp) => acpServers(serversFor(acp, [], { title: "", http: true, cwd: false }).servers);

/**
 * Decide what this turn offers the agent. Pure apart from the token: the caller applies `bridgeEffective` to the
 * turn and `pending` to its MCP-token map. `profile`: the agent's, with what drives saw of it (`readProfile`).
 * `line`: the chat's compaction line in tokens, where its turn names one (HarnessV4_Tasks A3) — a side agent's own
 * where `side` (its run names the default share of its window, acp-turn.js); `modelConfig`: the
 * agent's environment sets `CLAUDE_MODEL_CONFIG`. → `line`: the line the session is opened with, null where the
 * agent takes none or none was named; `compactWindow`: the window that hands it (`claudeCompactWindow`), with the
 * record's words for it (`lineWords`). `memoryWorks`: memory works in the turn's chat, its tools offered or not.
 * `trailer`: Settings › Agent loop's `sessions.commitTrailer` is on — Claude Code's attribution is Filament's line, else
 * hidden. `relay`: the install holds the relay over stdio (`relayHere`). `ownHeaders`: the person's own headers the
 * session's settings are to say for Claude Code, null where they need say none, and `atDoor`: its model calls go to
 * Filament's door, so Filament's ask rides after them (`claudeSessionHeaders`).
 */
export function planToolset({
  acp,
  upstream,
  proc,
  profile,
  turn,
  fullBridge,
  cwd,
  mcpBase,
  memoryWanted,
  memoryWorks = false,
  graphWanted = false,
  reportWanted = false,
  asksLeadWanted = "",
  teamWanted = false,
  launchWanted = false,
  readsWanted = false,
  visualsWanted = false,
  artifactsWanted = false,
  besideWanted = false,
  threadWanted = false,
  flowWanted = false,
  browserWanted = false,
  skillsWanted = false,
  spaceWanted = false,
  existingToken,
  notes,
  line = null,
  side = false,
  modelConfig = false,
  trailer = false,
  relay = relayHere(),
  ownHeaders = null,
  atDoor = false,
}) {
  const nativeCapable = canGoNative(acp, upstream);
  let pending = null;
  // Filament's toolset and its memory tools reach the agent as ONE HTTP MCP server, and an agent declares whether it
  // can take one (`agentCapabilities.mcpCapabilities.http`). The URL used to be pushed regardless, so on an agent
  // without HTTP MCP support `native` and `steering` silently never connected — and the leak rate then "measured"
  // a session that was never offered tools. An agent that omits the mcpCapabilities object altogether predates the
  // field and keeps the old behaviour: unknown is not "no".
  const mcpCaps = proc.initResult?.agentCapabilities?.mcpCapabilities;
  const mcpHttpOk = !(mcpCaps && typeof mcpCaps === "object") || mcpCaps.http === true;
  // One that takes none over HTTP takes Filament's over stdio, as ACP asks every agent to: through the relay, where the
  // install holds it (the review of 11-10). The chat's own HTTP servers still go to an agent that takes HTTP alone.
  const relayed = !mcpHttpOk && relay;
  const mcpOk = mcpHttpOk || relayed;
  // `native` switches the agent's built-in tools OFF, so it must never be in force unless Filament's replacements can
  // actually reach the agent: an agent that cannot take the MCP server would be left with no tools at all.
  const native = turn.bridge === "native" && nativeCapable && !!mcpBase && mcpOk;
  // What is actually in force, as opposed to what was configured. `native` only happens when the agent can switch
  // its built-in tools off AND Filament has an MCP base to hand it, so a configured `native` on an agent that cannot
  // honour it is really `full` — and `full`/`native` with a client that declares no tools falls back to Filament's
  // own hands. The dashboard shows this because the configured value alone would claim a guarantee the turn did
  // not get, which is the one thing a "which mode am I in" display must not do.
  const bridgeEffective = native ? "native" : fullBridge ? "full" : turn.bridge === "off" ? "off" : "prompts";
  // The upstream's own servers and the chat's (HarnessV4_Overnight_Plan OV-D15, OV-D16): ACP carries no server's
  // folder, and an HTTP one only to an agent that takes MCP over HTTP.
  const title = agentTitle(upstream);
  // Another machine's agents' chat (acp-turn.js `fenced`): none of this machine's servers, and Claude Code's own tools
  // that reach past the folder off.
  const fenced = turn.toolsAt?.agentsChat === true;
  const chat = serversFor(acp, turn.toolsAt?.mcp, { title, http: mcpHttpOk, cwd: false, fenced });
  const mcpServers = acpServers(chat.servers);
  const chatWords = [...chat.words];
  // The folders the chat adds for reading (OV-D23), to an agent that takes them: Claude Code's added directories.
  const wantDirs = Array.isArray(turn.toolsAt?.dirs) ? turn.toolsAt.dirs : [];
  const dirs = wantDirs.length && profile?.sessions?.additionalDirectories ? [...wantDirs] : [];
  if (dirs.length) chatWords.push(`acp: ${title} is given the chat's added folder${dirs.length === 1 ? "" : "s"} to read: ${dirs.join(", ")}`);
  else if (wantDirs.length)
    chatWords.push(`acp: ${title} takes no added folders (sessionCapabilities.additionalDirectories), so the chat's are not given: it reads them only as its own rules let it`);

  const mcpToken = existingToken || randomBytes(12).toString("hex");
  // Rung 2 (P6): with `steering` on, Filament's toolset is offered even though the agent keeps its own built-ins,
  // and the prompt asks it to prefer Filament's. `native` still means the built-ins are actually OFF — steering only
  // means the tools are available and requested — and the two are kept distinct everywhere, because the leak rate
  // is only a meaningful number when the agent had a choice.
  // `off` has to win. It promises the agent never interacts with the chat client, but a call to a Filament tool is
  // routed to the client by McpToolServer (which checks the client's tools, not the bridge), so steering under `off`
  // would break that promise from a mode the user explicitly chose. Both knobs sit in the same dashboard form, which
  // makes the combination easy to create by accident — so it is refused here and the record says why, rather than
  // quietly doing something the setting says it will not.
  const steeringWanted = acp.steering === true && !native;
  const steering = steeringWanted && turn.bridge !== "off" && mcpOk;
  if (steeringWanted && !steering && turn.bridge === "off")
    notes.push(
      `acp: steering is on but clientBridge is "off", which promises the chat client is never involved — steering was skipped. Use prompts or full to steer.`,
    );
  const toolsetOffered = native || steering;
  // Hands for the toolset, memory's tools whenever memory is on in a chat it works in (`memoryWanted`; the pending
  // context keeps `leftOut` for a chat Memory settings leave out, D4 of 11-01, and `confined`, whether the turn's caller
  // reaches its own project's sessions alone), the task graph's for the session's own agent, a
  // graph task's report for a sub-agent on one, ask_lead for a team's worker whose lead reads along, a team's tools for
  // an agent that leads one, Filament's agent tool for a plain chat whose session offers it, the visual tools for a chat
  // that shows them, the artifact tool for one that makes them, the team tool and the flow tool for a harness chat's
  // own agent, the browser for the agents of a chat that drives one (HarnessV4_AgentTools_Plan AT-D7), the skill tool
  // for the agents of a chat that offers skills (HarnessV4_Skills_Plan S1-1), the space tool for those of a chat whose
  // project has its Space (the owner's of 11-08, h3), and the background command for a sub-agent (h1, the owner's of
  // 11-08), whatever else it goes without.
  const subWanted = !!turn.toolsAt?.by;
  const wantMcp = mcpOk && (toolsetOffered || memoryWanted || graphWanted || reportWanted || !!asksLeadWanted || teamWanted || launchWanted || visualsWanted || artifactsWanted || besideWanted || threadWanted || flowWanted || browserWanted || skillsWanted || spaceWanted || subWanted);
  // One note for everything the missing capability cost this turn, so the record explains a `full` where `native`
  // was configured, a steering setting with nothing to measure, and memory tools that never arrived — and does not
  // claim any of them. Written only when something was actually wanted; an agent nobody asked for MCP loses nothing.
  if (!mcpOk && (turn.bridge === "native" || acp.steering === true || memoryWanted || graphWanted || reportWanted || !!asksLeadWanted || teamWanted || launchWanted || visualsWanted || artifactsWanted || besideWanted || threadWanted || flowWanted || browserWanted || skillsWanted || spaceWanted || subWanted)) {
    const lost = [
      turn.bridge === "native" && nativeCapable
        ? "the native toolset (built-in tools left on; behaving as full)"
        : null,
      acp.steering === true ? "steering (nothing offered, so no leak rate)" : null,
      memoryWanted ? "the memory tools" : null,
      graphWanted ? "the task graph's tool" : null,
      reportWanted ? "the task's report tool" : null,
      asksLeadWanted ? "ask_lead, its question to its lead" : null,
      teamWanted ? "the team's tools" : null,
      launchWanted ? "Filament's agent tool (its sub-agents, and the saved agents it may ask)" : null,
      visualsWanted ? "the visual tools (show_visual, visual_guide)" : null,
      artifactsWanted ? "the artifact tool" : null,
      besideWanted ? "the team tool (teams beside the chat)" : null,
      threadWanted ? "the thread tool (chats linked to the chat)" : null,
      flowWanted ? "the flow tool (flows beside the chat)" : null,
      browserWanted ? "the browser (the chat's Browser pane)" : null,
      skillsWanted ? "the skill tool (the chat's skills)" : null,
      spaceWanted ? "the space tool (the project's Space)" : null,
      subWanted ? "background_command (its long commands, run by Filament)" : null,
    ].filter(Boolean);
    notes.push(
      `acp: this agent declares no HTTP MCP support (mcpCapabilities.http), and Filament's relay over stdio ${relayAway()}, so Filament's MCP server was not offered: ${lost.join(", ")}`,
    );
  }
  // `native` on the pending context means "list the file tools", not "the built-ins are off" — steering needs the
  // former without the latter.
  if (wantMcp) {
    mcpServers.push(mcpHttpOk ? { type: "http", name: "filament", url: mcpAddress(mcpBase, mcpToken), headers: [] } : relayServer(mcpAddress(mcpBase, mcpToken)));
    if (relayed) notes.push(`acp: ${title} takes no MCP server over HTTP (mcpCapabilities.http): Filament's tools reach it over stdio, through Filament's relay`);
    pending = {
      cwd,
      upstream: { id: upstream.id, name: upstream.name || upstream.id, acp },
      at: Date.now(),
      native: toolsetOffered,
      graph: graphWanted,
      report: reportWanted,
      asksLead: asksLeadWanted || null,
      team: teamWanted,
      launch: launchWanted,
      reads: teamWanted && readsWanted,
      visuals: visualsWanted,
      artifacts: artifactsWanted,
      beside: besideWanted,
      thread: threadWanted,
      flow: flowWanted,
      browser: browserWanted,
      skills: skillsWanted,
      chain: turn.toolsAt?.chain ?? null,
      ...(turn.toolsAt?.leftOut ? { leftOut: true } : {}),
      confined: turn.toolsAt?.confined === true,
      // The sub-agent the session is (its envelope to its lead) and a card without the Space: the agent lists its tools
      // as the session opens, before the turn is the session's, and that list must be the one its turns list after.
      ...(turn.toolsAt?.by ? { by: turn.toolsAt.by } : {}),
      ...(turn.toolsAt?.space === false ? { space: false } : {}),
    };
  }
  // Claude's adapter takes its session options under `_meta.claudeCode`: its raw messages, and the options it hands
  // the Claude Code it runs — `--thinking-display summarized`, as recent models leave their thinking out unless asked
  // (HarnessV3-ACP AC-R2), save where the upstream hides its thoughts. Any agent's session takes `disableBuiltInTools`.
  // Asked of every session this turn opens or reopens, as the adapter reads them there.
  const thinking = profile.thinkingDisplay && acp.thoughts !== "hide" ? { extraArgs: { "thinking-display": "summarized" } } : {};
  // The chat's compaction line, as Claude Code's own auto-compact window (HarnessV4_Tasks A3): session-scoped
  // settings, written to no file. An adapter before 0.93.0 gives its Claude Code `options.settings` in place of the
  // model overrides it reads from `CLAUDE_MODEL_CONFIG`, so an agent whose environment sets that is handed none there;
  // 0.93.0, the one that takes a session's env too (`sessionEnv`), lays them over the overrides.
  const replaces = modelConfig && !profile.sessionEnv;
  const takesLine = profile.compactWindow && line != null;
  if (takesLine && replaces)
    notes.push(
      `acp: the session's compaction line (${line.toLocaleString()} tokens) was not handed to Claude Code: the agent's environment sets CLAUDE_MODEL_CONFIG, whose model overrides the session's settings would replace. Claude Code compacts at its own point; Filament checks the line between turns`,
    );
  const handed = takesLine && !replaces ? line : null;
  const given = handed != null ? claudeCompactWindow(handed, side) : null;
  // A lead hands work out with its team's agent tool alone (HarnessV3-TaskGraph-v2 TG2-D40): Claude Code's own
  // sub-agent tool starts helpers that are no worker of its team — Filament shows the lead nothing of them, the page
  // nothing, and no apply holds their work — and a lead that reached for it lost its turn to it (V2-0b's drive). So
  // does a chat's agent offered Filament's agent tool (the owner's list of 11-08, issues 5 and 6): with both, the agent
  // reached for its own helper, which Filament's wait knew nothing of. Where Filament's server is not offered, its own
  // stays. Its adapter takes the tools it blocks as a session opens; a session whose tools flip is opened again.
  // Another machine's agents' chat is opened without its web, skills, ways of coming back and reach of the person's own
  // (`CLAUDE_AGENTS_CHAT_OFF`).
  // Its own timers go wherever Filament's server serves a chat's agent, which comes back with Filament's come_back, or a
  // sub-agent, whose run ends with its report (`CLAUDE_OWN_WAKES`). A lead keeps them: no come_back stands in for them.
  const blocked = [...new Set([...(teamWanted || (launchWanted && wantMcp) ? CLAUDE_OWN_AGENTS : []), ...(((launchWanted && !teamWanted) || subWanted) && wantMcp ? CLAUDE_OWN_WAKES : []), ...(fenced ? CLAUDE_AGENTS_CHAT_OFF : [])])];
  const ownAgents = blocked.length ? { disallowedTools: blocked } : {};
  // Native mode keeps Claude Code's own Skill (HarnessV4_Skills_Plan S1-4): its adapter makes `disableBuiltInTools` an
  // empty tool list, which turns off every built-in, and takes an explicit list first — its file tools stay Filament's.
  // Another machine's agents' chat keeps none.
  const kept = native && !fenced ? { tools: [...CLAUDE_KEPT_IN_NATIVE] } : {};
  // Another machine's agents' chat (acp-turn.js `fenced`, the owner's xd-grants): its Claude Code takes the MCP servers
  // Filament hands it alone (`--strict-mcp-config`) — none of the person's user-level ones, nor the project's own file's —
  // and reads its settings from the project and its local file, never the person's own.
  const theirs = fenced ? { strictMcpConfig: true, settingSources: ["project", "local"] } : {};
  // Claude Code's own ways that Filament's tools stand in for, off where Filament offers them (the owner's list of
  // 11-08): its auto memory wherever Filament's memory works in the chat, its tools offered or not (the owner's of
  // 11-09: two memories never write), its background tasks beside the background command its agent and
  // team tools bring, or a sub-agent is given (h1) — Claude's own Agent tool, which a sub-agent keeps, then runs each
  // helper in the foreground, inside its call (read in claude.exe of claude-agent-sdk 0.3.300: the variable drops the
  // tool's `run_in_background`, and a launch runs in the background only where it is a remote one) — its artifacts
  // beside Filament's artifact tool — by the variables it reads, laid over its environment (`sessionEnv`). Another
  // machine's agents' chat has neither its auto memory nor its artifacts, offered Filament's or not. A session that
  // had them is opened again once, as its options changed.
  const offs = profile.sessionEnv
    ? Object.fromEntries(/** @type {[string, string][]} */ ([((wantMcp && memoryWanted) || memoryWorks || fenced) && CLAUDE_OFF.memory, wantMcp && (teamWanted || launchWanted || subWanted) && CLAUDE_OFF.background, ((wantMcp && artifactsWanted) || fenced) && CLAUDE_OFF.artifact].filter(Boolean)))
    : {};
  if (fenced && !profile.rawMessages)
    notes.push(`acp: ${title} takes none of Claude Code's session options, so what its own files give it (MCP servers, skills, the web) stays in another machine's agents' chat`);
  else if (fenced && !profile.sessionEnv)
    notes.push(`acp: ${title}'s adapter takes no variables of a session's own (before 0.93.0), so its own artifacts and auto memory stay on in another machine's agents' chat`);
  // Its commit and pull request attribution, never its own (the owner's rule: no Co-Authored-By line of Claude's):
  // Filament's line while the switch is on (the owner's of 11-10), else empty, which hides it — in the session settings
  // the line rides, not where CLAUDE_MODEL_CONFIG's overrides would be replaced by them. Where they cannot go, Claude
  // Code writes its own line, as its settings say: said on the record, and Filament's line is still asked in the
  // agent's standing context (app/agent-context.js).
  const attribution = trailer ? CLAUDE_FILAMENT_ATTRIBUTION : CLAUDE_NO_ATTRIBUTION;
  // The person's own headers the session's settings say for Claude Code (`ownHeaders`, `claudeSessionHeaders`), which it
  // lays over the process's variables (`claudeLaunchEnv`): Filament's ask to add nothing rides after them, in the tier
  // over them, where the session's model calls go to Filament's door — and nowhere else, theirs said as they are.
  const headers = ownHeaders != null ? { env: { [CLAUDE_HEADERS_VAR]: atDoor ? withAddsNothing(ownHeaders) : ownHeaders } } : {};
  const settings = profile.compactWindow && !replaces ? { attribution, ...(given ? { autoCompactWindow: given.window } : {}), ...headers } : null;
  if (ownHeaders != null && !settings && profile.rawMessages)
    notes.push(
      atDoor
        ? `acp: ${title}'s model calls go to Filament's door, and its session takes no settings of Filament's here: Filament's ask to add nothing (${ADDS_NOTHING_LINE}) does not ride them, and they get Filament's additions again`
        : `acp: ${title}'s model calls here go elsewhere than Filament's door, and its session takes no settings of Filament's: Filament's ask to add nothing (${ADDS_NOTHING_LINE}), which its process started with, rides them there`,
    );
  if (!settings && profile.rawMessages)
    notes.push(
      `acp: ${title}'s commit attribution could not be set (${replaces ? "the agent's environment sets CLAUDE_MODEL_CONFIG, whose model overrides the session's settings would replace" : "its adapter takes no session settings"}): its commits may end with its own Co-Authored-By line`,
    );
  const options = { ...thinking, ...ownAgents, ...kept, ...theirs, ...(Object.keys(offs).length ? { env: offs } : {}), ...(settings ? { settings } : {}) };
  const meta = {
    ...(native ? { disableBuiltInTools: true } : {}),
    ...(profile.rawMessages ? { claudeCode: { emitRawSDKMessages: RAW_SDK_MESSAGES, ...(Object.keys(options).length ? { options } : {}) } } : {}),
  };
  const sessionMeta = Object.keys(meta).length ? { _meta: meta } : {};
  return {
    nativeCapable,
    fullBridge,
    mcpOk,
    native,
    steering,
    toolsetOffered,
    wantMcp,
    mcpServers,
    mcpToken,
    sessionMeta,
    dirs,
    chatWords,
    bridgeEffective,
    pending,
    line: handed,
    compactWindow: given?.window ?? null,
    lineWords: given?.words ?? null,
  };
}

// After the session is established: what was actually offered, on the conversation and on the record.
export function noteToolset({ plan, conv, turn, offeredNow, memoryWanted, pendingMcp, notes }) {
  const { wantMcp, mcpToken, toolsetOffered, steering, native, nativeCapable, mcpOk, fullBridge } = plan;
  // What the session opened with of the chat's servers and folders: said where it opened, with it.
  if (offeredNow) notes.push(...plan.chatWords);
  if (wantMcp) {
    conv.mcpToken = mcpToken;
    // Set only when THIS turn actually handed the agent its MCP servers. Setting them on a plain reuse would make
    // `tools/list` serve file tools to an agent that was never given the URL, and would let the record claim an
    // offer that never happened — which is how a 100% leak rate gets read as evidence about a session that was
    // never offered anything at all.
    if (offeredNow) {
      conv.mcpNative = toolsetOffered;
      conv.steering = steering;
    }
    pendingMcp.delete(mcpToken);
    // Say what was actually offered. The old note claimed memory tools whenever the MCP server was attached and the
    // bridge was not native — which steering now makes false, since it attaches the server for the FILE tools. A
    // session goes on with what it opened with: one opened without memory's tools that could not be opened again since
    // has none.
    if (memoryWanted && (offeredNow || conv.toolsMemory === true))
      notes.push(
        toolsetOffered
          ? "memory: Filament's memory tools (search, sessions, load, remember, forget) are available through the same MCP server as its file tools"
          : "memory: the agent can use Filament's memory tools (search, sessions, load, remember, forget) through Filament's MCP server",
      );
  } else if (offeredNow) {
    // Opened with none of Filament's servers (its tools went — a chat Memory settings came to leave out, whose only ones
    // they were): the agent holds no address of Filament's, and the one it had finds the session no more.
    conv.mcpToken = null;
  }
  if (native) {
    notes.push(
      `acp: native toolset: the agent's built-in tools are off; Filament's MCP tools (Read, Write, Edit, Bash, Glob, Grep) run through the client (${turn.clientTools.summary().join(", ") || "no client tools: Filament's own hands"})`,
    );
  }
  // `conv.steering` is the SESSION's truth (set only when the toolset was actually handed over); `steering` is what
  // the config asks for now. They differ exactly when steering was switched on mid-conversation, and the record has
  // to say which is which rather than claim an offer that never reached the agent.
  else if (conv.steering)
    notes.push(
      `acp: steering (Rung 2 experiment): Filament's tools were offered ALONGSIDE the agent's own built-ins, with an instruction to prefer them. The agent may ignore it — the leak rate on this request says how often it did. Executed by ${turn.clientTools.summary().join(", ") || "no client tools: Filament's own hands"}`,
    );
  else if (steering)
    notes.push(
      `acp: steering is switched on, but this agent session was started before it, so it was never offered Filament's tools or the instruction — there is nothing to measure yet. It takes effect on the next new session (a new chat starts one).`,
    );
  // A capable agent that cannot take the MCP server was already explained by the mcpCapabilities note above; the
  // "only for agents that can switch their built-in tools off" reason would be the wrong one for it.
  else if (turn.bridge === "native" && !(nativeCapable && !mcpOk))
    notes.push(
      `acp: clientBridge native is only for agents that can switch their built-in tools off (Claude Code); behaving as full`,
    );
  else if (fullBridge)
    notes.push(
      `acp: client bridge full (${turn.clientTools.summary().join(", ") || "client has no tools; Filament's own hands"})`,
    );
}
