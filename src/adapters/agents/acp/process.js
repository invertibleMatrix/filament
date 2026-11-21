// @ts-check
// ACP's agent process: the JSON-RPC 2.0 peer every agent process is (../agent-process.js: the command, the
// environment, requests with timeouts, the agent's own requests, notifications, the kill), with ACP's handshake and
// the client capabilities Filament declares. The bridge keeps the terminals an agent runs through Filament on it.
import { RpcProcess } from "../agent-process.js";

const PROTOCOL_VERSION = 1;
const CLIENT_INFO = { name: "Filament", version: "0.1" };

// What Filament tells an agent it can do. File and terminal services are advertised only for upstreams whose
// clientBridge is "full": the agent then delegates reads, writes and commands, which Filament hands to the chat
// client's own tools (or does itself when the client has none). terminal_output asks the Claude Code adapter to
// stream command output; parameterizedModelPicker asks Cursor for per-parameter model options.
// `subagents` (HarnessV3-ACP AC1-2): an agent that runs sub-agents sends each as a session of its own, which the
// bridge routes to the turn that launched it — the sub-agent's words and calls reach its card, which the flattened
// form kept for clients that do not declare it never carried. Claude's adapter speaks ACP's sub-agents RFD for it from
// 0.93 (`subagent_update`), and lets Filament cancel each sub-agent's session alone (HarnessV4_Tasks E6).
// `elicitation` (AC2-4): the agent's questions — a form, or a link to open — reach the person: the page, the outside
// client's question tool, or nobody, said at once. Claude's adapter turns its AskUserQuestion off for a client that
// declares no form.
// `auth.terminal` (AC3-7): Filament runs an agent's own sign-in program in a terminal (the harness's Terminal pane),
// so the agent names its ways to sign in there — Claude's adapter offers its two only to a client that says so; and
// `_meta["terminal-auth"]`, Zed's older word for it, to an agent that names such a way only in that form (the review of
// 11-10), which Filament reads beside ACP's.
// `session.compaction` (AC5-7): the agent says its own compaction in ACP's compaction updates, with the summary it
// kept — Claude's adapter from 0.87, which says it as a call of its own to a client that does not declare them.
// `session.notices` (HarnessV4_Tasks C21): what the agent tells the person that is no part of its answer — Claude's
// adapter's model fallback, a hook that blocked its turn, Fast mode turned off — comes as ACP's `notice` updates, which
// Filament draws on a line of their own; to a client that does not declare them it writes them into its answer.
/** @param {{ full?: boolean }} [o] */
export function clientCapabilitiesFor({ full = false } = {}) {
  return {
    fs: { readTextFile: !!full, writeTextFile: !!full },
    terminal: !!full,
    session: { compaction: {}, notices: {} },
    subagents: {},
    elicitation: { form: {}, url: {} },
    auth: { terminal: true },
    _meta: { parameterizedModelPicker: true, terminal_output: true, "terminal-auth": true },
  };
}

export class AcpProcess extends RpcProcess {
  /** @param {import("../agent-process.js").RpcOptions & { clientCapabilities?: Record<string, unknown> | null }} o */
  constructor({ clientCapabilities = null, ...rest }) {
    super({ ...rest, name: "ACP" });
    this.clientCapabilities = clientCapabilities || clientCapabilitiesFor();
    /** terminalId -> { output, exit, promise, child } @type {Map<string, any>} */
    this.terminals = new Map();
    /** What the agent answered the handshake: its capabilities, its auth methods, its `_meta`. @type {any} */
    this.initResult = null;
    /** @type {Promise<any> | null} */
    this.initPromise = null;
    /** Who the agent says it runs as, as it last said (`_auth/status_update`, Claude's adapter). @type {any} */
    this.authStatus = null;
    // A request the agent no longer needs answered (a question its turn's end made moot) is withdrawn.
    this.on("notification", (/** @type {string} */ method, /** @type {any} */ params) => {
      if (method === "$/cancel_request") this.withdraw(params?.requestId);
      else if (method === "_auth/status_update" && params?.authStatus) this.authStatus = params.authStatus;
    });
  }

  /**
   * Who the agent runs as, once it has said (`_auth/status_update`, HarnessV3-ACP AC3-6): at once where it has, else
   * its first word on it, waited for `ms` at most or until it exits; null where it said nothing. Claude's adapter says
   * it once its own check of the login ends, a while after the handshake.
   * @param {number} ms
   * @returns {Promise<any>}
   */
  heardWho(ms) {
    if (this.authStatus || this.exited) return Promise.resolve(this.authStatus);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.off("notification", heard);
        this.off("exit", done);
        resolve(this.authStatus);
      };
      // The constructor's listener has kept the word by the time this one hears it.
      const heard = (/** @type {string} */ method) => method === "_auth/status_update" && this.authStatus && done();
      const timer = setTimeout(done, ms);
      this.on("notification", heard);
      this.on("exit", done);
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
      this.initPromise = this.request("initialize", { protocolVersion: PROTOCOL_VERSION, clientCapabilities: this.clientCapabilities, clientInfo: CLIENT_INFO }).then(
        (r) => {
          this.initResult = r;
          return r;
        },
        (e) => {
          this.initPromise = null;
          throw e;
        },
      );
    return this.waitFor(this.initPromise, { waitMs, signal, what: "its handshake" });
  }
}
