// @ts-check
// Filament's MCP server over stdio, for an agent that takes MCP servers over stdio alone: ACP asks every agent to take
// them so, and HTTP is a capability it may lack (the review of 11-10: an agent of ACP's registry without it went
// without Filament's tools, its task graph, memory and sub-agents). The agent starts this as its server: each JSON-RPC
// message it writes, a line each, is posted to Filament's address — in its variable `FILAMENT_RELAY_ADDRESS`, which
// only its own user can read, never on its command line, which anyone on the computer can — and what Filament answers
// is written back, a line each. Messages go side by side, since a tool call may take many minutes, and their answers
// come as each ends; none is given a clock, as an agent's own HTTP client gives none to a call. Filament stops a call
// when its connection closes: a call the agent cancels (`notifications/cancelled`) has its connection closed, and so
// does every call still open once the agent closes its end. Node's own modules alone: it runs on the app's own program
// as Node (ELECTRON_RUN_AS_NODE), from the app's folder.
import http from "node:http";
import https from "node:https";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

/** The variable the relay reads Filament's address from. */
export const RELAY_ADDRESS_VAR = "FILAMENT_RELAY_ADDRESS";

/**
 * A message posted to Filament's address: its status, its session's id where it gives one, and its body. `open` is
 * handed the request, which closing stops the call at Filament.
 * @param {URL} url @param {string} body @param {string} session @param {(req: http.ClientRequest) => void} open
 * @returns {Promise<{ status: number, session: string, type: string, text: string }>}
 */
function post(url, body, session, open) {
  return new Promise((done, fail) => {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) };
    // Closed with no whole answer — closed on purpose, or cut — it fails, whatever the close says of itself.
    const hungUp = () => fail(new Error("the connection closed before Filament answered"));
    let answering = false;
    const req = (url.protocol === "https:" ? https : http).request(url, { method: "POST", headers }, (res) => {
      answering = true;
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (/** @type {Buffer} */ c) => chunks.push(c));
      res.on("error", fail);
      res.on("end", () => {
        const sid = res.headers["mcp-session-id"];
        done({ status: res.statusCode || 0, session: typeof sid === "string" ? sid : "", type: String(res.headers["content-type"] || ""), text: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("close", hungUp);
    });
    req.on("error", fail);
    req.on("close", () => void (answering || hungUp()));
    open(req);
    req.end(body);
  });
}

/**
 * The JSON-RPC messages an answer holds: a body of JSON, or an event stream's events, each its `data:` lines joined.
 * @param {string} type @param {string} text @returns {any[]}
 */
export function answersOf(type, text) {
  const bodies = /text\/event-stream/i.test(type)
    ? text
        .split(/\r?\n\r?\n/)
        .map((ev) =>
          ev
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n"),
        )
        .filter((b) => b.trim())
    : text.trim()
      ? [text]
      : [];
  return bodies.flatMap((b) => {
    const m = JSON.parse(b);
    return Array.isArray(m) ? m : [m];
  });
}

/**
 * The requests among what the agent sent, which each wait for an answer: an error goes to each where Filament gave none.
 * @param {any} sent @returns {any[]}
 */
const requestsOf = (sent) => (Array.isArray(sent) ? sent : [sent]).filter((m) => m && typeof m === "object" && typeof m.method === "string" && m.id !== undefined && m.id !== null);

/**
 * The calls a message cancels (`notifications/cancelled`), by their ids. @param {any} sent @returns {unknown[]}
 */
const cancelsOf = (sent) => (Array.isArray(sent) ? sent : [sent]).filter((m) => m?.method === "notifications/cancelled" && m.params?.requestId != null).map((m) => m.params.requestId);

/**
 * The relay, reading `input` and writing to `output` (the process's own; a test's streams).
 * @param {string} address @param {NodeJS.ReadableStream} input @param {NodeJS.WritableStream} output
 * @returns {Promise<void>}  once the agent closed its end and every call is answered or closed
 */
export function relay(address, input, output) {
  const url = new URL(address);
  let session = "";
  let closed = false;
  /** The calls at Filament, by the id of the request each carries (a batch's under each of its ids). @type {Map<unknown, http.ClientRequest>} */
  const calls = new Map();
  /** Every request still open. @type {Set<http.ClientRequest>} */
  const open = new Set();
  /** Requests closed on purpose: a cancel, or the agent's end closed. Nothing is written for them. @type {WeakSet<http.ClientRequest>} */
  const dropped = new WeakSet();
  /** @type {() => void} */
  let ended = () => {};
  const over = new Promise((r) => (ended = () => r(undefined)));
  const write = (/** @type {any} */ m) => output.write(`${JSON.stringify(m)}\n`);
  /** @param {any} sent @param {string} words */
  const failed = (sent, words) => {
    for (const m of requestsOf(sent)) write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: `Filament's MCP server ${words}` } });
  };
  /** @param {http.ClientRequest} req */
  const drop = (req) => {
    dropped.add(req);
    req.destroy();
  };
  /** @param {string} line */
  const one = async (line) => {
    /** @type {any} */
    let sent;
    try {
      sent = JSON.parse(line);
    } catch {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    for (const id of cancelsOf(sent)) {
      const req = calls.get(id);
      if (req) drop(req);
    }
    const ids = requestsOf(sent).map((m) => m.id);
    /** @type {http.ClientRequest | null} */
    let mine = null;
    try {
      const res = await post(url, line, session, (req) => {
        mine = req;
        open.add(req);
        for (const id of ids) calls.set(id, req);
      });
      if (res.session) session = res.session;
      if (res.status < 200 || res.status >= 300) return failed(sent, `answered ${res.status}${res.text.trim() ? `: ${res.text.trim().slice(0, 200)}` : ""}`);
      for (const m of answersOf(res.type, res.text)) write(m);
    } catch (e) {
      if (!(mine && dropped.has(mine))) failed(sent, `could not be reached (${/** @type {Error} */ (e).message})`);
    } finally {
      if (mine) open.delete(mine);
      for (const id of ids) if (calls.get(id) === mine) calls.delete(id);
      if (closed && !open.size) ended();
    }
  };
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (l) => void (l.trim() && one(l)));
  lines.on("close", () => {
    closed = true;
    // The agent is gone or done: what it still waits on is stopped at Filament, its answer read by nobody.
    for (const req of open) drop(req);
    if (!open.size) ended();
  });
  return over;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const address = process.env[RELAY_ADDRESS_VAR];
  if (!address) {
    process.stderr.write(`Filament's MCP relay: no address in ${RELAY_ADDRESS_VAR}\n`);
    process.exit(2);
  }
  // Out once every answer written has gone: an empty write's callback comes after the writes before it.
  void relay(address, process.stdin, process.stdout).then(() => process.stdout.write("", () => process.exit(0)));
}
