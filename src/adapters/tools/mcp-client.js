// @ts-check
// The MCP client door (HarnessV2 §5.7 `plugins.mcp`): a session names MCP servers, the loop offers their tools as
// `mcp__<server>__<tool>` and runs the calls here. Two transports — stdio (a child process, newline-delimited
// JSON-RPC, the same secret-free environment the bash hand gets) and streamable HTTP (POST per message, JSON or
// SSE answers, the server's session id echoed back, a signed-in server's token from Filament's sign-ins with each
// request, HarnessV4_Settings_Plan HS-7). Connections are pooled per session and spec, closed when idle,
// and killed with the process. Nothing here decides permissions: the loop's gate does, from the tool's
// `readOnlyHint` (a tool the server does not vouch for as read-only is treated like a command).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { safeEnv } from "./hands.js";
import { killTree } from "./kill-tree.js";
import { programSpawn, withEnv } from "./shell.js";
import { headBytes } from "../../core/text.js";
import { MediaResult, IMAGE_MAX_BYTES, imageTypeOf, imageBlock, sizeWords } from "../../core/media.js";
import { bearerChallenge, ownAuthorization } from "../../core/oauth.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TOOL_PREFIX = "mcp__";
export const MCP_CONNECT_TIMEOUT_MS = 15_000;
export const MCP_CALL_TIMEOUT_MS = 60_000;
export const MCP_IDLE_MS = 10 * 60_000;
/** How long a turn's pool waits before asking again a server that did not connect, doubled after each failure more, to the most. */
export const MCP_FAILED_WAIT_MS = 30_000;
export const MCP_FAILED_WAIT_MAX_MS = 5 * 60_000;
/** The longest a close waits for a stdio server's process tree to be gone (HarnessV3-Readiness RD1 d). */
export const MCP_CLOSE_WAIT_MS = 3_000;
const MAX_TOOLS_PER_SERVER = 100;
const MAX_RESULT_BYTES = 100_000; // a result's own ceiling in UTF-8 bytes; a caller's budget (maxBytes) is usually smaller
const CLIENT_INFO = { name: "Filament", version: "0.1" };

/**
 * @typedef {object} McpSpec  one `plugins.mcp` entry
 * @property {string} name
 * @property {string} [command] @property {string[]} [args] @property {Record<string, string>} [env] @property {string} [cwd]
 * @property {string} [url] @property {Record<string, string>} [headers]
 * @property {string} [account]  the account a remote server signs in with, none for main (HarnessV4_Space_Plan S4b)
 */
/**
 * @typedef {object} McpTool  a tool as the loop offers it
 * @property {string} name  mcp__<server>__<tool>
 * @property {string} description
 * @property {any} input_schema
 * @property {string} server @property {string} tool  the server's own name for it
 * @property {boolean} readOnly  the server vouched for it (annotations.readOnlyHint)
 */
/**
 * @typedef {object} McpConnection
 * @property {string} name @property {McpTool[]} tools @property {string} transport @property {{ name?: string, version?: string } | null} serverInfo
 * @property {string[]} dropped  tools the server listed that are not offered: their model-facing names collided after sanitising
 * @property {Capped | null} [capped]  what the server lists past the MAX_TOOLS_PER_SERVER Filament offers of one, or null
 * @property {(tool: string, args: any, o?: { timeoutMs?: number, signal?: AbortSignal | null, maxBytes?: number, redact?: ((text: string) => string) | null, raw?: boolean }) => Promise<any>} call
 *   `maxBytes`: the caller's budget for the result, its notice included (what one result may carry into a window);
 *   `redact`: applied to the server's text — a result's or an error's — before any cut; `raw`: the result as the server
 *   sent it, an error result too — a dashboard's source reads its data (HarnessV4_Space_Plan S4a) —, else its text (or a
 *   `MediaResult`), an error result thrown
 * @property {() => Promise<void>} close
 * @property {() => boolean} alive
 * @property {() => Promise<McpTool[]>} [relist]  its tools asked for again, `tools`, `dropped` and `capped` replaced: a
 *   dashboard's source asks at each read whether its tool still only reads (HarnessV4_Space_Plan S4a)
 * @property {boolean} [resources]  the server said it has resources (`capabilities.resources`): agent/mcp-resources.js
 *   lists and reads them
 * @property {(method: string, params: any, o?: { timeoutMs?: number, signal?: AbortSignal | null }) => Promise<any>} [request]
 *   one request of the server's, its result as sent: what agent/mcp-resources.js asks with
 */

/**
 * What a server lists past the tools Filament offers of one (`at`), said where it would otherwise go quietly: the names
 * of those its pages asked held, and whether it had pages after them, not asked for (`more`).
 * @typedef {{ at: number, names: string[], more: boolean }} Capped
 */

/**
 * A server's tools, page by page, as many as Filament offers; `more`: it had pages after them, not asked for. A page
 * that lists none, or a cursor asked for already, ends the listing: a server that keeps answering so would be asked
 * forever.
 * @param {(cursor: string | undefined) => Promise<any>} page  one `tools/list` page
 * @returns {Promise<{ list: any[], more: boolean }>}
 */
async function listedTools(page) {
  const list = [];
  const asked = new Set();
  /** @type {string | undefined} */
  let cursor;
  for (;;) {
    const p = await page(cursor);
    const tools = Array.isArray(p?.tools) ? p.tools : [];
    list.push(...tools);
    cursor = p?.nextCursor;
    if (!cursor || list.length >= MAX_TOOLS_PER_SERVER || !tools.length || asked.has(cursor)) break;
    asked.add(cursor);
  }
  return { list, more: !!cursor };
}

/** @param {string} name */
export const isMcpTool = (name) => typeof name === "string" && name.startsWith(MCP_TOOL_PREFIX);

/**
 * A model-facing tool name: the provider allows [A-Za-z0-9_-], 64 characters; anything else becomes `_`. The name a
 * dashboard's tool button is judged by, too (HarnessV4_AgentsSpace_Plan SA-D4).
 * @param {string} server @param {string} tool
 */
export function toolNameFor(server, tool) {
  const clean = String(tool).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${MCP_TOOL_PREFIX}${server}__${clean}`.slice(0, 64);
}

export class McpError extends Error {
  /** @param {string} message @param {{ code?: number, data?: any }} [o] */
  constructor(message, { code, data } = {}) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

/** One JSON-RPC exchange with a deadline; the transport supplies `send` and settles the pending map. */
function createRpc() {
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();
  return {
    pending,
    /** @param {string} method @param {any} params */
    request(method, params) {
      const id = nextId++;
      return { id, message: { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) } };
    },
    /** @param {number} id @param {number} timeoutMs @param {string} what */
    wait(id, timeoutMs, what) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new McpError(`${what} did not answer within ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
    },
    /** @param {any} msg */
    settle(msg) {
      if (!msg || typeof msg !== "object" || msg.id === undefined || msg.id === null) return false;
      const p = pending.get(Number(msg.id));
      if (!p) return false;
      pending.delete(Number(msg.id));
      clearTimeout(p.timer);
      if (msg.error) p.reject(new McpError(String(msg.error.message || "error"), { code: msg.error.code, data: msg.error.data }));
      else p.resolve(msg.result);
      return true;
    },
    /** @param {Error} e */
    failAll(e) {
      for (const [id, p] of pending) {
        pending.delete(id);
        clearTimeout(p.timer);
        p.reject(e);
      }
    },
  };
}

/** Room a result's budget keeps for the notice that says it was cut. */
const NOTICE_ROOM = 200;
/**
 * An image part as `read` shows one (HarnessV3-Tools TL-D17): bytes that are a PNG, JPEG, GIF or WebP, up to the
 * same limit, become an image block; the line names it either way. Bytes that are none of the four stay named only.
 * @param {any} c
 * @returns {{ line: string, block?: any }}
 */
function mcpImage(c) {
  const bytes = Buffer.from(String(c.data ?? ""), "base64");
  const type = imageTypeOf(bytes);
  const said = c.mimeType || type || "";
  if (!type) return { line: `[image ${said}]` };
  if (bytes.length > IMAGE_MAX_BYTES) return { line: `[image ${said}, ${sizeWords(bytes.length)}: past the ${IMAGE_MAX_BYTES / 1048576} MB an image may have]` };
  return { line: `[image ${said}, shown below]`, block: imageBlock(type, bytes.toString("base64")) };
}

/**
 * The text of a tools/call result: text parts joined, other parts named, and its images beside the text as a
 * `MediaResult`; an isError result is thrown. `redact` is applied to the whole text first; past `maxBytes` it is
 * then cut loudly inside that budget — an error's text too, since it reaches the model the same way.
 * @param {any} result @param {number} maxBytes @param {((text: string) => string) | null} redact
 * @returns {string | MediaResult}
 */
function resultText(result, maxBytes, redact) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  /** @type {any[]} */
  const media = [];
  const text = parts
    .map((c) => {
      if (!c || typeof c !== "object") return "";
      if (c.type === "text") return String(c.text ?? "");
      if (c.type === "image") {
        const shown = mcpImage(c);
        if (shown.block) media.push(shown.block);
        return shown.line;
      }
      if (c.type === "audio") return `[audio ${c.mimeType || ""}]`;
      if (c.type === "resource") return `[resource ${c.resource?.uri || ""}]${c.resource?.text ? `\n${c.resource.text}` : ""}`;
      if (c.type === "resource_link") return `[resource ${c.uri || ""}${c.name ? ` — ${c.name}` : ""}]`;
      return `[${c.type || "content"}]`;
    })
    .filter(Boolean)
    .join("\n");
  const raw = text || (result?.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : "");
  const whole = redact ? redact(raw) : raw;
  const limit = Math.max(NOTICE_ROOM * 5, Math.min(MAX_RESULT_BYTES, Math.floor(Number(maxBytes)) || MAX_RESULT_BYTES));
  let out = whole;
  if (Buffer.byteLength(whole) > limit) {
    const kept = headBytes(whole, limit - NOTICE_ROOM);
    out = `${kept}\n…[Filament: ${(whole.length - kept.length).toLocaleString()} more characters of this MCP result are not shown; ask the tool for a narrower result]`;
  }
  if (result?.isError) throw new McpError(out || "the tool reported an error");
  return media.length ? new MediaResult(out, media) : out;
}

/**
 * A `resources/read` result as the agent reads it (agent/mcp-resources.js): each content's text, an image beside it as
 * a tool's result has one, other bytes named — several contents each under its address — redacted and cut to
 * `maxBytes` as a tool's result is.
 * @param {any} result @param {number} maxBytes @param {((text: string) => string) | null} redact
 * @returns {string | MediaResult}
 */
export function resourceResultText(result, maxBytes, redact) {
  const contents = Array.isArray(result?.contents) ? result.contents : [];
  const several = contents.length > 1;
  const content = contents.flatMap((/** @type {any} */ c) => {
    const head = several ? [{ type: "text", text: `[${c?.uri || "resource"}${c?.mimeType ? ` (${c.mimeType})` : ""}]` }] : [];
    if (typeof c?.text === "string") return [...head, { type: "text", text: c.text }];
    if (typeof c?.blob === "string" && /^image\//i.test(String(c.mimeType || ""))) return [...head, { type: "image", data: c.blob, mimeType: c.mimeType }];
    const bytes = typeof c?.blob === "string" ? Buffer.from(c.blob, "base64").length : 0;
    return [...head, { type: "text", text: `[${c?.mimeType || "binary"} content of ${c?.uri || "the resource"}, ${sizeWords(bytes)}: not text, so not shown]` }];
  });
  return resultText({ content: content.length ? content : [{ type: "text", text: "(the resource is empty)" }] }, maxBytes, redact);
}

/**
 * A failed call's error with the session's redaction over its words: the server's own message (an unknown tool, a
 * failure it describes) is outside text like a result.
 * @param {any} e @param {((text: string) => string) | null} redact
 */
const redactedError = (e, redact) => {
  if (redact && e instanceof Error) e.message = redact(e.message);
  return e;
};

/**
 * The server's tools as the model sees them. Two tools whose names meet after sanitising and the 64-character cut keep
 * the first and name the second on `dropped`, and a tool past the MAX_TOOLS_PER_SERVER offered goes on `over`, so the
 * turn can say each rather than lose it quietly.
 * @param {string} server @param {any[]} list @param {string[]} [dropped] @param {string[]} [over]
 */
function toolsFrom(server, list, dropped = [], over = []) {
  /** @type {McpTool[]} */
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || typeof t.name !== "string" || !t.name) continue;
    if (out.length >= MAX_TOOLS_PER_SERVER) {
      over.push(t.name);
      continue;
    }
    const name = toolNameFor(server, t.name);
    if (seen.has(name)) {
      dropped.push(t.name);
      continue;
    }
    seen.add(name);
    const schema = t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} };
    out.push({
      name,
      description: String(t.description || t.title || t.name).slice(0, 2000),
      input_schema: schema.type ? schema : { type: "object", ...schema },
      server,
      tool: t.name,
      readOnly: t.annotations?.readOnlyHint === true,
    });
  }
  return out;
}

/**
 * A server's listing as a connection holds it: the tools offered, those whose names collided (`dropped`), and what it
 * lists past the tools offered (`capped`).
 * @param {string} server @param {{ list: any[], more: boolean }} listed
 */
function offered(server, { list, more }) {
  /** @type {string[]} */
  const dropped = [];
  /** @type {string[]} */
  const over = [];
  const tools = toolsFrom(server, list, dropped, over);
  return { tools, dropped, capped: over.length || more ? { at: MAX_TOOLS_PER_SERVER, names: over, more } : null };
}

/**
 * Connect over stdio: spawn, initialize, list the tools.
 * @param {McpSpec} spec @param {{ cwd: string, timeoutMs: number, log: (level: string, msg: string) => void }} o
 * @returns {Promise<McpConnection>}
 */
async function connectStdio(spec, { cwd, timeoutMs, log }) {
  const rpc = createRpc();
  const env = withEnv(safeEnv(), spec.env);
  const isWin = process.platform === "win32";
  const where = spec.cwd || cwd || process.cwd();
  // Found as a shell finds it, on the server's own PATH: `npx` is npx.cmd on Windows, run through cmd.exe (TL-D22).
  const run = programSpawn(String(spec.command), Array.isArray(spec.args) ? spec.args.map(String) : [], { cwd: where, env });
  const proc = spawn(run.file, run.args, {
    cwd: where,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: run.verbatim,
  });
  let exited = false;
  let exitNote = "";
  let stderrTail = "";
  /** Settles when the server's own process has exited, or could not start. */
  const ended = new Promise((resolve) => {
    proc.once("exit", resolve);
    proc.once("error", resolve);
  });
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (d) => {
    stderrTail = (stderrTail + d).slice(-2000);
  });
  // A failure carries what the server wrote to stderr (`data.output`, read when asked: the pipe may still be draining
  // as the exit is seen), for Settings' Test to show whole (HarnessV4_Settings_Plan HS-1).
  const output = { get output() { return stderrTail.trim(); } };
  proc.on("error", (e) => {
    exited = true;
    exitNote = `could not start (${e.message})`;
    rpc.failAll(new McpError(`MCP server ${spec.name} ${exitNote}`, { data: output }));
  });
  proc.on("exit", (code, sig) => {
    exited = true;
    exitNote = `exited (${sig || `code ${code}`})${stderrTail.trim() ? `: ${stderrTail.trim().split("\n").at(-1)}` : ""}`;
    rpc.failAll(new McpError(`MCP server ${spec.name} ${exitNote}`, { data: output }));
  });
  /** @type {import("node:readline").Interface | null} */
  let lines = null;
  if (proc.stdout) {
    lines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const s = line.trim();
      if (!s.startsWith("{")) return;
      let msg;
      try {
        msg = JSON.parse(s);
      } catch {
        return;
      }
      if (!rpc.settle(msg) && msg?.method && msg.id !== undefined) {
        // A request from the server (sampling, roots, elicitation): this client offers none of it. A server gone by
        // then hears no answer, and nobody waits on one.
        void write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Filament's MCP client does not support ${msg.method}` } }).catch(() => {});
      }
    });
  }
  const write = (msg) =>
    new Promise((resolve, reject) => {
      if (exited || !proc.stdin || proc.stdin.destroyed) return reject(new McpError(`MCP server ${spec.name} ${exitNote || "is not running"}`));
      proc.stdin.write(`${JSON.stringify(msg)}\n`, (e) => (e ? reject(new McpError(`MCP server ${spec.name}: ${e.message}`)) : resolve(undefined)));
    });
  const ask = async (method, params, ms, what) => {
    const { id, message } = rpc.request(method, params);
    const p = rpc.wait(id, ms, what);
    await write(message).catch((e) => {
      rpc.settle({ id, error: { message: e.message } });
    });
    return p;
  };
  /**
   * Stop the server with what it started, and settle when that is gone — never later than MCP_CLOSE_WAIT_MS. On
   * Windows the tree is taken first, while the server still runs: `taskkill /T` finds a process's children through
   * it, and a server that left on its stdin's end left its own children behind, holding the folder they ran in.
   * taskkill's exit is read: one that failed, or could not start, leaves the server to a direct kill, said in the log —
   * a server the pool believes gone must not keep running, nor hold its pipes open. Elsewhere the server's stdin ends
   * and it is sent SIGTERM; the close settles on its exit.
   */
  const kill = () => {
    if (exited) return Promise.resolve();
    const bounded = (/** @type {Promise<unknown>} */ p) => Promise.race([p, new Promise((r) => setTimeout(r, MCP_CLOSE_WAIT_MS).unref())]);
    if (isWin && proc.pid) {
      const killed = killTree(proc, { warn: (what) => log("warn", `mcp ${spec.name}: taskkill ${what}; killing the server directly`) });
      return bounded(Promise.all([killed, ended]));
    }
    try {
      proc.stdin?.end();
      proc.kill("SIGTERM");
    } catch {}
    return bounded(ended);
  };
  try {
    const init = await ask("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, timeoutMs, `${spec.name}: initialize`);
    await write({ jsonrpc: "2.0", method: "notifications/initialized" });
    const page = (/** @type {string | undefined} */ cursor) => ask("tools/list", cursor ? { cursor } : {}, timeoutMs, `${spec.name}: tools/list`);
    const { tools, dropped, capped } = offered(spec.name, await listedTools(page));
    return {
      name: spec.name,
      transport: "stdio",
      serverInfo: init?.serverInfo || null,
      tools,
      dropped,
      capped,
      resources: !!init?.capabilities?.resources,
      alive: () => !exited,
      async request(method, params, { timeoutMs: ms = MCP_CALL_TIMEOUT_MS, signal = null } = {}) {
        if (signal?.aborted) throw new McpError(`${spec.name}: ${method} was cancelled before it was sent`);
        const { id, message } = rpc.request(method, params);
        const onAbort = () => {
          rpc.settle({ id, error: { message: "the request was cancelled" } });
          // The server is told, as a call's stop tells it (the Hunter's find of 10-27): its work stops too.
          void write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "stopped" } }).catch(() => {});
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const p = rpc.wait(id, ms, `${spec.name}: ${method}`);
          await write(message).catch((e) => rpc.settle({ id, error: { message: e.message } }));
          return await p;
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      },
      /** @this {McpConnection} */
      async relist() {
        Object.assign(this, offered(spec.name, await listedTools(page)));
        return this.tools;
      },
      async call(tool, args, { timeoutMs: callMs = MCP_CALL_TIMEOUT_MS, signal = null, maxBytes = MAX_RESULT_BYTES, redact = null, raw = false } = {}) {
        // Stopped before it was sent: it is not sent (a listener added now would never hear the stop).
        if (signal?.aborted) throw new McpError(`${spec.name}: ${tool} was cancelled before it was sent`);
        const { id, message } = rpc.request("tools/call", { name: tool, arguments: args && typeof args === "object" ? args : {} });
        const onAbort = () => {
          rpc.settle({ id, error: { message: "the call was cancelled" } });
          // The server is told, as MCP has it: one that heeds it stops the tool's work.
          void write({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "stopped" } }).catch(() => {});
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const p = rpc.wait(id, callMs, `${spec.name}: ${tool}`);
          await write(message).catch((e) => rpc.settle({ id, error: { message: e.message } }));
          const answer = await p.catch((e) => Promise.reject(redactedError(e, redact)));
          return raw ? answer : resultText(answer, maxBytes, redact);
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      },
      async close() {
        await kill();
        lines?.close();
      },
    };
  } catch (e) {
    void kill();
    lines?.close();
    throw e instanceof McpError ? e : new McpError(`MCP server ${spec.name}: ${/** @type {any} */ (e)?.message || e}`);
  } finally {
    log("debug", `mcp ${spec.name}: stdio ${exited ? exitNote : "connected"}`);
  }
}

/**
 * The JSON-RPC messages in an HTTP answer: a JSON body, or an SSE stream's data lines, its events ended by a blank line
 * whichever line ending the server writes — CRLF, CR or LF, as SSE allows each.
 * @param {string} body @param {string} type
 */
export function messagesFromHttp(body, type) {
  if (/text\/event-stream/i.test(type)) {
    const out = [];
    for (const chunk of body.replace(/\r\n?/g, "\n").split(/\n\n+/)) {
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data) continue;
      try {
        out.push(JSON.parse(data));
      } catch {}
    }
    return out;
  }
  const t = body.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
}

/**
 * Filament's sign-ins as the client meets them (HarnessV4_Settings_Plan HS-7, HS-D88): the Authorization header for a
 * request, asked for each time — null where there is no sign-in, or the server carries its own header — and what to
 * do when the server answers 401 with a Bearer challenge: a renewal, or why there is none — `asks` where Filament holds
 * no sign-in for it (its row then offers one, HS-D83), the words where the sign-in ended or could not be renewed.
 * `account`: the account the server's place picks, "" for main (HarnessV4_Space_Plan S4b).
 * @typedef {{ header: (url: string, headers: Record<string, string> | undefined, account?: string) => Promise<string | null>,
 *   renew: (url: string, headers: Record<string, string> | undefined, account?: string) => Promise<{ ok: boolean, words?: string, asks?: boolean }> }} McpAuth
 */

/**
 * Connect over streamable HTTP: POST initialize (the session id comes back in a header), the initialized note, the
 * tool list. Each later call is one POST; the server may answer with JSON or an SSE stream that ends with the result.
 * A signed-in server's token rides each request; a 401 renews it once and asks again (HC-147), and a server that asks
 * for a sign-in Filament does not hold says so (HC-142).
 * @param {McpSpec} spec
 * @param {{ timeoutMs: number, log: (level: string, msg: string) => void, fetchImpl?: typeof fetch, auth?: McpAuth | null }} o
 * @returns {Promise<McpConnection>}
 */
async function connectHttp(spec, { timeoutMs, log, fetchImpl = fetch, auth = null }) {
  const url = String(spec.url);
  const host = new URL(url).host;
  const own = ownAuthorization(spec.headers);
  let sessionId = "";
  let nextId = 1;
  let closed = false;
  let lost = false;
  /** The request's headers, with the sign-in's token where Filament holds one. */
  const headersNow = async () => {
    const bearer = auth && !own ? await auth.header(url, spec.headers, spec.account || "") : null;
    return { bearer, headers: { ...(sessionId ? { "mcp-session-id": sessionId } : {}), ...(spec.headers || {}), ...(bearer ? { authorization: bearer } : {}) } };
  };
  /** @param {any} message @param {number} ms @param {string} what @param {AbortSignal | null} [signal] */
  const post = async (message, ms, what, signal = null) => {
    for (let renewed = false; ; renewed = true) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ms);
      const onAbort = () => ctl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const { bearer, headers } = await headersNow();
        let res;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL_VERSION, ...headers },
            body: JSON.stringify(message),
            signal: ctl.signal,
          });
        } catch (/** @type {any} */ e) {
          if (ctl.signal.aborted) throw new McpError(signal?.aborted ? `${what} was cancelled` : `${what} did not answer within ${Math.round(ms / 1000)} s`);
          throw new McpError(`${what}: ${host} could not be reached (${e?.cause?.code || e?.message || "network error"})`);
        }
        const sid = res.headers.get("mcp-session-id");
        if (sid) sessionId = sid;
        const type = res.headers.get("content-type") || "";
        const body = await res.text();
        if (res.status === 401 && !own && (bearer || bearerChallenge(res.headers.get("www-authenticate")))) {
          const r = !auth ? { ok: false, asks: true } : renewed ? { ok: false, words: `${host} refused its renewed sign-in: sign in again in Library › Plugins & Connectors` } : await auth.renew(url, spec.headers, spec.account || "");
          if (r.ok) continue;
          // A connection whose sign-in is gone is not used again: the next turn connects anew, and says why it cannot.
          lost = true;
          if (r.asks || !r.words) throw new McpError(`${what}: ${host} needs you to sign in (Library › Plugins & Connectors › Sign in)`, { data: { signIn: true } });
          throw new McpError(`${what}: ${r.words}`, { data: { signIn: true, words: r.words } });
        }
        if (res.status >= 400) {
          const err = messagesFromHttp(body, type).find((m) => m?.error)?.error;
          // The JSON-RPC error's code where the body has one: "method not found" behind a 4xx is still that.
          throw new McpError(`${what}: HTTP ${res.status}${err?.message ? ` — ${err.message}` : body.trim() ? ` — ${body.trim().slice(0, 200)}` : ""}`, typeof err?.code === "number" ? { code: err.code } : {});
        }
        if (message.id === undefined) return null;
        const reply = messagesFromHttp(body, type).find((m) => m && Number(m.id) === Number(message.id));
        if (!reply) throw new McpError(`${what}: the server answered without a result for request ${message.id}`);
        if (reply.error) throw new McpError(String(reply.error.message || "error"), { code: reply.error.code, data: reply.error.data });
        return reply.result;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
  };
  const request = (method, params) => ({ jsonrpc: "2.0", id: nextId++, method, ...(params !== undefined ? { params } : {}) });
  const init = await post(request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }), timeoutMs, `${spec.name}: initialize`);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, timeoutMs, `${spec.name}: initialized`).catch(() => {});
  const page = (/** @type {string | undefined} */ cursor) => post(request("tools/list", cursor ? { cursor } : {}), timeoutMs, `${spec.name}: tools/list`);
  const { tools, dropped, capped } = offered(spec.name, await listedTools(page));
  log("debug", `mcp ${spec.name}: http connected${sessionId ? " (session)" : ""}`);
  return {
    name: spec.name,
    transport: "http",
    serverInfo: init?.serverInfo || null,
    tools,
    dropped,
    capped,
    resources: !!init?.capabilities?.resources,
    alive: () => !closed && !lost,
    request: (method, params, { timeoutMs: ms = MCP_CALL_TIMEOUT_MS, signal = null } = {}) => post(request(method, params), ms, `${spec.name}: ${method}`, signal),
    /** @this {McpConnection} */
    async relist() {
      Object.assign(this, offered(spec.name, await listedTools(page)));
      return this.tools;
    },
    async call(tool, args, { timeoutMs: callMs = MCP_CALL_TIMEOUT_MS, signal = null, maxBytes = MAX_RESULT_BYTES, redact = null, raw = false } = {}) {
      // Stopped before it was sent: it is not sent.
      if (signal?.aborted) throw new McpError(`${spec.name}: ${tool} was cancelled before it was sent`);
      const message = request("tools/call", { name: tool, arguments: args && typeof args === "object" ? args : {} });
      // Stopped while it runs: the server is told, as MCP has it, besides the request let go.
      const onAbort = () => void post({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: message.id, reason: "stopped" } }, timeoutMs, `${spec.name}: cancelled`).catch(() => {});
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const answer = await post(message, callMs, `${spec.name}: ${tool}`, signal).catch((e) => Promise.reject(redactedError(e, redact)));
        return raw ? answer : resultText(answer, maxBytes, redact);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
    async close() {
      closed = true;
      if (!sessionId) return;
      try {
        await fetchImpl(url, { method: "DELETE", headers: (await headersNow()).headers });
      } catch {}
    },
  };
}

/**
 * Connect one server by its spec. `auth`: Filament's sign-ins, for a server reached over HTTP.
 * @param {McpSpec} spec
 * @param {{ cwd?: string, timeoutMs?: number, log?: (level: string, msg: string) => void, fetchImpl?: typeof fetch, auth?: McpAuth | null }} [o]
 * @returns {Promise<McpConnection>}
 */
export function connectMcp(spec, { cwd = "", timeoutMs = MCP_CONNECT_TIMEOUT_MS, log = () => {}, fetchImpl, auth = null } = {}) {
  if (spec.url) return connectHttp(spec, { timeoutMs, log, fetchImpl, auth });
  return connectStdio(spec, { cwd, timeoutMs, log });
}

/** The spec's identity for the pool: every field that changes what the server is. @param {McpSpec} spec */
export function specKey(spec) {
  // The account it signs in with (HarnessV4_Space_Plan S4b): two places on two accounts of one server are two servers.
  return createHash("sha256").update(JSON.stringify({ n: spec.name, c: spec.command || "", a: spec.args || [], e: spec.env || {}, w: spec.cwd || "", u: spec.url || "", h: spec.headers || {}, ...(spec.account ? { ac: spec.account } : {}) })).digest("hex").slice(0, 16);
}

/** How long a server's last listing stands for it once its slot is no longer asked for: the longest cache life (an hour). */
const LISTED_KEEP_MS = 3_600_000;

/**
 * A server that does not answer now, as `was` last listed itself: its tools, what it said of itself and of its
 * resources, and each call or request refused in words. `down`: why it did not answer.
 * @param {McpConnection} was @param {string} problem @returns {McpConnection & { down: string }}
 */
function down(was, problem) {
  const refuse = async () => {
    throw new Error(`MCP server ${was.name} did not answer this turn (${problem.split("\n")[0].slice(0, 200)}): its tools are as it last listed them, and none of them can be called until it answers again`);
  };
  return {
    name: was.name,
    tools: was.tools,
    transport: was.transport,
    serverInfo: was.serverInfo,
    dropped: was.dropped,
    capped: was.capped ?? null,
    call: refuse,
    close: async () => {},
    alive: () => false,
    ...(was.resources ? { resources: true, request: refuse } : {}),
    down: problem,
  };
}

/**
 * Connections pooled per session and spec: a turn asks for its servers and gets the live ones, connecting what is
 * missing, side by side; a spec that changed replaces its connection; idle ones close after `idleMs`; everything dies
 * with the process. A server that fails to connect is reported, not retried within the same turn; with `failedWaitMs`
 * (a turn's pool: the slowness of 11-01 — every turn waited out a dead server's connect before its first request) it
 * is never waited for again: it is asked again behind a turn once `failedWaitMs` has passed, twice as long after each
 * failure more to MCP_FAILED_WAIT_MAX_MS, and its tools come with the next turn that asks once it answered; a spec
 * that changed is another server, asked at once. Without it (a Space's press, the person's own) every ask tries
 * again. `auth`: Filament's
 * sign-ins, which a server's token comes from with each request (HS-7), so a renewed token reaches a pooled connection.
 * `keepListed` (a turn's pool): a server that answered before and does not now is offered as it last listed itself — its
 * tools, and so the request's tools and its prompt's line, as they were, which the provider's cache holds (the cache
 * audit's finding of 11-07: a server down for one turn moved them twice) — and a call to it answers that it is down
 * (`down`). A spec that changed is another server: it has nothing listed yet.
 * @param {{ log?: (level: string, msg: string) => void, idleMs?: number, connect?: typeof connectMcp, now?: () => number, auth?: McpAuth | null, failedWaitMs?: number, keepListed?: boolean }} [o]
 */
export function createMcpPool({ log = () => {}, idleMs = MCP_IDLE_MS, connect = connectMcp, now = Date.now, auth = null, failedWaitMs = 0, keepListed = false } = {}) {
  /** @type {Map<string, { key: string, conn: McpConnection, usedAt: number }>} */
  const live = new Map();
  /**
   * The connection each slot last had, by its spec, while `keepListed`: what it listed stands for it while it is down —
   * kept while its slot is asked for within the longest a provider keeps a cache (`LISTED_KEEP_MS`): past it, there is
   * no cache left to hold. @type {Map<string, { key: string, conn: McpConnection, usedAt: number }>}
   */
  const listed = new Map();
  /** Connects in flight, so two turns of one session asking at once share one server instead of leaking one. @type {Map<string, { key: string, promise: Promise<McpConnection> }>} */
  const connecting = new Map();
  /**
   * Each server that last failed to connect, by its spec (`specKey`) — every session's and worker's alike —, while
   * `failedWaitMs` holds it back: why, until when, and the wait it was given.
   * `signIn`: it asks to be signed in to again, which no wait mends.
   * @type {Map<string, { problem: string, until: number, wait: number, signIn: boolean }>}
   */
  const failed = new Map();
  /**
   * Each connection's calls under way: a call is no idleness — a dashboard's button has no clock (HarnessV4_Space_Plan
   * S4a) and may run past `idleMs` — so the sweep never closes a connection in the middle of one. A request counts
   * too: a resources list reads page after page (mcp_resources).
   * @type {WeakMap<McpConnection, { calls: number }>}
   */
  const busy = new WeakMap();
  /** A connection whose calls are counted, once. @param {McpConnection} conn */
  const counted = (conn) => {
    if (busy.has(conn)) return conn;
    const b = { calls: 0 };
    busy.set(conn, b);
    const call = conn.call.bind(conn);
    conn.call = /** @type {McpConnection["call"]} */ (async (...a) => {
      b.calls++;
      try {
        return await call(...a);
      } finally {
        b.calls--;
      }
    });
    if (conn.request) {
      const request = conn.request.bind(conn);
      conn.request = /** @type {NonNullable<McpConnection["request"]>} */ (async (...a) => {
        b.calls++;
        try {
          return await request(...a);
        } finally {
          b.calls--;
        }
      });
    }
    return conn;
  };
  const sweep = () => {
    const cutoff = now() - idleMs;
    for (const [k, v] of live) {
      // At work: its idle time starts once its calls end.
      if (v.conn.alive() && (busy.get(v.conn)?.calls || 0) > 0) {
        v.usedAt = now();
        continue;
      }
      if (v.usedAt < cutoff || !v.conn.alive()) {
        live.delete(k);
        v.conn.close().catch(() => {});
      }
    }
    // A failure long past and not asked about since is forgotten: the next ask starts from the first wait.
    for (const [k, f] of failed) if (f.until + MCP_FAILED_WAIT_MAX_MS < now()) failed.delete(k);
    for (const [k, l] of listed) if (l.usedAt + LISTED_KEEP_MS < now()) listed.delete(k);
  };
  const timer = setInterval(sweep, Math.min(idleMs, 60_000));
  timer.unref?.();
  /** Close every connection, and settle when each has gone (a stdio server's whole tree, RD1 d). */
  const closeAll = async () => {
    clearInterval(timer);
    const closing = [];
    for (const [k, v] of live) {
      live.delete(k);
      closing.push(v.conn.close().catch(() => {}));
    }
    await Promise.all(closing);
  };
  // The last resort: an exit handler runs no later turn of the event loop, but each close starts its kill at once.
  process.once("exit", closeAll);
  /**
   * One server of a session, connected. @param {string} slot @param {McpSpec} spec @param {string} cwd @param {number} timeoutMs
   * @returns {Promise<{ name: string, conn: McpConnection | null, problem: string | null, ms: number, fresh: boolean }>}
   */
  /**
   * A slot's server connected: one connect, shared with whoever asks for the same spec while it is on its way; kept
   * live once it answers, held back once it fails (`failedWaitMs`).
   * @param {string} slot @param {McpSpec} spec @param {string} key @param {string} cwd @param {number} timeoutMs
   * @returns {{ promise: Promise<McpConnection>, shared: boolean }}
   */
  const attempt = (slot, spec, key, cwd, timeoutMs) => {
    const inFlight = connecting.get(slot);
    if (inFlight && inFlight.key === key) return { promise: inFlight.promise, shared: true };
    const promise = connect(spec, { cwd, timeoutMs, log, auth })
      .then(
        (c) => {
          const conn = counted(c);
          const raced = live.get(slot);
          if (raced && raced.conn !== conn) raced.conn.close().catch(() => {});
          live.set(slot, { key, conn, usedAt: now() });
          if (keepListed) listed.set(slot, { key, conn, usedAt: now() });
          failed.delete(key);
          return conn;
        },
        (/** @type {any} */ e) => {
          if (failedWaitMs > 0) {
            const before = failed.get(key);
            const wait = before ? Math.min(MCP_FAILED_WAIT_MAX_MS, before.wait * 2) : failedWaitMs;
            failed.set(key, { problem: String(e?.message || e), until: now() + wait, wait, signIn: e?.data?.signIn === true });
          }
          throw e;
        },
      )
      .finally(() => {
        if (connecting.get(slot)?.promise === promise) connecting.delete(slot);
      });
    connecting.set(slot, { key, promise });
    return { promise, shared: false };
  };
  /**
   * One server of a session, connected. @param {string} slot @param {McpSpec} spec @param {string} cwd @param {number} timeoutMs
   * @returns {Promise<{ name: string, conn: McpConnection | null, problem: string | null, ms: number, fresh: boolean }>}
   */
  const one = async (slot, spec, cwd, timeoutMs) => {
    const key = specKey(spec);
    const have = live.get(slot);
    const t0 = now();
    if (have && have.key === key && have.conn.alive()) {
      have.usedAt = now();
      const l = listed.get(slot);
      if (l) l.usedAt = have.usedAt;
      return { name: spec.name, conn: have.conn, problem: null, ms: 0, fresh: false };
    }
    if (have) {
      live.delete(slot);
      have.conn.close().catch(() => {});
    }
    /**
     * Down now: as it last listed itself, where it did with this spec (`keepListed`), else nothing. One that asks to be
     * signed in to again is left out, as it is until it is: no turn of its own mends it.
     * @param {string} problem @param {boolean} signIn
     */
    const downAs = (problem, signIn) => {
      const was = signIn ? null : listed.get(slot);
      if (!was || was.key !== key) return null;
      was.usedAt = now();
      return down(was.conn, problem);
    };
    // One known not to answer is never waited for: once its wait is over it is asked again behind the turn, and the
    // next turn that asks has it if it answered.
    const held = failed.get(key);
    if (held) {
      const due = t0 >= held.until;
      if (due && connecting.get(slot)?.key !== key) attempt(slot, spec, key, cwd, timeoutMs).promise.catch(() => {});
      const when = due ? "asked again now, behind this turn" : `asked again in ${Math.ceil((held.until - t0) / 1000)} s`;
      const problem = `${held.problem} — ${when}`;
      return { name: spec.name, conn: downAs(problem, held.signIn), problem, ms: 0, fresh: false };
    }
    const { promise, shared } = attempt(slot, spec, key, cwd, timeoutMs);
    try {
      const conn = await promise;
      return { name: spec.name, conn, problem: null, ms: now() - t0, fresh: !shared };
    } catch (/** @type {any} */ e) {
      const problem = String(e?.message || e);
      return { name: spec.name, conn: downAs(problem, e?.data?.signIn === true), problem, ms: now() - t0, fresh: true };
    }
  };
  return {
    /**
     * The session's servers, connected side by side. Each entry, in the specs' order: the connection, or the problem
     * in words.
     * @param {string} session @param {McpSpec[]} specs @param {{ cwd?: string, timeoutMs?: number }} [o]
     * @returns {Promise<{ name: string, conn: McpConnection | null, problem: string | null, ms: number, fresh: boolean }[]>}
     */
    async servers(session, specs, { cwd = "", timeoutMs = MCP_CONNECT_TIMEOUT_MS } = {}) {
      const wanted = new Set(specs.map((spec) => `${session}|${spec.name}`));
      const out = await Promise.all(specs.map((spec) => one(`${session}|${spec.name}`, spec, cwd, timeoutMs)));
      // Servers the session dropped from its document go with the turn that dropped them.
      for (const [slot, v] of live) if (slot.startsWith(`${session}|`) && !wanted.has(slot)) {
        live.delete(slot);
        v.conn.close().catch(() => {});
      }
      for (const slot of listed.keys()) if (slot.startsWith(`${session}|`) && !wanted.has(slot)) listed.delete(slot);
      return out;
    },
    /**
     * Close one session's connections, and settle when each has gone (a stdio server's whole tree): a worker's own, as
     * its run ends, before the worktree they ran in is given back.
     * @param {string} session
     */
    async close(session) {
      const closing = [];
      for (const [slot, v] of live)
        if (slot.startsWith(`${session}|`)) {
          live.delete(slot);
          closing.push(v.conn.close().catch(() => {}));
        }
      for (const slot of listed.keys()) if (slot.startsWith(`${session}|`)) listed.delete(slot);
      await Promise.all(closing);
    },
    size: () => live.size,
    sweep,
    closeAll,
  };
}
