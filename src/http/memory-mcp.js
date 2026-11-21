// @ts-check
// Memory as a service (HarnessV3-Memory M7-6): `/mcp/memory`, the MCP server an agent Filament does not run (Claude Code,
// Cursor, VS Code, any MCP client) adds once, for every project. Streamable HTTP: JSON-RPC over POST, one message or a
// batch, answered in JSON, or as an SSE stream when the client must be asked its folder first (M7-D38). Here: who may
// call (M7-D39), the sessions (M7-D40, M7-D41) and the folder each stands in (M7-D42). The tools are
// app/memory-mcp.js's.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { lowerHeaders } from "../core/headers.js";
import { credentialOf, isHouseCall } from "../services/house.js";
import { isLocalCaller, readBody, readsEverySession, safeEq } from "./guards.js";
import { MEMORY_MCP_TOOLS, memoryMcpCall, memoryMcpOpening } from "../app/memory-mcp.js";

const VERSION = "1";
/** The protocol versions it answers in: the client's when it is one of these, else the newest. */
const PROTOCOLS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
const SESSION_ID = /^[0-9a-f]{32}$/;
/** Sessions held in memory at once; one let go is adopted again from its chain at its next call (M7-D41). */
const MAX_SESSIONS = 500;
/** Ended sessions remembered in this process, so their id stays 404 (a session with a chain keeps it there too). */
const MAX_ENDED = 1000;
/** How long a session's first call waits for the client's roots (M7-D42). */
const ROOTS_WAIT_MS = 5000;

/** The chain key of an MCP session (M7-D40). @param {string} id */
export const mcpSessionKey = (id) => `mcp:${id}`;

/**
 * An Origin a browser page sends: none (no browser), or a page Filament serves, on loopback, the configured host or an
 * allowed one. Anything else is a page elsewhere reaching the owner's memory through their browser (M7-D39).
 * @param {string | undefined} origin @param {any} server  the `server` config section
 */
export function originAllowed(origin, server) {
  if (origin == null || origin === "") return true;
  let host;
  try {
    host = new URL(String(origin)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === "::1") return true;
  const own = String(server.host || "").toLowerCase();
  if (own && host === own) return true;
  return (server.allowedHosts || []).some((/** @type {unknown} */ x) => String(x).toLowerCase() === host);
}

/** The keys memory's door asks one of (M7-D39); none set, it answers this machine only. @param {any} server */
export const memoryKeys = (server) => (server.inboundKeys || []).map(String).filter(Boolean);

/**
 * Who may call (M7-D39): never a browser page from elsewhere; Filament's own house key; with inbound keys set, one of
 * them, whatever `requireAuth` says; with none set, loopback only. → null, or the refusal.
 * @param {import("node:http").IncomingMessage} req @param {any} server  the `server` config section
 * @returns {{ status: number, error: string, headers?: Record<string, string> } | null}
 */
export function memoryMcpRefusal(req, server) {
  const h = lowerHeaders(req.headers);
  if (!originAllowed(h.origin, server)) return { status: 403, error: `a page at ${String(h.origin).slice(0, 80)} may not reach Filament's memory` };
  if (isHouseCall(h)) return null;
  const keys = memoryKeys(server);
  if (keys.length) {
    const key = credentialOf(h);
    if (key && keys.some((k) => safeEq(k, key))) return null;
    return { status: 401, error: "Filament's memory needs one of its inbound keys, as Authorization: Bearer <key> or x-api-key", headers: { "www-authenticate": 'Bearer realm="Filament memory"' } };
  }
  return isLocalCaller(req) ? null : { status: 403, error: "Filament has no inbound key set, so its memory answers this machine only" };
}

/**
 * An MCP session (M7-D40, M7-D41): who the client is, what it declared, and the folders it named.
 * @typedef {object} McpSession
 * @property {string} id
 * @property {string} client  `mcp:<clientInfo.name>`, as the record names it
 * @property {boolean | null} roots  whether the client declared `roots`; null when not known (an adopted session)
 * @property {boolean} ready  its `notifications/initialized` came (an adopted session is)
 * @property {string} header  the folder `x-filament-cwd` names
 * @property {string} query  the folder `?cwd=` names
 * @property {string} root  the folder its first `file://` root names
 * @property {boolean} asked  its roots were asked and answered, or waited for, since they last changed
 */

/** @param {string} name */
const clientName = (name) => `mcp:${String(name || "").trim().replace(/[^\w.@-]+/g, "-").slice(0, 40) || "client"}`;
/** The first `file://` root of a `roots/list` answer, as a path; "" when there is none. @param {any} result */
function firstRoot(result) {
  for (const r of Array.isArray(result?.roots) ? result.roots : []) {
    try {
      return fileURLToPath(String(r?.uri));
    } catch {
      /* a root that is no file path (another scheme, no URL) names no folder */
    }
  }
  return "";
}
/** @param {import("node:http").ServerResponse} res @param {number} status @param {any} body @param {Record<string, string>} [headers] */
function sendJson(res, status, body, headers = {}) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(Buffer.byteLength(s)), ...headers });
  res.end(s);
}
/** @param {import("node:http").ServerResponse} res @param {any} msg */
const sse = (res, msg) => res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
/** @param {string} message */
const rpcError = (code, message) => Object.assign(new Error(message), { code });

export class MemoryMcp {
  /** @type {Map<string, McpSession>} oldest used first */
  #live = new Map();
  /** @type {Set<string>} */
  #ended = new Set();
  /** The roots asks waiting for their answer, by request id. @type {Map<string, (result: any) => void>} */
  #asking = new Map();
  #asks = 0;
  /**
   * @param {{ memory: any, config: { get: () => any }, log?: (level: string, msg: string) => void, rootsWaitMs?: number, maxSessions?: number }} o
   */
  constructor({ memory, config, log = () => {}, rootsWaitMs = ROOTS_WAIT_MS, maxSessions = MAX_SESSIONS }) {
    this.memory = memory;
    this.config = config;
    this.log = log;
    this.rootsWaitMs = rootsWaitMs;
    this.maxSessions = maxSessions;
    /** Each tool call, to the operation log (the server sets it). @type {((title: string, opts: any) => void) | null} */
    this.onOp = null;
  }

  /**
   * One request to `/mcp/memory`. @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res
   * @param {URL} url
   */
  async handle(req, res, url) {
    const server = this.config.get().server || {};
    const no = memoryMcpRefusal(req, server);
    if (no) return sendJson(res, no.status, { error: no.error }, no.headers);
    const h = lowerHeaders(req.headers);
    if (req.method === "DELETE") return this.#end(res, String(h["mcp-session-id"] || ""));
    if (req.method !== "POST") return sendJson(res, 405, { error: "Filament's memory speaks MCP over POST (no standalone stream)" }, { allow: "POST, DELETE" });
    if (!/^application\/json\b/i.test(String(h["content-type"] || ""))) return sendJson(res, 415, { error: "send JSON-RPC as application/json" });
    let body;
    try {
      body = await readBody(req, server.maxBodyBytes || 64 * 1024 * 1024);
    } catch (/** @type {any} */ e) {
      return sendJson(res, e?.status === 413 ? 413 : 400, { error: e?.message || "the body could not be read" });
    }
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    const list = Array.isArray(msg) ? msg : [msg];
    const init = list.find((m) => m?.method === "initialize");
    const sid = String(h["mcp-session-id"] || "");
    /** @type {McpSession | null} */
    let s = null;
    if (init) s = this.#open(init);
    else if (sid) {
      s = this.#find(sid);
      if (!s) return sendJson(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "no such session: initialize again" } });
    }
    if (s) {
      s.header = String(h["x-filament-cwd"] || "").trim() || s.header;
      s.query = String(url.searchParams.get("cwd") || "").trim() || s.query;
    }
    /** @type {Record<string, string>} */
    const head = s ? { "mcp-session-id": s.id } : {};
    for (const m of list) {
      if (!m || typeof m !== "object") continue;
      // The client's answer to a question this server asked (its roots): no method, the id asked.
      if (m.method == null && m.id != null) this.#asking.get(String(m.id))?.(m.result);
      else if (m.method === "notifications/initialized" && s) s.ready = true;
      else if (m.method === "notifications/roots/list_changed" && s) s.asked = false;
    }
    const asks = list.filter((m) => m && typeof m === "object" && m.method != null && m.id != null);
    // Neither a request, a notification nor an answer: said back as invalid, as a request with a wrong `jsonrpc` is.
    const bad = list.filter((m) => !m || typeof m !== "object" || (m.method == null && m.id == null));
    if (!asks.length && !bad.length) {
      res.writeHead(202, head);
      return res.end();
    }
    // A caller with an inbound key that could not read every session anyway (another machine without the admin token)
    // reaches its own project's sessions alone: the project of the folder it stands in (port.js `confined`).
    const at = { h, url, confined: !isHouseCall(h) && !readsEverySession(req, server) };
    const answer = async () => [...(await Promise.all(asks.map((m) => this.#one(m, s, at)))), ...bad.map(() => ({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } }))];
    if (s && this.#mayAsk(s, h)) {
      // The folder first (M7-D42): the client is asked on this answer's stream, and its answer comes as a POST.
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...head });
      s.root = firstRoot(await this.#ask(res, s)) || s.root;
      s.asked = true;
      for (const r of await answer()) sse(res, r);
      return res.end();
    }
    const out = await answer();
    return sendJson(res, 200, Array.isArray(msg) ? out : out[0], head);
  }

  /** @param {any} init @returns {McpSession} */
  #open(init) {
    const id = randomBytes(16).toString("hex");
    const p = init.params || {};
    return this.#keep({ id, client: clientName(p.clientInfo?.name), roots: !!p.capabilities?.roots, ready: false, header: "", query: "", root: "", asked: false });
  }
  /**
   * A session by its id: held, or adopted from its chain, or from nothing (M7-D41); null when it was ended or the id is
   * none this server makes. @param {string} id
   */
  #find(id) {
    if (!SESSION_ID.test(id) || this.#ended.has(id)) return null;
    const held = this.#live.get(id);
    if (held) return this.#keep(held);
    const chain = this.#chainOf(id);
    if (chain?.meta?.mcp?.ended) return null;
    const known = chain?.meta?.mcp;
    return this.#keep({ id, client: chain?.client || "mcp:client", roots: known ? !!known.roots : null, ready: true, header: "", query: "", root: "", asked: false });
  }
  /** @param {string} id */
  #chainOf(id) {
    try {
      return this.memory.mcpChainOf?.(mcpSessionKey(id)) || null;
    } catch {
      return null;
    }
  }
  /** Held, the most recently used last; the least recently used let go past the cap. @param {McpSession} s */
  #keep(s) {
    this.#live.delete(s.id);
    this.#live.set(s.id, s);
    while (this.#live.size > this.maxSessions) this.#live.delete(/** @type {string} */ (this.#live.keys().next().value));
    return s;
  }
  /** The client ends its session (DELETE): its id is 404 from now on, here and, when it has a chain, after a restart. */
  #end(/** @type {import("node:http").ServerResponse} */ res, /** @type {string} */ id) {
    if (!id) return sendJson(res, 400, { error: "name the session to end (Mcp-Session-Id)" });
    if (!this.#find(id)) return sendJson(res, 404, { error: "no such session" });
    this.#live.delete(id);
    this.#ended.add(id);
    while (this.#ended.size > MAX_ENDED) this.#ended.delete(/** @type {string} */ (this.#ended.values().next().value));
    try {
      this.memory.mcpEnd?.(mcpSessionKey(id));
    } catch (/** @type {any} */ e) {
      this.log("warn", `[memory mcp] ending session ${id.slice(0, 6)}: ${e?.message || e}`);
    }
    res.writeHead(200);
    res.end();
  }
  /**
   * Whether this answer asks the client its folder first: it declared roots (or may have: adopted), it named no folder
   * by header or query, it is initialized, it was not asked since they changed, and it takes a stream.
   * @param {McpSession} s @param {Record<string, string>} h
   */
  #mayAsk(s, h) {
    return s.roots !== false && !s.header && !s.query && s.ready && !s.asked && /text\/event-stream/i.test(String(h.accept || ""));
  }
  /** `roots/list`, on the open stream; its answer, or null after the wait or when the client leaves. @param {import("node:http").ServerResponse} res @param {McpSession} s */
  #ask(res, s) {
    const id = `filament-roots-${++this.#asks}`;
    return new Promise((resolve) => {
      /** @param {any} result */
      const done = (result) => {
        clearTimeout(timer);
        this.#asking.delete(id);
        res.off("close", gone);
        resolve(result);
      };
      const gone = () => done(null);
      const timer = setTimeout(() => {
        this.log("info", `[memory mcp] ${s.client} did not say its roots within ${this.rootsWaitMs} ms; the session names no folder`);
        done(null);
      }, this.rootsWaitMs);
      timer.unref?.();
      res.on("close", gone);
      this.#asking.set(id, done);
      sse(res, { jsonrpc: "2.0", id, method: "roots/list" });
    });
  }
  /**
   * Where a call stands (M7-D42): the folder its `cwd` names, else its session's (header, query, root), else, with no
   * session, the request's header or query; `confined` for a caller that reaches its own project's sessions alone.
   * @param {McpSession | null} s @param {{ h: Record<string, string>, url: URL, confined?: boolean }} at @param {any} [args]
   */
  #where(s, { h, url, confined = false }, args = {}) {
    const asked = typeof args?.cwd === "string" ? args.cwd.trim() : "";
    const folder = asked || (s ? s.header || s.query || s.root : String(h["x-filament-cwd"] || url.searchParams.get("cwd") || "").trim());
    return {
      folder,
      key: s ? mcpSessionKey(s.id) : null,
      client: s ? s.client : clientName(String(h["user-agent"] || "").split("/")[0]),
      meta: s ? { roots: s.roots === true } : null,
      confined,
    };
  }
  /** @param {any} m @param {McpSession | null} s @param {{ h: Record<string, string>, url: URL, confined?: boolean }} at */
  async #one(m, s, at) {
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return { jsonrpc: "2.0", id: m.id ?? null, error: { code: -32600, message: "invalid request" } };
    try {
      return { jsonrpc: "2.0", id: m.id, result: await this.#dispatch(m, s, at) };
    } catch (/** @type {any} */ e) {
      return { jsonrpc: "2.0", id: m.id, error: { code: Number.isInteger(e?.code) ? e.code : -32603, message: String(e?.message || e) } };
    }
  }
  /** @param {any} m @param {McpSession | null} s @param {{ h: Record<string, string>, url: URL, confined?: boolean }} at */
  async #dispatch(m, s, at) {
    switch (m.method) {
      case "initialize": {
        const asked = m.params?.protocolVersion;
        return {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "filament-memory", title: "Filament memory", version: VERSION },
          instructions: await memoryMcpOpening(this.memory, this.#where(s, at)),
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: MEMORY_MCP_TOOLS };
      case "tools/call": {
        const name = String(m.params?.name || "");
        if (!MEMORY_MCP_TOOLS.some((t) => t.name === name)) throw rpcError(-32602, `unknown tool: ${name.slice(0, 60)}`);
        const args = m.params?.arguments || {};
        const where = this.#where(s, at, args);
        const r = await memoryMcpCall(this.memory, name, args, where);
        this.#op(name, !r.isError, where.client, s);
        return r;
      }
      case "resources/list":
        return { resources: [] };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "prompts/list":
        return { prompts: [] };
      default:
        throw rpcError(-32601, `method not found: ${String(m.method).slice(0, 60)}`);
    }
  }
  /** A tool call to the operation log: which, whether it worked, who; never its arguments or its answer. */
  #op(/** @type {string} */ tool, /** @type {boolean} */ ok, /** @type {string} */ client, /** @type {McpSession | null} */ s) {
    try {
      this.onOp?.(`memory over MCP: ${tool} ${ok ? "ok" : "failed"}`, { sub: "tool", level: ok ? "info" : "warn", detail: { tool, ok, client, session: s ? s.id.slice(0, 6) : null } });
    } catch {
      /* the record must never break a call */
    }
  }
}
