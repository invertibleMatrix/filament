// @ts-check
// A coding agent's process, whatever protocol it speaks: how its command is resolved (Cursor's Windows installer, npm
// shims), the environment it is started with (Filament's own minus the scrub list and the upstream's `envRemove`), and
// the JSON-RPC peer over its stdin/stdout — requests with timeouts, the agent's own requests answered by registered
// handlers, notifications. ACP's process (acp/process.js) and Codex's app-server (codex/app-server.js) build on it.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, statSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, isAbsolute } from "node:path";
import { killTree } from "../tools/kill-tree.js";
import { withoutOwnSwitch } from "../tools/own-programs.js";
import { withEnv } from "../tools/shell.js";
import { LINE_MAX, createLineReader, overFields } from "../../core/lines.js";
import { newerVersion } from "../../core/util.js";

// Inherited variables an agent must never see. Filament is routinely started from a coding agent's terminal, and
// `CLAUDECODE` is how Claude Code recognises that it is running inside another Claude Code session: an agent that
// inherits it (claude-agent-acp wraps Claude Code) behaves as if it were nested. The list is deliberately short — auth keys are NOT removed by default, because some agents are
// legitimately configured through an inherited key; `acp.envRemove` is where a specific installation adds more.
export const AGENT_ENV_SCRUB = Object.freeze(["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"]);
/**
 * The variables an Electron program sets for itself — the desktop app that runs Filament, or the VS Code or Cursor whose
 * terminal started it. `ELECTRON_RUN_AS_NODE` makes any Electron program started under it run as plain Node: no program
 * Filament runs may see one (HarnessV3-Native NA-D5).
 */
export const ELECTRON_VAR = /^ELECTRON_/i;
/**
 * How long an agent's requests wait, once it has exited, for its pipes to close: a process it started may hold them
 * open, and nothing more of the agent's own comes then.
 */
const CLOSE_WAIT_MS = 1000;
/**
 * How long a probe — an agent's account, its ways to sign in, a sign-out, the sessions to attach — waits for its
 * handshake (HarnessV3-FailurePoints FP-D2). A turn waits as long as it takes, until its stop (§4 B).
 */
export const PROBE_WAIT_MS = 60_000;

/** A wait its waiter's stop ended. @param {string} name @param {string} what */
const stoppedWhile = (name, what) => Object.assign(new Error(`stopped while waiting for ${name}'s answer to ${what}`), { name: "AbortError" });
/**
 * The environment an agent process is started with: Filament's own, minus the scrub list and the upstream's
 * `envRemove`, plus the upstream's own `env` (which wins, so an explicit setting is never withheld). Windows
 * environment names are case-insensitive, so the match is too there, and the upstream's `PATH` replaces the inherited
 * `Path` (`withEnv`). Returns what was removed, so a turn can say so.
 * @param {Record<string, unknown>} [extra] @param {unknown} [remove]
 * @returns {{ env: Record<string, string>, removed: string[] }}
 */
export function agentEnv(extra = {}, remove = []) {
  /** @param {unknown} k */
  const fold = (k) => (process.platform === "win32" ? String(k).toUpperCase() : String(k));
  const drop = new Set(
    [...AGENT_ENV_SCRUB, ...(Array.isArray(remove) ? remove : [])]
      .map((k) => String(k ?? "").trim())
      .filter(Boolean)
      .map(fold),
  );
  /** @type {Record<string, string>} */
  const env = {};
  /** @type {string[]} */
  const removed = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (drop.has(fold(k)) || ELECTRON_VAR.test(k)) {
      removed.push(k);
      continue;
    }
    env[k] = v;
  }
  /** @type {Record<string, string>} */
  const own = {};
  for (const [k, v] of Object.entries(extra || {})) if (v != null) own[k] = String(v);
  // Windows' switch that keeps a folder's programs out of a bare name's search is Filament's own where it set it
  // (tools/own-programs.js): an agent's shells find a folder's program as they do when the person starts the agent.
  return { env: /** @type {Record<string, string>} */ (withEnv(withoutOwnSwitch(env), own)), removed };
}

/**
 * Take the variables an Electron program sets for itself out of `env` — Filament's own, at its start, so that every
 * program it runs inherits none: a terminal's shell, git, an MCP server, a coding agent (HarnessV3-Native NA-D5).
 * Answers the names taken.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function dropElectronVars(env = process.env) {
  const taken = Object.keys(env).filter((k) => ELECTRON_VAR.test(k));
  for (const k of taken) delete env[k];
  return taken;
}

/**
 * The first `node` on a PATH, or null. Windows names the variable as it likes (`Path`), so it is found whatever its case.
 * @param {{ env?: Record<string, string | undefined>, exists?: (file: string) => boolean, win?: boolean }} [o]
 * @returns {string | null}
 */
export function pathNode({ env = process.env, exists = existsSync, win = process.platform === "win32" } = {}) {
  const list = win ? Object.entries(env).find(([k]) => k.toUpperCase() === "PATH")?.[1] : env.PATH;
  for (const raw of String(list || "").split(win ? ";" : delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const file = join(dir, win ? "node.exe" : "node");
    if (exists(file)) return file;
  }
  return null;
}

/**
 * The Node Filament runs a script with: its own — except inside the desktop app (Electron), whose `process.execPath` is
 * the app itself — there the `node` on the PATH, the one npm installed the script for; null where there is none
 * (HarnessV3-Native NA-D5).
 * @param {{ versions?: Record<string, string | undefined>, env?: Record<string, string | undefined>, exists?: (file: string) => boolean, win?: boolean }} [o]
 * @returns {string | null}
 */
export function scriptNode({ versions = process.versions, ...o } = {}) {
  return versions.electron ? pathNode(o) : process.execPath;
}

// ---------------------------------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------------------------------
/**
 * How to start a command. Cursor's Windows installer ships `agent.cmd` -> powershell -> node.exe index.js: spawning
 * the real node binary directly avoids two wrapper processes and makes stdio and process kill reliable. Of its
 * installed versions the newest runs, their numbers read as numbers (`newerVersion`); names it can't tell apart so keep
 * their order as text.
 * @param {unknown} command @param {string[]} [args]
 * @returns {{ file: string, args: string[], resolved: string }}
 */
export function resolveAgentCommand(command, args = []) {
  const cmd = String(command || "agent").trim();
  if (process.platform === "win32" && /^(agent|cursor-agent)(\.cmd|\.ps1)?$/i.test(cmd)) {
    const root = join(process.env.LOCALAPPDATA || "", "cursor-agent", "versions");
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((d) => {
          try {
            return statSync(join(root, d)).isDirectory() && existsSync(join(root, d, "node.exe")) && existsSync(join(root, d, "index.js"));
          } catch {
            return false;
          }
        })
        .sort((a, b) => (newerVersion(a, b) ? 1 : newerVersion(b, a) ? -1 : a < b ? -1 : a > b ? 1 : 0));
      const latest = versions.at(-1);
      if (latest)
        return { file: join(root, latest, "node.exe"), args: [join(root, latest, "index.js"), ...args], resolved: `cursor-agent ${latest}` };
    }
  }
  // npm's shims (`qodercli.cmd`, `gemini.cmd`, …) end with `"%dp0%\node_modules\<pkg>\<script>" %*`: run that script
  // with a node of ours (`scriptNode`) instead of cmd.exe -> node, so stdin/stdout and kill() reach the real process. A
  // shim named by its path (an agent Filament installed in a folder of its own, HarnessV3-ACP AC3-8) is read the same
  // way: Node refuses to start a `.cmd` itself. Inside the desktop app with no node on the PATH, the shim runs as it is
  // written, through cmd.exe.
  const shimByPath = isAbsolute(cmd) && /\.(cmd|bat)$/i.test(cmd);
  if (process.platform === "win32" && (shimByPath || (!isAbsolute(cmd) && !/\.(exe|com)$/i.test(cmd)))) {
    const shim = shimByPath ? shimScript(cmd) : npmShim(cmd);
    const node = shim ? scriptNode() : null;
    if (shim && node) return { file: node, args: [shim, ...args], resolved: `${cmd} (npm: ${shim.split(/[\\/]/).slice(-3).join("/")})` };
    return { file: "cmd.exe", args: ["/c", cmd, ...args], resolved: `${cmd} (via cmd.exe)` };
  }
  // A bare name the PATH lacks, found in a folder `unixDirs` adds, starts by its whole path.
  if (process.platform !== "win32" && !isAbsolute(cmd) && !cmd.includes("/") && !String(process.env.PATH || "").split(":").some((d) => d && existsSync(join(d, cmd)))) {
    const found = onPath(cmd);
    if (found) return { file: found, args, resolved: `${cmd} (${found})` };
  }
  return { file: cmd, args, resolved: cmd };
}

/**
 * Where a command is looked for elsewhere than on Windows: the PATH, then ~/.local/bin, where Cursor's and Claude Code's
 * installers put theirs — a folder the app's PATH, read as it started, lacks when the install made it since (the review
 * of 11-10: Cursor installed from Filament wasn't found until Filament started again).
 * @param {Record<string, string | undefined>} env @param {string} home
 */
export function unixDirs(env, home) {
  return [...new Set([...String(env.PATH || "").split(":").filter(Boolean), ...(home ? [join(home, ".local", "bin")] : [])])];
}

/** Where npm's shims are on Windows: npm's own folder, then the PATH. */
function npmDirs() {
  const dirs = [process.env.APPDATA ? join(process.env.APPDATA, "npm") : "", ...String(process.env.PATH || "").split(";")].filter(Boolean);
  return [...new Set(dirs)];
}
/** The script an npm shim runs, when `cmd` is one: the first shim of that name decides. @param {string} cmd @returns {string | null} */
export function npmShim(cmd) {
  for (const dir of npmDirs()) {
    const f = join(dir, `${cmd}.cmd`);
    if (existsSync(f)) return shimScript(f);
  }
  return null;
}
/** The script an npm shim (`<name>.cmd`) runs with Node, where it runs one. @param {string} file @returns {string | null} */
export function shimScript(file) {
  try {
    const m = /"%dp0%\\([^"]+\.[cm]?js)"/i.exec(readFileSync(file, "utf8"));
    const script = m ? join(dirname(file), m[1]) : "";
    return script && existsSync(script) ? script : null;
  } catch {
    return null;
  }
}
/**
 * Is a command runnable here? (PATH lookup with Windows extensions; on Windows npm's own folder too, where the shims'
 * reader finds them; Cursor's private install folder)
 * @param {unknown} cmd
 */
export function commandExists(cmd) {
  if (!cmd) return false;
  const c = String(cmd);
  if (isAbsolute(c)) return existsSync(c);
  if (process.platform === "win32" && /^(agent|cursor-agent)$/i.test(c) && existsSync(join(process.env.LOCALAPPDATA || "", "cursor-agent", "versions"))) return true;
  return !!onPath(c);
}
/** A command's file on the PATH (with Windows extensions; on Windows npm's own folder too), or null. @param {string} c */
function onPath(c) {
  const win = process.platform === "win32";
  const exts = win ? ["", ".cmd", ".exe", ".bat", ".ps1"] : [""];
  for (const dir of win ? npmDirs() : unixDirs(process.env, homedir()))
    for (const e of exts) if (existsSync(join(dir, c + e))) return join(dir, c + e);
  return null;
}
/**
 * The version of the npm package `pkg` a command runs from (HarnessV3-ACP AF3): its own package.json's, found above the
 * script the command starts — npm's shim's on Windows, as `resolveAgentCommand` runs it; elsewhere the command's real
 * path. Null where the command isn't here, or isn't that package's.
 * @param {unknown} cmd @param {string} pkg  `@scope/name`
 * @returns {string | null}
 */
export function packageVersion(cmd, pkg) {
  const c = String(cmd || "");
  if (!c) return null;
  const win = process.platform === "win32";
  const file = isAbsolute(c) ? (win && /\.(cmd|bat)$/i.test(c) ? shimScript(c) : c) : win ? npmShim(c) : onPath(c);
  let at = "";
  try {
    at = file ? realpathSync(file) : "";
  } catch {
    return null;
  }
  // Up from the script to its package's folder; a package.json on the way may be a build's own, without its name.
  for (let dir = at ? dirname(at) : ""; dir && dirname(dir) !== dir; dir = dirname(dir)) {
    const f = join(dir, "package.json");
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      if (j?.name === pkg) return j.version || null;
    } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// One agent process = one JSON-RPC peer
// ---------------------------------------------------------------------------------------------------
/**
 * @typedef {object} RpcOptions
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {Record<string, unknown>} [env]
 * @property {unknown} [envRemove]
 * @property {string} [cwd]
 * @property {(level: string, msg: string) => void} [log]
 * @property {string} [name]  the protocol's name, in a timeout's words (`ACP`, `Codex`) and, lower-case, in the log's
 * @property {boolean} [jsonrpc]  messages carry `"jsonrpc": "2.0"` (ACP); Codex's app-server leaves it out
 */
/** @typedef {{ resolve: (v: any) => void, reject: (e: any) => void, timer: any, method: string }} Pending */

export class RpcProcess extends EventEmitter {
  /** @param {RpcOptions} o */
  constructor({ command, args = [], env, envRemove = [], cwd, log = () => {}, name = "agent", jsonrpc = true }) {
    super();
    this.spec = resolveAgentCommand(command, args);
    this.env = env || {};
    this.envRemove = envRemove || [];
    /** Inherited variables withheld at start(), for the turn record. @type {string[]} */
    this.scrubbed = [];
    this.cwd = cwd;
    this.log = log;
    this.name = name;
    this.tag = name.toLowerCase();
    this.jsonrpc = jsonrpc;
    this.nextId = 1;
    /** @type {Map<number, Pending>} */
    this.pending = new Map();
    /** method -> async (params, { signal }) => result @type {Map<string, (params: any, ctx: { signal: AbortSignal }) => any>} */
    this.requestHandlers = new Map();
    /**
     * The agent's own requests still being answered, by their id: a handler's signal aborts when the agent withdraws
     * its request (ACP's `$/cancel_request`, Codex's `serverRequest/resolved`) or its process ends — a question it no
     * longer waits on is no one's to answer.
     * @type {Map<string, AbortController>}
     */
    this.answering = new Map();
    /**
     * The agent's output, a message a line (a message carrying a file is one long line, in many chunks), each held to
     * `LINE_MAX`: one past it is dropped unread (`#onOver`).
     */
    this.lines = createLineReader((line) => this.#onLine(line), { onOver: (over) => this.#onOver(over) });
    /** @type {string[]} */
    this.stderr = [];
    this.exited = false;
    /** @type {{ code?: number | null, signal?: string | null, error?: string } | null} */
    this.exitInfo = null;
    /** @type {Error | null} */
    this.lastError = null;
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
    this.child = null;
    this.startedAt = Date.now();
    this.lastUsed = Date.now();
    /** Let go of by its bridge (another login took its place, HarnessV3-ACP AC3-7): it ends once its turns do. */
    this.retire = false;
    /** Ended by Filament (`kill`, its tree killed): nothing it ran exited on its own. */
    this.ended = false;
    /**
     * When each tool call a session on the process announced began, and the turn it began in by its id, the newest
     * last (512 kept): how a stopped command is known to have run alone (`left-running.js`, HarnessV4_Tasks B13). The
     * id, never the turn: an ended turn kept here kept its whole chat alive with it (the crashes of 11-14).
     * @type {{ at: number, turn: string, id: string }[]}
     */
    this.calls = [];
  }
  /** A tool call a turn on the process announced begins now. @param {{ id: string }} turn @param {string} id */
  callBegan(turn, id) {
    this.calls.push({ at: Date.now(), turn: turn.id, id });
    if (this.calls.length > 512) this.calls.shift();
  }

  start() {
    const { env, removed } = agentEnv(this.env, this.envRemove);
    this.scrubbed = removed;
    const child = spawn(this.spec.file, this.spec.args, { cwd: this.cwd || undefined, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => this.#onData(d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => {
      this.stderr.push(String(d));
      if (this.stderr.length > 50) this.stderr.shift();
      this.log("debug", `[${this.tag} stderr] ${String(d).trim().slice(0, 300)}`);
    });
    // A dead agent must never take Filament down: stdin gets EPIPE when the agent dies mid-write, and stream errors
    // on any pipe are unhandled-exception material unless somebody listens.
    child.stdin.on("error", (e) => this.log("debug", `[${this.tag}] stdin ${/** @type {any} */ (e).code || e.message}`));
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    child.on("error", (e) => {
      this.exited = true;
      this.exitInfo = { error: e.message };
      const code = /** @type {any} */ (e).code;
      this.#fail(Object.assign(new Error(`agent could not start (${code || e.message}): ${this.spec.resolved}`), { code }));
    });
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitInfo = { code, signal };
      this.emit("exit", this.exitInfo);
      // Its requests fail, and `close` is said, once what it wrote before it exited has been read: Node can say a
      // process exited before the last of its output has come (the bug report's X4: a turn that edited a file and then
      // crashed was recorded as having changed nothing).
      // The error says the exit and the tail of what the agent wrote to stderr; `exit` holds them apart, for a turn
      // that says the exit in one line and the tail under it (HarnessV3-FailurePoints §5.2).
      const closed = () => {
        clearTimeout(timer);
        child.off("close", closed);
        const headline = `agent process exited (code ${code ?? "?"}${signal ? ", signal " + signal : ""})`;
        const stderr = this.stderr.slice(-3).join(" ").trim().slice(0, 300);
        this.#fail(Object.assign(new Error(`${headline}${stderr ? `: ${stderr}` : ""}`), { exit: { code, signal, headline, stderr } }));
        this.emit("close", this.exitInfo);
      };
      const timer = setTimeout(closed, CLOSE_WAIT_MS);
      child.once("close", closed);
    });
    return this;
  }

  /**
   * A wait that fails when the process ends during `what`, once what it wrote before has been read (the bug report's
   * X4: a turn it ended just before it exited is ended) — at once when it has ended already — and the function that
   * stops it watching. It fails as the process's requests did (`lastError`): a wait on the agent's own word has no
   * clock (HarnessV3-FailurePoints §4 B), so its process's end is what ends it.
   * @param {string} what
   * @returns {{ gone: Promise<never>, unhook: () => void }}
   */
  ending(what) {
    /** @type {() => void} */
    let unhook = () => {};
    /** @type {Promise<never>} */
    const gone = new Promise((_, reject) => {
      const onClose = () => reject(this.lastError || new Error(`the agent's process exited during ${what}`));
      if (this.exited && this.lastError) return onClose();
      this.once("close", onClose);
      unhook = () => this.off("close", onClose);
    });
    return { gone, unhook };
  }

  /** @param {Error} err */
  #fail(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    for (const c of this.answering.values()) c.abort();
    this.answering.clear();
    this.lastError = err;
  }

  /** @param {string} chunk */
  #onData(chunk) {
    this.lines.push(chunk);
  }

  /** One line of the agent's output: a JSON-RPC message. @param {string} raw */
  #onLine(raw) {
    const line = raw.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.log("debug", `[${this.tag}] non-json line: ${line.slice(0, 200)}`);
      return;
    }
    this.#dispatch(msg);
  }

  /**
   * A message past what a line holds (`LINE_MAX`), dropped unread, said by its ends (`overFields`): the agent's own
   * request is answered with a refusal, so the agent waits on nothing; Filament's request the dropped line answered
   * fails, as an answer that never came would hang its caller; any other — a notification — is lost. The log says each.
   * The stream reads on from the next line.
   * @param {import("../../core/lines.js").Over} over
   */
  #onOver(over) {
    const { id, method } = overFields(over);
    const words = `${Math.round(over.length / 2 ** 20)} MiB on one line, past the ${LINE_MAX / 2 ** 20} MiB Filament reads of one message`;
    if (typeof method === "string" && (typeof id === "number" || typeof id === "string")) {
      this.log("warn", `[${this.tag}] the agent's ${method} request was ${words}: dropped unread, and refused`);
      this.#write({ id, error: { code: -32000, message: `Filament dropped this ${method} request unread: it was ${words}` } });
      return;
    }
    // An answer names Filament's own request by its number.
    const mine = typeof id === "number" && method === undefined ? id : null;
    const p = mine == null ? undefined : this.pending.get(mine);
    if (mine != null && p) {
      this.pending.delete(mine);
      clearTimeout(p.timer);
      this.log("warn", `[${this.tag}] the agent's answer to ${p.method} was ${words}: dropped unread`);
      p.reject(new Error(`${this.name} answered ${p.method} with ${words}: Filament dropped the answer unread`));
      return;
    }
    this.log("warn", `[${this.tag}] ${typeof method === "string" ? `the agent's ${method}` : "a message of the agent's"} was ${words}: dropped unread`);
  }

  /** @param {any} msg */
  #dispatch(msg) {
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const details =
          typeof msg.error.data?.details === "string" ? msg.error.data.details : typeof msg.error.data === "string" ? msg.error.data : "";
        const words = `${msg.error.message || "agent error"}${details ? `: ${details}` : msg.error.message ? "" : " " + JSON.stringify(msg.error)}`;
        p.reject(Object.assign(new Error(words), { code: msg.error.code, data: msg.error.data }));
      } else p.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id != null) {
      // A request from the agent: a permission, a file, a terminal, an approval, a question. Its handler starts at
      // once, in the order the agent sent it: Cursor sends some of its own extensions as requests right after a call's
      // end, and the turn reads them before the updates that follow.
      const h = this.requestHandlers.get(msg.method);
      if (!h) {
        this.log("warn", `[${this.tag}] agent asked for a method Filament does not implement: ${msg.method} (params: ${Object.keys(msg.params || {}).join(", ") || "none"})`);
        this.emit("unhandled", msg.method, msg.params || {});
      }
      const key = String(msg.id);
      const ctl = new AbortController();
      this.answering.set(key, ctl);
      const p = h
        ? new Promise((resolve) => resolve(h(msg.params || {}, { signal: ctl.signal })))
        : Promise.reject(Object.assign(new Error(`method not supported by Filament: ${msg.method}`), { code: -32601 }));
      p.then(
        (result) => this.#write({ id: msg.id, result: result ?? {} }),
        (e) => {
          // A JSON-RPC code is a whole number: a Node error's own ("ENOENT") goes out as a server error, its words kept —
          // sent as the code, ACP reads the answer as none and says "Invalid request" in place of what failed. A failure
          // Filament didn't mean, it logs: its refusals carry their code.
          const message = String(e?.message || e || "Filament could not answer");
          if (!Number.isInteger(e?.code)) this.log("warn", `[${this.tag}] answering the agent's ${msg.method} failed: ${message}`);
          this.#write({ id: msg.id, error: { code: Number.isInteger(e?.code) ? e.code : -32000, message } });
        },
      ).finally(() => {
        if (this.answering.get(key) === ctl) this.answering.delete(key);
      });
      return;
    }
    if (msg.method) this.emit("notification", msg.method, msg.params || {});
  }

  /** @param {Record<string, unknown>} obj */
  #write(obj) {
    const child = this.child;
    if (!child || this.exited || !child.stdin.writable || child.stdin.destroyed) return false;
    try {
      child.stdin.write(JSON.stringify(this.jsonrpc ? { jsonrpc: "2.0", ...obj } : obj) + "\n");
      return true;
    } catch (/** @type {any} */ e) {
      this.log("debug", `[${this.tag}] write failed: ${e.message}`);
      return false;
    }
  }

  /**
   * One request of the agent's, answered by its answer, its error, or its process's end. It has no clock of its own
   * (HarnessV3-FailurePoints §4 B): a probe names its own limit (`timeoutMs`, FP-D2), and a turn's stop (`signal`) ends
   * the wait — an answer that comes after is dropped, or goes to `late` where the caller has something to undo with
   * it: the agent made what was asked after the stop (a session, HarnessV4_Tasks B9). `answered` reads the answer as
   * it is read, before anything the agent said after it — the lines that came with it go to their handlers before the
   * promise's own takers run.
   * @param {string} method @param {unknown} [params] @param {number} [timeoutMs]  a probe's limit; 0, the default: none
   * @param {AbortSignal | null} [signal] @param {((result: any) => void) | null} [late]  takes the answer a stop no longer waited for
   * @param {((result: any) => void) | null} [answered]
   * @returns {Promise<any>}
   */
  request(method, params, timeoutMs = 0, signal = null, late = null, answered = null) {
    if (this.exited) return Promise.reject(this.lastError || new Error("agent process is not running"));
    if (signal?.aborted) return Promise.reject(stoppedWhile(this.name, method));
    const id = this.nextId++;
    this.lastUsed = Date.now();
    return new Promise((resolve, reject) => {
      /** @param {Error} e */
      const fail = (e) => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        p.reject(e);
      };
      const onStop = () => {
        if (!this.pending.has(id)) return;
        fail(stoppedWhile(this.name, method));
        if (late) this.pending.set(id, { resolve: late, reject: () => {}, timer: undefined, method });
      };
      const timer = timeoutMs > 0 ? setTimeout(() => fail(new Error(`${this.name} ${method} timed out after ${timeoutMs} ms`)), timeoutMs) : undefined;
      signal?.addEventListener("abort", onStop, { once: true });
      const settled = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onStop);
      };
      this.pending.set(id, {
        resolve: (/** @type {any} */ v) => (settled(), answered?.(v), resolve(v)),
        reject: (/** @type {any} */ e) => (settled(), reject(e)),
        timer,
        method,
      });
      this.#write({ id, method, params });
    });
  }
  /**
   * A wait on work the process shares (its handshake), bounded by the waiter alone: a probe's own limit (`waitMs`,
   * HarnessV3-FailurePoints FP-D2) or a turn's stop (`signal`). The work goes on for whoever waits on it next.
   * @template T @param {Promise<T>} work @param {{ waitMs?: number, signal?: AbortSignal | null, what: string }} o
   * @returns {Promise<T>}
   */
  waitFor(work, { waitMs = 0, signal = null, what }) {
    if (!(waitMs > 0) && !signal) return work;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @type {() => void} */
    let onStop = () => {};
    /** @type {Promise<never>} */
    const cut = new Promise((_, reject) => {
      if (waitMs > 0) timer = setTimeout(() => reject(new Error(`${this.name} did not finish ${what} in ${Math.round(waitMs / 1000)} s`)), waitMs);
      onStop = () => reject(stoppedWhile(this.name, what));
      if (signal?.aborted) onStop();
      else signal?.addEventListener("abort", onStop, { once: true });
    });
    return Promise.race([work, cut]).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onStop);
    });
  }
  /** @param {string} method @param {unknown} [params] */
  notify(method, params) {
    this.#write({ method, params });
  }
  /** @param {string} method @param {(params: any, ctx: { signal: AbortSignal }) => any} fn */
  onRequest(method, fn) {
    this.requestHandlers.set(method, fn);
  }
  /** The agent withdrew a request of its own: its handler's signal aborts. @param {unknown} id */
  withdraw(id) {
    this.answering.get(String(id))?.abort();
  }

  // Agents spawn helpers (Cursor's node, Claude Code itself, Codex's sandbox), so the agent goes with its tree
  // (kill-tree.js). An agent already gone (Node saw it exit, or a kill is under way) gets no taskkill. Settles once
  // the kill is carried out. The first kill says `ended` at once, before the tree is: its exit comes once taskkill is
  // done, and what the tree was doing ends now.
  /** @returns {Promise<void>} */
  kill() {
    const child = this.child;
    const gone = this.exited;
    const first = !this.ended;
    this.exited = true;
    this.ended = true;
    if (first) this.emit("ended");
    return killTree(child, { gone, warn: (what) => this.log("warn", `[${this.tag}] agent ${child?.pid}: taskkill ${what}; killing the agent directly`) });
  }
}
