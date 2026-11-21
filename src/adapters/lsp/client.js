// @ts-check
// A language server over stdio (the Language Server Protocol 3.17; the owner's of 11-04: Filament's agents get
// definition, references, hover and symbols, and an edit's errors). It starts as an MCP server's command does — an npm
// shim's script run by Node, where it is one, so its pipes and its kill reach the real process — in the secret-free
// environment the hands get. Its messages are framed by their length in bytes (`Content-Length`). A folder's file is
// opened with the server as a request first asks of it, and sent again whole where it changed on disk since — every
// file open with it at each ask, as a server trusts an open file's text over the disk's; what the server says of each
// file's problems (`publishDiagnostics`) is kept, and only what it said of the text last sent counts. A request the
// server makes of Filament is answered as an editor with no settings answers it: its configuration from the spec's
// `settings` or empty, a capability it registers taken, an edit it asks for refused.
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { safeEnv } from "../tools/hands.js";
import { killTree } from "../tools/kill-tree.js";
import { programFile, programSpawn, withEnv } from "../tools/shell.js";
import { npmShim, scriptNode } from "../agents/agent-process.js";

/** How long a server may take to answer `initialize`: a big project's first index can take its time. */
export const LSP_START_TIMEOUT_MS = 30_000;
/** How long one request may take. */
export const LSP_REQUEST_TIMEOUT_MS = 20_000;
/** The longest a close waits for the server's `shutdown`, then for its process tree to be gone. */
export const LSP_CLOSE_WAIT_MS = 3_000;
/** The largest file opened with a server, as the code viewer reads one: past it, no server is asked of it. */
export const LSP_FILE_BYTES = 2 * 1024 * 1024;
/** The files kept open with one server: past these, the one asked of longest ago is closed. */
export const LSP_OPEN_FILES = 200;
/** A message longer than this ends the connection: no server sends one, and a stream that says so is broken. */
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const CLIENT_INFO = { name: "Filament", version: "0.1" };

/**
 * @typedef {object} LspSpec  one language server as Filament runs it
 * @property {string} name
 * @property {string} command @property {string[]} [args] @property {Record<string, string>} [env]
 * @property {Record<string, string>} languages  each file extension it serves (".ts") and its language id ("typescript")
 * @property {any} [initializationOptions]  sent with `initialize`
 * @property {Record<string, any>} [settings]  what `workspace/configuration` answers, by section ("python.analysis")
 * @property {number} [startupTimeout]  how long it may take to start and initialize, in ms (LSP_START_TIMEOUT_MS where unsaid)
 */
/**
 * @typedef {object} LspDiagnostic  a problem as the server says it, its place 0-based
 * @property {{ start: { line: number, character: number }, end: { line: number, character: number } }} range
 * @property {number} [severity]  1 an error, 2 a warning, 3 information, 4 a hint
 * @property {string} message @property {string | number} [code] @property {string} [source]
 */
/**
 * @typedef {object} LspServer
 * @property {string} name @property {string} root
 * @property {any} capabilities  what the server said it can do
 * @property {() => boolean} alive
 * @property {(method: string, params: any, o?: { timeoutMs?: number, signal?: AbortSignal | null }) => Promise<any>} request
 * @property {(path: string) => { uri: string, mark: number }} sync  the file opened with the server, or sent again where
 *   it changed on disk, and every other file open with it sent again, or closed, where it changed or went since; `mark`:
 *   where its problems stood when its text was last sent, for `diagnostics` to wait past
 * @property {(path: string, o?: { after?: number, waitMs?: number, settleMs?: number, signal?: AbortSignal | null }) => Promise<LspDiagnostic[] | null>} diagnostics
 *   the file's problems once the server spoke of it past `after` (a `sync`'s mark) — of the text last sent, where it
 *   names the text's version — and then fell quiet for `settleMs`, at once where it has been quiet that long; null where
 *   it said nothing in `waitMs`, or the wait was stopped
 * @property {(fn: (why: string) => void) => void} onExit
 * @property {() => Promise<void>} close  asked to shut down as the protocol has it, then ended
 * @property {() => Promise<void>} kill  ended at once with what it started, nothing asked — its end begins before this
 *   returns, so a process's exit handler may call it
 */

export class LspError extends Error {
  /** @param {string} message @param {{ code?: number }} [o] */
  constructor(message, { code } = {}) {
    super(message);
    this.name = "LspError";
    this.code = code;
  }
}

/** A message as it goes on the wire: its length in bytes, then the JSON. @param {any} msg */
export const frameMessage = (msg) => {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
};

/**
 * The messages in a byte stream as they complete: each chunk handed in, each whole message handed to `onMessage` —
 * a message split anywhere, a character's bytes too, waits for the rest. A header that names no length is skipped; one
 * that names more than any server sends ends the stream (`onBroken`).
 * @param {(msg: any) => void} onMessage @param {(why: string) => void} [onBroken]
 * @returns {(chunk: Buffer) => void}
 */
export function frameReader(onMessage, onBroken = () => {}) {
  /** @type {Buffer} */
  let buf = Buffer.alloc(0);
  let broken = false;
  return (chunk) => {
    if (broken) return;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const head = buf.indexOf("\r\n\r\n");
      if (head < 0) return;
      const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, head).toString("ascii"));
      const start = head + 4;
      if (!m) {
        buf = buf.subarray(start);
        continue;
      }
      const length = Number(m[1]);
      if (length > MAX_MESSAGE_BYTES) {
        broken = true;
        onBroken(`a message of ${length} bytes`);
        return;
      }
      if (buf.length < start + length) return;
      const body = buf.subarray(start, start + length).toString("utf8");
      buf = buf.subarray(start + length);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      onMessage(msg);
    }
  };
}

/**
 * The language id a server's map gives a file: by its extension as written (`.C`, C++ where case tells it from `.c`),
 * else by the first of the map's extensions it matches in any case; null where the map serves no such file.
 * @param {Record<string, string>} languages @param {string} path
 */
export function languageOf(languages, path) {
  const ext = extname(path);
  if (!ext) return null;
  if (Object.hasOwn(languages, ext)) return languages[ext];
  const key = Object.keys(languages).find((k) => k.toLowerCase() === ext.toLowerCase());
  return key === undefined ? null : languages[key];
}

/** A file's address as the server reads it. @param {string} path */
export const uriOf = (path) => pathToFileURL(resolve(path)).href;
/**
 * A file as one key, however a server spells its address: on Windows in any case — rust-analyzer says `file:///c%3A/`
 * of the file Filament opened as `file:///C:/`. @param {string} path
 */
const fileKey = (path) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
/** A file's path from the server's address of it, or null for one that is no file. @param {string} uri */
export const pathOfUri = (uri) => {
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : null;
  } catch {
    return null;
  }
};

/**
 * How the server's program starts: on Windows an npm shim (`typescript-language-server.cmd`) as its script run by Node,
 * else as an MCP server's command is found (`programSpawn`: the PATH with PATHEXT's extensions, a batch file through
 * cmd.exe).
 * @param {LspSpec} spec @param {{ cwd: string, env: Record<string, string | undefined> }} o
 * @returns {{ file: string, args: string[], verbatim: boolean }}
 */
export function lspSpawn(spec, { cwd, env }) {
  const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
  if (process.platform === "win32" && !/[\\/]/.test(spec.command)) {
    const script = npmShim(spec.command);
    const node = script ? scriptNode() : null;
    if (script && node) return { file: node, args: [script, ...args], verbatim: false };
  }
  return programSpawn(spec.command, args, { cwd, env });
}

/**
 * Whether the server's program is there to start, found as `lspSpawn` finds it: an npm shim with a Node to run its
 * script, else the file `programSpawn` starts, on the PATH of the environment it starts in.
 * @param {LspSpec} spec @param {{ cwd: string }} o  the folder it would start in
 */
export function lspFound(spec, { cwd }) {
  if (process.platform === "win32" && !/[\\/]/.test(spec.command) && npmShim(spec.command) && scriptNode()) return true;
  return programFile(spec.command, { cwd, env: withEnv(safeEnv(), spec.env) }) !== null;
}

/** The capabilities Filament says it has: what its agents ask, and the problems it reads. */
const CLIENT_CAPABILITIES = Object.freeze({
  general: { positionEncodings: ["utf-16"] },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: false, willSave: false, willSaveWaitUntil: false },
    publishDiagnostics: { relatedInformation: false, versionSupport: true, tagSupport: { valueSet: [1, 2] } },
    definition: { linkSupport: true },
    typeDefinition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
    hover: { contentFormat: ["markdown", "plaintext"] },
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
  },
  workspace: { configuration: true, workspaceFolders: true, symbol: {} },
  window: { workDoneProgress: true },
});

/**
 * The value `settings` holds at a dotted section ("python.analysis"), or the whole of it for none; null where it holds
 * nothing there.
 * @param {Record<string, any> | undefined} settings @param {unknown} section
 */
const sectionOf = (settings, section) => {
  if (!settings) return null;
  if (!section) return settings;
  if (String(section) in settings) return settings[String(section)];
  let at = /** @type {any} */ (settings);
  for (const part of String(section).split(".")) {
    if (!at || typeof at !== "object" || !(part in at)) return null;
    at = at[part];
  }
  return at;
};

/**
 * Start a language server for the folder `root` and initialize it. `signal` stops a start under way: its process is
 * ended at once, and the start fails.
 * @param {LspSpec} spec
 * @param {{ root: string, log?: (level: string, msg: string) => void, timeoutMs?: number, signal?: AbortSignal | null }} o
 * @returns {Promise<LspServer>}
 */
export async function startLsp(spec, { root, log = () => {}, timeoutMs = spec.startupTimeout || LSP_START_TIMEOUT_MS, signal = null }) {
  const stoppedWords = `language server ${spec.name} was stopped as it started`;
  if (signal?.aborted) throw new LspError(stoppedWords);
  const where = resolve(root);
  const env = withEnv(safeEnv(), spec.env);
  const run = lspSpawn(spec, { cwd: where, env });
  const proc = spawn(run.file, run.args, { cwd: where, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: run.verbatim });
  let exited = false;
  let exitNote = "";
  let stderrTail = "";
  /** @type {((why: string) => void)[]} */
  const exits = [];
  /** Settles when the server's own process has exited, or could not start. */
  const ended = new Promise((r) => {
    proc.once("exit", r);
    proc.once("error", r);
  });
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();
  const failAll = (/** @type {Error} */ e) => {
    for (const [id, p] of pending) {
      pending.delete(id);
      clearTimeout(p.timer);
      p.reject(e);
    }
  };
  const gone = (/** @type {string} */ why) => {
    if (exited) return;
    exited = true;
    exitNote = why;
    failAll(new LspError(`language server ${spec.name} ${why}`));
    for (const w of waiters.splice(0)) w();
    for (const fn of exits.splice(0)) {
      try {
        fn(why);
      } catch {}
    }
  };
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (d) => {
    stderrTail = (stderrTail + d).slice(-2000);
  });
  proc.on("error", (e) => gone(`could not start (${e.message})`));
  proc.on("exit", (code, sig) => gone(`exited (${sig || `code ${code}`})${stderrTail.trim() ? `: ${stderrTail.trim().split("\n").at(-1)}` : ""}`));
  proc.stdin?.on("error", () => {});

  /** @param {any} msg */
  const write = (msg) => {
    if (exited || !proc.stdin || proc.stdin.destroyed) throw new LspError(`language server ${spec.name} ${exitNote || "is not running"}`);
    proc.stdin.write(frameMessage(msg));
  };
  /** @param {string} method @param {any} params */
  const notify = (method, params) => write({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });

  /**
   * Per file: the newest problems said of it, the version of its text they were said of where the server names it, how
   * many times the server spoke of it, and when it last did.
   * @type {Map<string, { list: LspDiagnostic[], version: number | null, seq: number, at: number }>}
   */
  const problems = new Map();
  /** What waits on the server's next word on problems, or its end. @type {(() => void)[]} */
  const waiters = [];
  /**
   * The files open with the server, by their key, the newest asked of last: the path and address they were opened
   * under, their text as sent and its version, how many times the server had spoken of them when it was sent, and the
   * file's size and time on disk as last read.
   * @type {Map<string, { path: string, uri: string, text: string, version: number, sentAt: number, size: number, mtimeMs: number }>}
   */
  const open = new Map();
  /** @param {string} key */
  const seqOf = (key) => problems.get(key)?.seq || 0;

  /**
   * What the server asks of Filament, answered as an editor with no settings would.
   * @param {string} method @param {any} params
   */
  const answer = (method, params) => {
    if (method === "workspace/configuration") return (Array.isArray(params?.items) ? params.items : []).map((/** @type {any} */ it) => sectionOf(spec.settings, it?.section));
    if (method === "workspace/workspaceFolders") return [{ uri: uriOf(where), name: basename(where) }];
    if (method === "client/registerCapability" || method === "client/unregisterCapability" || method === "window/workDoneProgress/create") return null;
    if (method === "window/showMessageRequest") return null;
    if (method === "workspace/applyEdit") return { applied: false, failureReason: "Filament's agents change files with their own tools" };
    throw new LspError(`Filament does not answer ${method}`, { code: -32601 });
  };

  const read = frameReader(
    (msg) => {
      if (msg?.id !== undefined && msg.id !== null && !msg.method) {
        const p = pending.get(Number(msg.id));
        if (!p) return;
        pending.delete(Number(msg.id));
        clearTimeout(p.timer);
        if (msg.error) p.reject(new LspError(String(msg.error.message || "error"), { code: msg.error.code }));
        else p.resolve(msg.result);
        return;
      }
      if (msg?.method && msg.id !== undefined && msg.id !== null) {
        let reply;
        try {
          reply = { jsonrpc: "2.0", id: msg.id, result: answer(msg.method, msg.params) ?? null };
        } catch (e) {
          reply = { jsonrpc: "2.0", id: msg.id, error: { code: /** @type {any} */ (e).code ?? -32603, message: /** @type {any} */ (e).message } };
        }
        try {
          write(reply);
        } catch {}
        return;
      }
      if (msg?.method === "textDocument/publishDiagnostics" && typeof msg.params?.uri === "string") {
        const path = pathOfUri(msg.params.uri);
        if (!path) return;
        const key = fileKey(path);
        const version = Number.isInteger(msg.params.version) ? msg.params.version : null;
        problems.set(key, { list: Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [], version, seq: seqOf(key) + 1, at: Date.now() });
        for (const w of waiters.splice(0)) w();
      }
    },
    (why) => {
      log("warn", `lsp ${spec.name}: ${why}; stopping it`);
      void kill();
    },
  );
  proc.stdout?.on("data", (/** @type {Buffer} */ chunk) => read(chunk));

  /**
   * Stop the server with what it started, and settle when that is gone — never later than LSP_CLOSE_WAIT_MS. On Windows
   * the tree is taken through taskkill while the server still runs.
   */
  const kill = () => {
    if (exited) return Promise.resolve();
    const bounded = (/** @type {Promise<unknown>} */ p) => Promise.race([p, new Promise((r) => setTimeout(r, LSP_CLOSE_WAIT_MS).unref())]);
    if (process.platform === "win32" && proc.pid) return bounded(Promise.all([killTree(proc, { warn: (what) => log("warn", `lsp ${spec.name}: taskkill ${what}; killing the server directly`) }), ended])).then(() => {});
    try {
      proc.stdin?.end();
      proc.kill("SIGTERM");
    } catch {}
    return bounded(ended).then(() => {});
  };

  /** @type {LspServer["request"]} */
  const request = (method, params, { timeoutMs: ms = LSP_REQUEST_TIMEOUT_MS, signal = null } = {}) => {
    if (signal?.aborted) return Promise.reject(new LspError(`${spec.name}: ${method} was stopped before it was sent`));
    const id = nextId++;
    const p = new Promise((res, rej) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new LspError(`${spec.name}: ${method} did not answer within ${Math.round(ms / 1000)} s`));
      }, ms);
      pending.set(id, { resolve: res, reject: rej, timer });
    });
    const onAbort = () => {
      const was = pending.get(id);
      if (!was) return;
      pending.delete(id);
      clearTimeout(was.timer);
      was.reject(new LspError(`${spec.name}: ${method} was stopped`));
      try {
        notify("$/cancelRequest", { id });
      } catch {}
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    } catch (e) {
      const was = pending.get(id);
      if (was) {
        pending.delete(id);
        clearTimeout(was.timer);
      }
      signal?.removeEventListener("abort", onAbort);
      return Promise.reject(e);
    }
    return p.finally(() => signal?.removeEventListener("abort", onAbort));
  };

  /** A file's text sent again whole, as its next version. @param {string} key @param {{ uri: string, text: string, version: number, sentAt: number }} o @param {string} text */
  const change = (key, o, text) => {
    o.version += 1;
    o.text = text;
    o.sentAt = seqOf(key);
    notify("textDocument/didChange", { textDocument: { uri: o.uri, version: o.version }, contentChanges: [{ text }] });
  };
  /** A file the server forgets, and its problems with it. @param {string} key */
  const forget = (key) => {
    const o = open.get(key);
    if (!o) return;
    open.delete(key);
    problems.delete(key);
    notify("textDocument/didClose", { textDocument: { uri: o.uri } });
  };

  /** @type {LspServer["sync"]} */
  const sync = (path) => {
    const full = resolve(where, path);
    const key = fileKey(full);
    // Every other file open with the server that changed on disk since goes again, one gone or grown too big is
    // forgotten: its places and its problems are the disk's, not those of the text it was opened with.
    for (const [k, o] of [...open]) {
      if (k === key) continue;
      /** @type {import("node:fs").Stats | undefined} */
      let st;
      /** @type {string | undefined} */
      let text;
      try {
        st = statSync(o.path);
        if (st.size <= LSP_FILE_BYTES && (st.size !== o.size || st.mtimeMs !== o.mtimeMs)) text = readFileSync(o.path, "utf8");
      } catch {
        st = undefined;
      }
      if (!st || st.size > LSP_FILE_BYTES) forget(k);
      else if (text !== undefined) {
        o.size = st.size;
        o.mtimeMs = st.mtimeMs;
        if (text !== o.text) change(k, o, text);
      }
    }
    const st = statSync(full);
    if (st.size > LSP_FILE_BYTES) {
      forget(key);
      throw new LspError(`${path} is ${Math.round(st.size / 1024)} KB, past the ${LSP_FILE_BYTES / 1024 / 1024} MB a language server is given`);
    }
    const text = readFileSync(full, "utf8");
    const was = open.get(key);
    if (!was) {
      const uri = uriOf(full);
      notify("textDocument/didOpen", { textDocument: { uri, languageId: languageOf(spec.languages, full) || "plaintext", version: 1, text } });
      open.set(key, { path: full, uri, text, version: 1, sentAt: seqOf(key), size: st.size, mtimeMs: st.mtimeMs });
      // The oldest asked of goes past LSP_OPEN_FILES.
      while (open.size > LSP_OPEN_FILES) forget(/** @type {string} */ (open.keys().next().value));
      return { uri, mark: seqOf(key) };
    }
    open.delete(key);
    open.set(key, was);
    was.size = st.size;
    was.mtimeMs = st.mtimeMs;
    if (was.text !== text) change(key, was, text);
    return { uri: was.uri, mark: was.sentAt };
  };

  /** @type {LspServer["diagnostics"]} */
  const diagnostics = (path, { after = 0, waitMs = 3000, settleMs = 300, signal = null } = {}) => {
    const key = fileKey(resolve(where, path));
    /** What the server said of the file past the mark, where it is of the text last sent; else null. */
    const said = () => {
      const p = problems.get(key);
      if (!p || p.seq <= after) return null;
      const o = open.get(key);
      return p.version === null || !o || p.version >= o.version ? p : null;
    };
    return new Promise((done) => {
      const start = Date.now();
      /** @type {NodeJS.Timeout | undefined} */
      let settle;
      /** @type {NodeJS.Timeout | undefined} */
      let limit;
      let over = false;
      /** @param {LspDiagnostic[] | null} v */
      const end = (v) => {
        if (over) return;
        over = true;
        clearTimeout(settle);
        clearTimeout(limit);
        signal?.removeEventListener("abort", stop);
        done(v);
      };
      const stop = () => end(null);
      // Once it has spoken past the mark, what it says until it has been quiet `settleMs` is waited for: a server may
      // speak twice of one change, the file's syntax first, then its types.
      const heard = () => {
        if (over) return;
        const p = said();
        if (exited) return end(p ? p.list : null);
        if (p) {
          clearTimeout(settle);
          const left = Math.min(settleMs - (Date.now() - p.at), waitMs - (Date.now() - start));
          if (left <= 0) return end(p.list);
          settle = setTimeout(() => end(said()?.list ?? p.list), left);
        }
        waiters.push(heard);
      };
      if (signal?.aborted) return end(null);
      signal?.addEventListener("abort", stop, { once: true });
      limit = setTimeout(() => end(said()?.list ?? null), waitMs);
      heard();
    });
  };

  // A stop ends it in the stop's own turn: an exit handler gets no later one.
  /** @type {Promise<void> | null} */
  let stopping = null;
  const stop = () => {
    stopping = kill();
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const init = await request(
      "initialize",
      {
        processId: process.pid,
        clientInfo: CLIENT_INFO,
        rootUri: uriOf(where),
        rootPath: where,
        workspaceFolders: [{ uri: uriOf(where), name: basename(where) }],
        capabilities: CLIENT_CAPABILITIES,
        ...(spec.initializationOptions !== undefined ? { initializationOptions: spec.initializationOptions } : {}),
      },
      { timeoutMs, signal },
    );
    if (signal?.aborted) throw new LspError(stoppedWords);
    signal?.removeEventListener("abort", stop);
    notify("initialized", {});
    log("debug", `lsp ${spec.name}: started in ${where}`);
    return {
      name: spec.name,
      root: where,
      capabilities: init?.capabilities || {},
      alive: () => !exited,
      request,
      sync,
      diagnostics,
      onExit: (fn) => {
        if (exited) fn(exitNote);
        else exits.push(fn);
      },
      async close() {
        if (!exited) {
          // Asked to stop as the protocol has it, then told to exit; one that does neither in time is killed.
          await Promise.race([request("shutdown", undefined, { timeoutMs: LSP_CLOSE_WAIT_MS }).catch(() => {}), ended]);
          try {
            notify("exit", undefined);
          } catch {}
          await Promise.race([ended, new Promise((r) => setTimeout(r, 500).unref())]);
        }
        await kill();
      },
      kill,
    };
  } catch (e) {
    signal?.removeEventListener("abort", stop);
    await (stopping || kill());
    if (signal?.aborted) throw new LspError(stoppedWords);
    throw e instanceof LspError ? e : new LspError(`language server ${spec.name}: ${/** @type {any} */ (e)?.message || e}`);
  }
}
