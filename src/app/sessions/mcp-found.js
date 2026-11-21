// @ts-check
// Settings › MCP servers › Import from other apps (HarnessV4_Settings_Plan HS-6, HS-D75 to HS-D77): the MCP servers
// Claude Desktop, Cursor and Codex keep in their own files, read only when the person asks, as Filament's servers. Each
// file says what became of it — found, not there, or not read and why — and each server comes with the name Filament
// offers it under and the words for what Filament cannot carry over (a token Codex reads from its environment).
// Claude Code's own servers are not read: its file holds the CLI's account (HS-D75); Paste JSON takes them.
import { join } from "node:path";
import { readToml } from "../../core/toml.js";

/**
 * One app's file. @typedef {{ id: "claude-desktop" | "cursor" | "codex", label: string, path: string, format: "json" | "toml" }} FoundSource
 * One server found in it: its name there, the server as Filament keeps it (no name yet), and notes in words.
 * @typedef {{ from: string, spec: Record<string, any>, notes: string[] }} FoundServer
 */

/**
 * The three files, where each app keeps them on this computer.
 * @param {{ home: string, appData?: string, platform?: string, codexHome?: string }} at
 * @returns {FoundSource[]}
 */
export function foundSources({ home, appData = "", platform = process.platform, codexHome = "" }) {
  const claudeDir =
    platform === "win32" ? join(appData || join(home, "AppData", "Roaming"), "Claude")
    : platform === "darwin" ? join(home, "Library", "Application Support", "Claude")
    : join(home, ".config", "Claude");
  return [
    { id: "claude-desktop", label: "Claude Desktop", path: join(claudeDir, "claude_desktop_config.json"), format: "json" },
    { id: "cursor", label: "Cursor", path: join(home, ".cursor", "mcp.json"), format: "json" },
    { id: "codex", label: "Codex", path: join(codexHome || join(home, ".codex"), "config.toml"), format: "toml" },
  ];
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A map of strings, from a file's env or headers. @param {unknown} m @returns {Record<string, string>} */
const stringsOf = (m) => (isObject(m) ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v ?? "")])) : {});

/** "A", "A and B", "A, B and C". @param {string[]} xs */
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * One server of a JSON file's `mcpServers` (Claude Desktop, Cursor): `{ command, args, env, cwd }` or `{ url, headers }`
 * (`serverUrl`, `type: "sse"` kept and marked as the paste does).
 * @param {string} from @param {Record<string, any>} s @returns {FoundServer | null}
 */
function fromJson(from, s) {
  if (typeof s.url === "string" || typeof s.serverUrl === "string") {
    const headers = stringsOf(s.headers);
    const sse = s.type === "sse" || s.transport === "sse";
    return { from, spec: { url: String(s.url || s.serverUrl), ...(Object.keys(headers).length ? { headers } : {}), ...(sse ? { type: "sse" } : {}) }, notes: [] };
  }
  if (typeof s.command !== "string" || !s.command.trim()) return null;
  const args = Array.isArray(s.args) ? s.args.map(String) : [];
  const env = stringsOf(s.env);
  const off = s.disabled === true;
  return {
    from,
    spec: { command: s.command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}), ...(typeof s.cwd === "string" && s.cwd ? { cwd: s.cwd } : {}), ...(off ? { enabled: false } : {}) },
    notes: off ? ["Off in its app: it comes in off"] : [],
  };
}

/**
 * One server of Codex's `[mcp_servers.<name>]`: a command with its args, env and folder, or an address with its
 * headers. What Codex fills from its own environment — a bearer token, a header, a passed-through variable — Filament
 * cannot read: the server comes in with a note to set it here (HC-133).
 * @param {string} from @param {Record<string, any>} s @returns {FoundServer | null}
 */
function fromCodex(from, s) {
  /** @type {string[]} */
  const notes = [];
  const off = s.enabled === false;
  if (off) notes.push("Off in Codex: it comes in off");
  if (typeof s.url === "string") {
    const headers = stringsOf(s.http_headers);
    if (typeof s.bearer_token_env_var === "string" && s.bearer_token_env_var)
      notes.push(`Codex sends the token in ${s.bearer_token_env_var} as its Authorization header: add that header here`);
    const envHeaders = isObject(s.env_http_headers) ? Object.keys(s.env_http_headers) : [];
    if (envHeaders.length) notes.push(`Codex fills the header${envHeaders.length === 1 ? "" : "s"} ${listWords(envHeaders)} from its environment: add ${envHeaders.length === 1 ? "it" : "them"} here`);
    return { from, spec: { url: s.url, ...(Object.keys(headers).length ? { headers } : {}), ...(off ? { enabled: false } : {}) }, notes };
  }
  if (typeof s.command !== "string" || !s.command.trim()) return null;
  const args = Array.isArray(s.args) ? s.args.map(String) : [];
  const env = stringsOf(s.env);
  const passed = Array.isArray(s.env_vars) ? s.env_vars.map(String) : [];
  if (passed.length) notes.push(`Codex passes ${listWords(passed)} from its environment: add ${passed.length === 1 ? "it" : "them"} here`);
  return {
    from,
    spec: { command: s.command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}), ...(typeof s.cwd === "string" && s.cwd ? { cwd: s.cwd } : {}), ...(off ? { enabled: false } : {}) },
    notes,
  };
}

/**
 * The servers one file's text holds. Throws, in words, for a file that is not its format (HC-128).
 * @param {FoundSource} source @param {string} text @returns {FoundServer[]}
 */
export function foundIn(source, text) {
  if (source.format === "toml") {
    const doc = readToml(text);
    const map = isObject(doc.mcp_servers) ? doc.mcp_servers : {};
    return Object.entries(map).filter(([, v]) => isObject(v)).map(([k, v]) => fromCodex(k, v)).filter((x) => x !== null);
  }
  let doc;
  try {
    doc = JSON.parse(String(text).replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`it is not JSON (${/** @type {Error} */ (e).message})`);
  }
  const map = isObject(doc) && isObject(doc.mcpServers) ? doc.mcpServers : {};
  return Object.entries(map).filter(([, v]) => isObject(v)).map(([k, v]) => fromJson(k, v)).filter((x) => x !== null);
}

/**
 * A name Filament takes, made from an app's (HS-D77): lower case, a dash for anything else, a letter first, 32 at most;
 * "server" when nothing is left.
 * @param {string} name
 */
export function nameFrom(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 32).replace(/-+$/, "");
  return s || "server";
}

/**
 * A spec's content, for telling the same server under another name: its fields with env and headers in key order.
 * @param {Record<string, any>} spec
 */
export function sameKey(spec) {
  const sorted = (/** @type {unknown} */ m) => (isObject(m) ? Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b))) : {});
  return JSON.stringify({ c: spec.command || "", a: spec.args || [], e: sorted(spec.env), w: spec.cwd || "", u: spec.url || "", h: sorted(spec.headers), t: spec.type || "" });
}
