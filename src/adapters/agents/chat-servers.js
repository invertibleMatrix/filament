// @ts-check
// The MCP servers a coding agent's session opens with besides Filament's own (HarnessV4_Overnight_Plan OV-D15, OV-D16):
// its upstream's own `mcpServers` and the harness chat's (`plugins.mcp`), on one name the chat's. One list here, then
// each agent's own field: ACP's session params, Codex's config keys, Cursor's SDK option. The record's words name what
// was given and what was left out, and why — a name and a transport, never a value of an env or a header. A session of
// another machine's agents' chat is given none.

import { shortHash } from "../../core/hash.js";

/** @typedef {import("./turn-bridge.js").ChatServer} ChatServer */
/**
 * A server as an agent is given it: stdio (`command`, `args`, `env` as a map, `cwd` where its field carries one) or
 * streamable HTTP (`url`, `headers` as a map).
 * @typedef {{ name: string, command?: string, args: string[], env: Record<string, string>, cwd?: string, url?: string, headers: Record<string, string> }} Given
 */

/** A map of strings from an upstream's env, which may be written as ACP's own list. @param {any} env */
const mapOf = (env) =>
  Array.isArray(env)
    ? Object.fromEntries(env.filter((e) => e && typeof e.name === "string").map((e) => [e.name, String(e.value ?? "")]))
    : env && typeof env === "object"
      ? Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)]))
      : {};

/**
 * The servers an agent's session opens with, in one shape, and the record's words for the chat's.
 * @param {any} acp  the upstream's agent settings: its own `mcpServers` (stdio entries)
 * @param {readonly ChatServer[] | null | undefined} chat  the chat's own (`plugins.mcp`), as its settings hold them
 * @param {{ title: string, http: boolean, cwd: boolean, fenced?: boolean }} o  `title`: the agent's name in the words;
 *   `http`: it takes MCP over HTTP; `cwd`: its field carries a stdio server's folder; `fenced`: a session of another
 *   machine's agents' chat (app/acp-turn.js), given none of this machine's servers, its upstream's nor the chat's
 * @returns {{ servers: Given[], words: string[], key: string }}  `key`: the chat's list as the session holds it, which a
 *   change of opens the session again (OV-D18)
 */
export function serversFor(acp, chat, { title, http, cwd, fenced = false }) {
  if (fenced) {
    const own = Array.isArray(acp?.mcpServers) ? acp.mcpServers.filter((x) => x && typeof x.command === "string" && x.command).length : 0;
    return { servers: [], words: own ? [`mcp: ${title}'s own MCP servers (its upstream's mcpServers) are not given: the session is another machine's agents' chat`] : [], key: "" };
  }
  /** @type {Given[]} */
  const servers = (Array.isArray(acp?.mcpServers) ? acp.mcpServers : [])
    .filter((x) => x && typeof x.command === "string" && x.command)
    .map((x) => ({ name: String(x.name || x.command), command: String(x.command), args: Array.isArray(x.args) ? x.args.map(String) : [], env: mapOf(x.env), headers: {} }));
  /** @type {string[]} */
  const given = [];
  /** @type {string[]} */
  const words = [];
  for (const s of Array.isArray(chat) ? chat : []) {
    if (s.url && !s.command && !http) {
      words.push(`mcp: the chat's server ${s.name} is not given to ${title}: it is reached over HTTP, and ${title} takes MCP over stdio only (mcpCapabilities.http)`);
      continue;
    }
    const at = servers.findIndex((x) => x.name === s.name);
    if (at >= 0) {
      words.push(`mcp: the chat's server ${s.name} is given in place of ${title}'s own of that name (its upstream's mcpServers)`);
      servers.splice(at, 1);
    }
    if (s.command) {
      const folder = typeof s.cwd === "string" && s.cwd.trim() ? s.cwd.trim() : "";
      servers.push({ name: s.name, command: s.command, args: Array.isArray(s.args) ? s.args.map(String) : [], env: mapOf(s.env), ...(folder && cwd ? { cwd: folder } : {}), headers: {} });
      if (folder && !cwd) words.push(`mcp: the chat's server ${s.name} starts where ${title} starts it: its folder (${folder}) has no place in what ${title} is given`);
      given.push(`${s.name} (stdio)`);
    } else {
      servers.push({ name: s.name, url: String(s.url), args: [], env: {}, headers: mapOf(s.headers) });
      given.push(`${s.name} (http)`);
    }
  }
  if (given.length) words.unshift(`mcp: the chat's MCP server${given.length === 1 ? "" : "s"} given to ${title}: ${given.join(", ")}`);
  return { servers, words, key: chatKeyOf(chat) };
}

/**
 * The chat's list as a session holds it (OV-D18): a change of it opens the session again. A hash, since the list may
 * carry a secret in an env or a header, and a session's record is kept on disk; "" for none. A server's `load` is
 * Filament's own loop's (E49) and no agent is given it, and its `note` reaches the agent in its standing context
 * (app/agent-context.js), so a change of either alone opens nothing again.
 * @param {readonly ChatServer[] | null | undefined} chat
 */
export const chatKeyOf = (chat) => (Array.isArray(chat) && chat.length ? shortHash(JSON.stringify(chat.map(({ load: _loop, note: _said, ...s }) => s))) : "");

/**
 * ACP's `mcpServers` (session/new, load, resume, fork): stdio as `{ name, command, args, env: [{ name, value }] }`,
 * HTTP as `{ type: "http", name, url, headers: [{ name, value }] }`.
 * @param {readonly Given[]} servers
 */
export const acpServers = (servers) =>
  servers.map((s) =>
    s.url
      ? { type: "http", name: s.name, url: s.url, headers: Object.entries(s.headers).map(([name, value]) => ({ name, value })) }
      : { name: s.name, command: String(s.command), args: s.args, env: Object.entries(s.env).map(([name, value]) => ({ name, value })) },
  );

/**
 * Codex's config, one dotted key per server (`mcp_servers.<name>`) so the person's own Codex servers stay: stdio as
 * `{ command, args, env, cwd }`, streamable HTTP as `{ url, http_headers }`.
 * @param {readonly Given[]} servers
 * @returns {Record<string, any>}
 */
export const codexServers = (servers) =>
  Object.fromEntries(
    servers.map((s) => [
      `mcp_servers.${s.name}`,
      s.url
        ? { url: s.url, ...(Object.keys(s.headers).length ? { http_headers: s.headers } : {}) }
        : { command: s.command, args: s.args, ...(Object.keys(s.env).length ? { env: s.env } : {}), ...(s.cwd ? { cwd: s.cwd } : {}) },
    ]),
  );

/**
 * Cursor's SDK option `mcpServers`, by name: stdio as `{ command, args, env, cwd }`, HTTP as `{ type: "http", url,
 * headers }`.
 * @param {readonly Given[]} servers
 * @returns {Record<string, any>}
 */
export const cursorServers = (servers) =>
  Object.fromEntries(
    servers.map((s) => [
      s.name,
      s.url
        ? { type: "http", url: s.url, ...(Object.keys(s.headers).length ? { headers: s.headers } : {}) }
        : { command: s.command, args: s.args, ...(Object.keys(s.env).length ? { env: s.env } : {}), ...(s.cwd ? { cwd: s.cwd } : {}) },
    ]),
  );
