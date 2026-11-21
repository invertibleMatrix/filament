// @ts-check
// A chat's signed-in connector, reached by its coding agent through Filament (the owner's of 11-07): the agent is given
// an address of Filament's for it, `/mcp/c/<chat>/<name>/<sig>`, and Filament adds the sign-in's token as it forwards
// each request — renewing it there, on a 401 from the server — so the agent holds no token, and a renewal changes
// nothing it was given. Before, the token rode the server's Authorization header in what the agent was given: each
// renewal changed the chat's list (chat-servers.js `chatKeyOf`), and the agent's session opened again, its whole
// conversation written to the provider's cache again, about hourly. The address is signed with a key of this run's,
// for the chat's conversation, the server's name, its address and its account: the same across its turns and
// renewals, good for that server alone, and for as long as the chat's turns give it — an agent's session opens again
// after a restart in any case (its servers are kept on no disk).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { sendJson } from "../app/pipeline/respond.js";
import { providerFetch } from "../adapters/providers/fetch.js";

/** The path a connector's address starts with, after Filament's own. */
export const CONNECTOR_PATH = "/mcp/c/";
/** What of the agent's request goes on to the server, by name: what MCP's streamable HTTP reads. */
const ASKED = Object.freeze(["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"]);
/** What of the server's answer comes back to the agent. */
const ANSWERED = Object.freeze(["content-type", "mcp-session-id", "cache-control"]);
/** The most servers the door holds at once, the ones given longest ago let go first. */
const GIVEN_MAX = 500;
/** How long an agent is told to wait before it asks again, where a sign-in could not be renewed just now, s. */
const RETRY_AFTER_S = 30;

/**
 * @typedef {import("../app/sessions/mcp-sign-in.js").Connector} Connector
 * @typedef {import("../app/sessions/mcp-sign-in.js").ConnectorAuth} ConnectorAuth
 */

/**
 * The door: `give` hands a chat's server out at Filament's address, and keeps what it stands for until the chat's next
 * turn gives its servers again (`forget` first: one it no longer gives answers no more); `handle` answers a request at
 * such an address. Its fetch waits as long as the server takes (`providerFetch`): a tool's answer, or a stream's next
 * event, may come after minutes.
 * @param {{ key?: Buffer, auth: ConnectorAuth, fetchImpl?: (url: string, init: RequestInit) => Promise<Response>, log?: (level: string, msg: string) => void }} o
 */
export function createConnectorDoor({ key = randomBytes(32), auth, fetchImpl = providerFetch, log = () => {} }) {
  /** chat + name → the server as the chat lists it, and its address's signature. @type {Map<string, { chat: string, url: string, headers: Record<string, string>, account: string, sig: string }>} */
  const given = new Map();
  /** @param {string} chat @param {string} name @param {string} url @param {string} account */
  const sign = (chat, name, url, account) => createHmac("sha256", key).update([chat, name, url, account].join("\n")).digest("base64url").slice(0, 32);
  const host = (/** @type {string} */ url) => {
    try {
      return new URL(url).host;
    } catch {
      return "the server";
    }
  };

  return {
    /**
     * A chat's server as its coding agent is given it: at Filament's address, with no header — Filament adds them, and
     * the token, as it forwards. The same server gives the same address every time.
     * @template {Connector} S @param {string} base  Filament's own address @param {string} chat @param {S} s @returns {S}
     */
    give(base, chat, s) {
      const account = String(s.account || "");
      const url = String(s.url || "");
      const sig = sign(chat, s.name, url, account);
      const at = `${chat}\n${s.name}`;
      // Each header by its name in lower case: the agent's own of the same name goes on in its place, never beside it.
      const headers = Object.fromEntries(Object.entries(s.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      given.delete(at);
      given.set(at, { chat, url, headers, account, sig });
      for (const k of given.keys()) {
        if (given.size <= GIVEN_MAX) break;
        given.delete(k);
      }
      const { headers: _held, ...rest } = s;
      return /** @type {S} */ ({ ...rest, url: `${base}${CONNECTOR_PATH}${encodeURIComponent(chat)}/${encodeURIComponent(s.name)}/${sig}` });
    },

    /** A chat's servers let go, as its turn gives them again: one it no longer lists answers no more. @param {string} chat */
    forget(chat) {
      for (const [k, v] of given) if (v.chat === chat) given.delete(k);
    },

    /**
     * A request at a connector's address (`rest`: the path after CONNECTOR_PATH), forwarded to its server with its
     * sign-in's token; a 401 renews the token and goes again, once. Its answer streams back as it comes.
     * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res
     * @param {string} rest @param {string} body
     */
    async handle(req, res, rest, body) {
      const parts = rest.split("/");
      let chat = "";
      let name = "";
      try {
        chat = decodeURIComponent(parts[0] || "");
        name = decodeURIComponent(parts[1] || "");
      } catch {}
      const sig = String(parts[2] || "");
      const at = parts.length === 3 ? given.get(`${chat}\n${name}`) : undefined;
      // A wrong signature is answered as no server at all: the answer tells no one which chats hold which servers.
      const a = Buffer.from(sig);
      const b = Buffer.from(at?.sig || "");
      if (!at || a.length !== b.length || !timingSafeEqual(a, b)) return sendJson(res, 404, { error: "no connector at this address now: the chat's next turn gives its servers again" });
      const method = String(req.method || "GET").toUpperCase();
      if (!["POST", "GET", "DELETE"].includes(method)) return sendJson(res, 405, { error: `${method} is not a request MCP makes` });
      /** @type {Record<string, string>} */
      const asked = {};
      for (const k of ASKED) {
        const v = req.headers[k];
        if (typeof v === "string" && v) asked[k] = v;
      }
      const ctl = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) ctl.abort();
      });
      /** The token's header now; null where none can be had; an Error where asking for it failed. @returns {Promise<string | null | Error>} */
      const header = () => auth.header(at.url, at.headers, at.account).catch((/** @type {any} */ e) => (e instanceof Error ? e : new Error(String(e))));
      /** @param {string} authorization @returns {Promise<Response>} */
      const send = (authorization) => fetchImpl(at.url, { method, headers: { ...at.headers, ...asked, authorization }, ...(method === "POST" ? { body } : {}), signal: ctl.signal });
      /** No token to send: a sign-in that ended, or none, asks the person to sign in; one that could not be renewed just now, to ask again. @param {Error | null} [e] */
      const noToken = (e = null) => {
        const standing = e ? "in" : auth.standing ? auth.standing(at.url, at.headers, at.account) : "none";
        if (standing !== "in") return sendJson(res, 401, { error: `Filament holds no sign-in for ${name} at ${host(at.url)} now: sign in again in Library › Plugins & Connectors` });
        if (e) log("warn", `mcp connector: the sign-in for ${name} at ${host(at.url)} could not be read (${String(e.message).slice(0, 120)})`);
        res.setHeader("retry-after", String(RETRY_AFTER_S));
        return sendJson(res, 503, { error: `Filament could not renew the sign-in for ${name} at ${host(at.url)} just now: ask again in a moment` });
      };
      let sent = await header();
      if (sent instanceof Error || !sent) return noToken(sent instanceof Error ? sent : null);
      let up;
      try {
        up = await send(sent);
        if (up.status === 401) {
          await up.body?.cancel().catch(() => {});
          // A token newer than the one sent (another request renewed it meanwhile) goes first; the renewal only where none is.
          const now = await header();
          if (now instanceof Error) return noToken(now);
          if (now && now !== sent) sent = now;
          else {
            const renewed = await auth.renew(at.url, at.headers, at.account).catch(() => ({ ok: false }));
            const after = renewed.ok ? await header() : null;
            if (!after || after instanceof Error) return noToken(after instanceof Error ? after : null);
            sent = after;
          }
          up = await send(sent);
        }
      } catch (/** @type {any} */ e) {
        if (ctl.signal.aborted) return;
        log("warn", `mcp connector: ${name} at ${host(at.url)} did not answer (${String(e?.message || e).slice(0, 120)})`);
        return sendJson(res, 502, { error: `${name} at ${host(at.url)} did not answer: ${String(e?.message || e).slice(0, 200)}` });
      }
      /** @type {Record<string, string>} */
      const back = {};
      for (const k of ANSWERED) {
        const v = up.headers.get(k);
        if (v) back[k] = v;
      }
      res.writeHead(up.status, back);
      if (!up.body) return void res.end();
      Readable.fromWeb(/** @type {any} */ (up.body))
        .on("error", () => res.destroy())
        .pipe(res);
    },
  };
}
