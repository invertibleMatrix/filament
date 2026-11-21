// @ts-check
// What a coding agent says it can do, read from its own `initialize` answer and never assumed (HarnessV3-ACP AC-D5,
// AC0-1), with what drives saw of it beside (the catalogue's), and the newest such answer per upstream, kept in the
// data folder while the upstream is configured: the Agents page shows it without starting the agent, and Filament sends
// a session method only to an agent that declares it.
import { readFileSync, writeFileSync } from "node:fs";
import { isAgentUpstream } from "../../../core/schema.js";
import { versionFrom } from "../../../core/util.js";

/**
 * @typedef {{
 *   protocol: number | null,
 *   agent: { name: string, title: string, version: string } | null,
 *   prompt: { image: boolean, audio: boolean, embeddedContext: boolean },
 *   mcp: { http: boolean, sse: boolean, declared?: boolean },
 *   sessions: { load: boolean, list: boolean, resume: boolean, fork: boolean, close: boolean, delete: boolean,
 *     additionalDirectories: boolean, subagents: boolean },
 *   steering: boolean,
 *   cancelKeepsWork: boolean,
 *   cachedInInput: boolean,
 *   promptQueueing: boolean,
 *   rawMessages: boolean,
 *   systemPrompt: boolean,
 *   systemPromptAt: "claudeCode" | "antigravity" | null,
 *   reportsCompaction: boolean,
 *   thinkingDisplay: boolean,
 *   compactWindow: boolean,
 *   sessionEnv: boolean,
 *   account: boolean,
 *   logout: boolean,
 *   auth: string[],
 *   signIns: SignInWay[],
 *   ways: OwnWay[],
 * }} AgentProfile
 */
/**
 * One of the agent's own ways to sign in that the client runs in a terminal (ACP's `AuthMethodTerminal`, HarnessV3-ACP
 * AC3-7): the agent's name for it and its words, and the arguments and variables its own program takes for it.
 * @typedef {{ id: string, name: string, description: string, args: string[], env: Record<string, string> }} SignInWay
 */
/**
 * Each of the agent's own ways to sign in, of its kind (the review of 11-10): one run in a terminal — ACP's, its
 * arguments after the agent's own program, or Zed's older `_meta["terminal-auth"]`, which names its program
 * (`command`) and its arguments whole —, one the agent carries out itself when asked (`authenticate`: ACP's `agent`,
 * the kind of a way that names none), or a key it reads from a variable (`env_var`, one variable to set).
 * @typedef {(SignInWay & { kind: "terminal", command?: string })
 *   | { kind: "agent", id: string, name: string, description: string }
 *   | { kind: "key", id: string, name: string, description: string, variable: string, label: string }} OwnWay
 */
/** A profile as kept: the agent's answer, and when it was read. @typedef {AgentProfile & { at: number }} KeptProfile */

/**
 * The version of Claude's adapter read taking Claude Code's auto-compact window in a session's options and opening
 * the session again when its settings change (its `options.settings`, in the fingerprint of what defines a session:
 * HarnessV4_Tasks A3). The adapter says its own version, so a wrapper around it counts as it; an earlier one is
 * handed no line, since nothing was read of what it does with one.
 */
export const COMPACT_WINDOW_FROM = "0.87.0";
/**
 * The version of Claude's adapter read giving Claude Code the process environment with a session's `options.env` laid
 * over it, set after the session's other options (claude-agent-acp 0.93.0, dist/acp-agent.js `newSession`): the owner's
 * list of 11-08 switches Claude Code's own ways off by its variables there. An earlier one is handed none, since nothing
 * was read of whether its session's `env` stood in place of the whole environment.
 */
export const SESSION_ENV_FROM = "0.93.0";

/** @param {any} v */
const present = (v) => v != null && v !== false;
/** @param {any} v */
const text = (v) => (typeof v === "string" ? v : "");
/** The strings of a list. @param {any} v @returns {string[]} */
const strings = (v) => (Array.isArray(v) ? v.filter((a) => typeof a === "string") : []);
/** The string values of an object. @param {any} v @returns {Record<string, string>} */
const stringValues = (v) => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {}).filter(([, x]) => typeof x === "string"));
/** A name a variable can have. */
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * One of the agent's auth methods as a way to sign in, or null where Filament can't take it: a key's that sets more
 * than one variable, or none; a kind ACP has not named (its own `_…`, or one to come).
 * @param {any} m @returns {OwnWay | null}
 */
function ownWay(m) {
  const id = text(m?.id);
  if (!id) return null;
  const named = { id, name: text(m.name) || id, description: text(m.description).trim() };
  const type = m.type ?? "agent";
  if (type === "terminal") return { kind: "terminal", ...named, args: strings(m.args), env: stringValues(m.env) };
  if (type === "env_var") {
    const needed = (Array.isArray(m.vars) ? m.vars : []).filter((v) => v?.optional !== true);
    const v = needed.length === 1 && VARIABLE.test(text(needed[0].name)) ? needed[0] : null;
    return v ? { kind: "key", ...named, variable: text(v.name), label: text(v.label) || named.name } : null;
  }
  if (type !== "agent") return null;
  // Zed's older form: the program to run in a terminal, under the method's `_meta`, offered to a client that declares it.
  const own = m._meta?.["terminal-auth"];
  if (own && typeof own === "object" && text(own.command)) return { kind: "terminal", ...named, command: text(own.command), args: strings(own.args), env: stringValues(own.env) };
  return { kind: "agent", ...named };
}

/**
 * An agent's profile from its `initialize` answer. A session method counts when the agent names it: ACP declares one
 * by an object, empty or not (`close: {}`). `subagents` is Claude's adapter's own, beside the schema's; so are the
 * `_meta` declarations, live steering and prompt queueing (Qoder declares that under `_meta.qoder`). `_meta.claudeCode`
 * says the agent is Claude's adapter, whose sessions take its own options there, its raw SDK messages among them
 * (AC1-2), and an append to Claude Code's system prompt (`_meta.systemPrompt`): the system channel Filament's standing
 * context goes through (`systemPrompt`, AC4-1; Antigravity declares one of its own, `_meta.antigravity.systemPrompt`,
 * which takes Claude's shape nowhere: `systemPromptAt` says whose) — and which says how its own compaction went, in ACP's compaction
 * updates or a call of its own (AC5-7; `reportsCompaction`: its own compaction can be asked for, AC5-5);
 * `_meta.authStatus` that it says who it runs as (`_auth/status_update`, AC3-6). Its terminal sign-ins come to a
 * client that declares it runs them (`auth.terminal`, AC3-7); `ways` are all its ways to sign in, each of its kind
 * (`OwnWay`) — a profile kept before has none, and is read again when a sign-in needs them. What no agent declares
 * comes from what a drive saw (`confirmed`, the catalogue's `confirmedOf`): that a turn it cancels keeps what it did (AC3's drive C6), and the
 * version of Claude's adapter from which its Claude Code takes how it shows its thinking (`thinkingDisplay`, AC-R2) —
 * an earlier one's may not know it —, and that the input it reports for a prompt holds what it read from its cache
 * (`cachedInInput`: updates.js `readUsage` takes it out). `compactWindow`: its sessions take the chat's compaction line as Claude Code's
 * auto-compact window (`COMPACT_WINDOW_FROM`); `sessionEnv`: its sessions take variables of their own (`SESSION_ENV_FROM`).
 * @param {any} init
 * @param {{ cancelKeepsWork?: boolean, thinkingDisplayFrom?: string | null, cachedInInput?: boolean }} [confirmed]
 * @returns {AgentProfile}
 */
/**
 * The append to a session's system prompt Filament opened it with, where its `_meta` holds one, and whose channel it
 * went in: Claude Code's (`_meta.systemPrompt`) or Antigravity's (`_meta.antigravity.systemPrompt`).
 * @param {any} meta  what a session was opened with besides its folder and its servers
 * @returns {{ prompt: any, at: "claudeCode" | "antigravity" } | null}
 */
export const promptIn = (meta) =>
  meta?._meta?.antigravity?.systemPrompt ? { prompt: meta._meta.antigravity.systemPrompt, at: "antigravity" }
  : meta?._meta?.systemPrompt ? { prompt: meta._meta.systemPrompt, at: "claudeCode" }
  : null;

/**
 * A session's `_meta` with an append to its agent's system prompt, in the agent's own channel (`systemPromptAt`):
 * Claude Code's, or Antigravity's (read in 1.4.5 signed in: a resume or load that carries one replaces the one its
 * session kept; one that carries none, or an empty one, keeps it).
 * @param {any} meta @param {any} prompt @param {"claudeCode" | "antigravity" | null} at
 */
export const withPrompt = (meta, prompt, at) =>
  at === "antigravity"
    ? { ...meta, _meta: { ...(meta?._meta || {}), antigravity: { ...(meta?._meta?.antigravity || {}), systemPrompt: prompt } } }
    : { ...meta, _meta: { ...(meta?._meta || {}), systemPrompt: prompt } };

/**
 * Whether a coding agent takes Filament's MCP server over HTTP, as its profile says — the rule toolset.js keeps: one that
 * declares no MCP capabilities at all predates the field and takes it; no profile yet, it is not known, and taken.
 * @param {AgentProfile | null | undefined} p
 */
export const takesHttpMcp = (p) => !p || p.mcp?.http === true || p.mcp?.declared !== true;

export function readProfile(init, confirmed = {}) {
  const caps = init?.agentCapabilities || {};
  const sc = caps.sessionCapabilities || {};
  const info = init?.agentInfo;
  return {
    protocol: typeof init?.protocolVersion === "number" ? init.protocolVersion : null,
    agent: info && typeof info === "object" ? { name: text(info.name), title: text(info.title), version: text(info.version) } : null,
    prompt: {
      image: caps.promptCapabilities?.image === true,
      audio: caps.promptCapabilities?.audio === true,
      embeddedContext: caps.promptCapabilities?.embeddedContext === true,
    },
    mcp: { http: caps.mcpCapabilities?.http === true, sse: caps.mcpCapabilities?.sse === true, declared: !!caps.mcpCapabilities && typeof caps.mcpCapabilities === "object" },
    sessions: {
      load: caps.loadSession === true,
      list: present(sc.list),
      resume: present(sc.resume),
      fork: present(sc.fork),
      close: present(sc.close),
      delete: present(sc.delete),
      additionalDirectories: present(sc.additionalDirectories),
      subagents: present(sc.subagents),
    },
    steering: init?._meta?.steering?.supported === true,
    cancelKeepsWork: confirmed.cancelKeepsWork === true,
    cachedInInput: confirmed.cachedInInput === true,
    promptQueueing: caps._meta?.claudeCode?.promptQueueing === true || caps._meta?.qoder?.promptQueueing === true,
    rawMessages: present(caps._meta?.claudeCode),
    systemPrompt: present(caps._meta?.claudeCode) || caps._meta?.antigravity?.systemPrompt?.append === true,
    systemPromptAt: present(caps._meta?.claudeCode) ? /** @type {const} */ ("claudeCode") : caps._meta?.antigravity?.systemPrompt?.append === true ? /** @type {const} */ ("antigravity") : null,
    reportsCompaction: present(caps._meta?.claudeCode),
    thinkingDisplay: present(caps._meta?.claudeCode) && versionFrom(info?.version, confirmed.thinkingDisplayFrom),
    compactWindow: present(caps._meta?.claudeCode) && versionFrom(info?.version, COMPACT_WINDOW_FROM),
    sessionEnv: present(caps._meta?.claudeCode) && versionFrom(info?.version, SESSION_ENV_FROM),
    account: present(caps._meta?.authStatus),
    logout: present(caps.auth?.logout),
    auth: (Array.isArray(init?.authMethods) ? init.authMethods : []).map((m) => text(m?.id)).filter(Boolean),
    signIns: (Array.isArray(init?.authMethods) ? init.authMethods : [])
      .filter((m) => m?.type === "terminal" && text(m.id))
      .map((m) => ({
        id: text(m.id),
        name: text(m.name) || text(m.id),
        description: text(m.description).trim(),
        args: Array.isArray(m.args) ? m.args.filter((a) => typeof a === "string") : [],
        env: Object.fromEntries(Object.entries(m.env && typeof m.env === "object" ? m.env : {}).filter(([, v]) => typeof v === "string")),
      })),
    ways: (Array.isArray(init?.authMethods) ? init.authMethods : []).map(ownWay).filter((w) => w !== null),
  };
}

/**
 * The agent's way to sign in that `authenticate` takes: its first that isn't a terminal sign-in, which ACP leaves to
 * the client to run and never to pass there. Null where it has none.
 * @param {any} init
 * @returns {string | null}
 */
export function authenticateMethod(init) {
  const m = (Array.isArray(init?.authMethods) ? init.authMethods : []).find((x) => x?.type !== "terminal" && text(x?.id));
  return m ? text(m.id) : null;
}

/** The newest profile per upstream, kept in a JSON file of the data folder (`acp-profiles.json`). */
export class ProfileStore {
  /** @type {Map<string, KeptProfile>} */
  #byUpstream = new Map();
  /** @param {{ file?: string | null, log?: (level: string, msg: string) => void }} [o] */
  constructor({ file = null, log = () => {} } = {}) {
    this.file = file;
    this.log = log;
    if (!file) return;
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      for (const [id, p] of Object.entries(j.profiles || {})) this.#byUpstream.set(id, p);
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT")
        log("warn", `[acp] could not read the agents' profiles from ${file} (${e.message}); each is read again when its agent starts`);
    }
  }

  /** Keep what an agent declared, read now. @param {string} upstreamId @param {AgentProfile} profile */
  put(upstreamId, profile) {
    this.#byUpstream.set(upstreamId, { ...profile, at: Date.now() });
    this.#save();
  }

  /**
   * Let go of what agents no longer configured declared: an upstream removed, or no longer an agent, takes its answer
   * with it. Called at start and on every save of the config.
   * @param {{ id: string, type?: string }[]} upstreams
   */
  retain(upstreams) {
    const agents = new Set(upstreams.filter(isAgentUpstream).map((u) => u.id));
    const gone = [...this.#byUpstream.keys()].filter((id) => !agents.has(id));
    if (!gone.length) return;
    for (const id of gone) this.#byUpstream.delete(id);
    this.log("info", `[acp] let go of what ${gone.join(", ")} declared: no longer configured`);
    this.#save();
  }

  #save() {
    if (!this.file) return;
    try {
      writeFileSync(this.file, JSON.stringify({ version: 1, profiles: Object.fromEntries(this.#byUpstream) }, null, 1));
    } catch (/** @type {any} */ e) {
      this.log("warn", `[acp] could not keep the agents' profiles: ${e.message}`);
    }
  }

  /** Every upstream's kept profile. @returns {Record<string, KeptProfile>} */
  all() {
    return Object.fromEntries(this.#byUpstream);
  }
}
