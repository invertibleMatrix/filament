// @ts-check
// Codex's app-server (`codex app-server`, HarnessV3-ACP AC2-1): the JSON-RPC peer every agent process is
// (../agent-process.js), in the app-server's own dialect — no `"jsonrpc"` field on its lines — with its handshake.
// Filament speaks only the stable API: `experimentalApi` stays off, so a method Codex marks experimental is never used.
import { RpcProcess } from "../agent-process.js";
import { CODEX_SCHEMA } from "./schema-pin.js";

const CLIENT_INFO = Object.freeze({ name: "filament", title: "Filament", version: "0.1" });

/**
 * What Codex's app-server offers, in the words an ACP agent's profile has (acp/profile.js), so the Agents page and the
 * cheat sheet read it as they read the others'. It comes from the pinned protocol: the app-server's handshake declares
 * nothing. A thread takes MCP servers over HTTP and developer instructions as it starts or resumes (`config`,
 * `developerInstructions`): Filament's tools and its standing context go there (HarnessV3-ACP AC4). Codex compacts a
 * thread when asked (`thread/compact/start`) and says it did, as an item of the turn it runs (AC5-5).
 * @param {string} version  the running app-server's
 * @returns {import("../acp/profile.js").AgentProfile}
 */
export function codexProfile(version) {
  /** @param {string} m */
  const has = (m) => CODEX_SCHEMA.requests.includes(m);
  return {
    protocol: null,
    agent: { name: "codex", title: "Codex", version: version || CODEX_SCHEMA.codex },
    prompt: { image: true, audio: false, embeddedContext: false },
    mcp: { http: true, sse: false },
    sessions: {
      load: false,
      list: has("thread/list"),
      resume: has("thread/resume"),
      fork: has("thread/fork"),
      close: has("thread/unsubscribe"),
      delete: has("thread/delete"),
      additionalDirectories: false,
      subagents: CODEX_SCHEMA.items.includes("collabAgentToolCall"),
    },
    steering: has("turn/steer"),
    promptSteers: false,
    cancelKeepsWork: false,
    cachedInInput: false,
    promptQueueing: false,
    rawMessages: false,
    systemPrompt: true,
    // Its channel is its thread's developer instructions, no session's `_meta`.
    systemPromptAt: null,
    reportsCompaction: has("thread/compact/start"),
    thinkingDisplay: false,
    compactWindow: false,
    sessionEnv: false,
    account: has("account/read"),
    logout: has("account/logout"),
    auth: ["chatgpt", "apiKey"],
    // Codex signs in through its own app-server (`account/login/start`), not a program run in a terminal: its bridge
    // names its ways.
    signIns: [],
    ways: [],
  };
}

export class CodexProcess extends RpcProcess {
  /** @param {import("../agent-process.js").RpcOptions} o */
  constructor(o) {
    super({ ...o, name: "Codex", jsonrpc: false });
    /** What the app-server answered the handshake: its user agent, its home, its platform. @type {any} */
    this.initResult = null;
    /** @type {Promise<any> | null} */
    this.initPromise = null;
    /** The threads this process has loaded (started or resumed): a turn on one needs no resume. @type {Set<string>} */
    this.loaded = new Set();
    /**
     * What each loaded thread was opened with, Filament's MCP server among it: a fork of the thread for Filament's
     * summary opens with the same (HarnessV3-ACP AC5-4). @type {Map<string, any>}
     */
    this.opened = new Map();
    // A request of Codex's resolved without Filament's answer (its turn ended or was interrupted) is withdrawn.
    this.on("notification", (/** @type {string} */ method, /** @type {any} */ params) => {
      if (method === "serverRequest/resolved") this.withdraw(params?.requestId);
    });
  }

  /**
   * The handshake, once even when several callers arrive before it finishes. It has no clock (HarnessV3-FailurePoints
   * §4 B): a waiter bounds its own wait (`waitFor`), a probe by its limit, a turn by its stop.
   * @param {{ waitMs?: number, signal?: AbortSignal | null }} [o]
   * @returns {Promise<any>}
   */
  async initialize({ waitMs = 0, signal = null } = {}) {
    if (this.initResult) return this.initResult;
    if (!this.initPromise)
      this.initPromise = this.request("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: false, requestAttestation: false } }).then(
        (r) => {
          this.initResult = r || {};
          this.notify("initialized");
          return this.initResult;
        },
        (e) => {
          this.initPromise = null;
          throw e;
        },
      );
    return this.waitFor(this.initPromise, { waitMs, signal, what: "its handshake" });
  }

  /** The app-server's version, read from the user agent it answered the handshake with (`codex_…/0.154.0 (…)`). */
  get version() {
    const m = /^[^/\s]+\/(\S+)/.exec(String(this.initResult?.userAgent || ""));
    return m ? m[1] : "";
  }
}
