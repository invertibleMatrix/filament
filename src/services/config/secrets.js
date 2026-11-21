// Encryption at rest for secrets inside config.json (API keys, tokens, inbound keys). AES-256-GCM with a random
// key kept in `secret.key` next to the config. Copying config.json alone to another machine leaves the secrets
// unreadable, which is the point; copy secret.key along with it to move an installation.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { SECRET_HEADER_RE } from "../../core/redact.js";
import { upstreamBaseUrl } from "../../core/routing.js";

const PREFIX = "enc:v1:";
// Where secrets live in a config. Besides the obvious fields, free-form maps can hold credentials: the agent's
// environment (`CURSOR_API_KEY`, `OPENAI_API_KEY` …) and custom outbound headers (`Authorization`, `x-api-key`) — an
// upstream's own extra headers and every rules layer's `headers.set`. Entries whose NAME looks like a credential are
// treated as secrets: sealed on disk, masked in the UI and the assistant.
// A header's rule is core's `SECRET_HEADER_RE`, which the record's masking reads too.
export const SECRET_ENV_RE = /key|token|secret|password|passwd|credential|auth/i;
/**
 * Each slot's place names its upstream by its id — or by `idOf`: a page's draft names an upstream it renamed by the id
 * it was read under (mergeSecrets) — and its route by its match, a second route with the same match `#2`, so a route
 * added above another, or moved, never takes that one's secrets.
 * @param {any} c @param {{ idOf?: (u: any) => string }} [o]
 */
export function secretSlots(c, { idOf = (u) => u.id } = {}) {
  const out = [];
  const headerSlots = (owner, where) => {
    const set = owner?.rules?.headers?.set;
    if (set && typeof set === "object")
      for (const k of Object.keys(set))
        if (SECRET_HEADER_RE.test(k)) out.push([set, k, `${where}.rules.headers.set.${k}`]);
  };
  for (const u of c.upstreams || []) {
    const id = idOf(u);
    out.push([u, "apiKey", `upstreams.${id}.apiKey`]);
    if (u.qoder)
      out.push(
        [u.qoder, "accessToken", `upstreams.${id}.qoder.accessToken`],
        [u.qoder, "refreshToken", `upstreams.${id}.qoder.refreshToken`],
      );
    if (u.acp?.env && typeof u.acp.env === "object")
      for (const k of Object.keys(u.acp.env))
        if (SECRET_ENV_RE.test(k)) out.push([u.acp.env, k, `upstreams.${id}.acp.env.${k}`]);
    // The MCP servers a coding agent connects to (`acp.mcpServers`): each one's env, by its name — its command where
    // it has none, as the agent's session names it; a second one by the same name `#2`, so two never share a secret.
    /** @type {Map<string, number>} */
    const names = new Map();
    for (const m of Array.isArray(u.acp?.mcpServers) ? u.acp.mcpServers : []) {
      const name = m && typeof m === "object" ? String(m.name || m.command || "") : "";
      if (!name) continue;
      const n = (names.get(name) || 0) + 1;
      names.set(name, n);
      if (!m.env || typeof m.env !== "object") continue;
      for (const k of Object.keys(m.env))
        if (SECRET_ENV_RE.test(k)) out.push([m.env, k, `upstreams.${id}.acp.mcpServers.${name}${n > 1 ? `#${n}` : ""}.env.${k}`]);
    }
    if (u.headers && typeof u.headers === "object")
      for (const k of Object.keys(u.headers))
        if (SECRET_HEADER_RE.test(k)) out.push([u.headers, k, `upstreams.${id}.headers.${k}`]);
    headerSlots(u, `upstreams.${id}`);
  }
  if (c.server) out.push([c.server, "adminToken", "server.adminToken"]);
  if (c.agentLoop?.web && typeof c.agentLoop.web === "object") out.push([c.agentLoop.web, "searchApiKey", "agentLoop.web.searchApiKey"]);
  if (c.rules?.headers?.set)
    for (const k of Object.keys(c.rules.headers.set))
      if (SECRET_HEADER_RE.test(k)) out.push([c.rules.headers.set, k, `rules.headers.set.${k}`]);
  /** @type {Map<string, number>} */
  const matches = new Map();
  for (const r of c.routes || []) {
    const match = String(r?.match ?? "");
    const n = (matches.get(match) || 0) + 1;
    matches.set(match, n);
    headerSlots(r, `routes.${match}${n > 1 ? `#${n}` : ""}`);
  }
  // Your MCP servers for all chats (`sessions.defaults`, nested or dotted): each one's env and headers by its name. A
  // whole Save stores the map as written, so a name can come twice — in one list, or once in each spelling — though the
  // settings' reader takes no list that names one twice, and one spelling of the two; the second is `#2`, so two
  // never share a secret.
  const defaults = c.sessions?.defaults;
  /** @type {Map<string, number>} */
  const named = new Map();
  for (const list of [defaults?.plugins?.mcp, defaults?.["plugins.mcp"]])
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m !== "object" || typeof m.name !== "string") continue;
      const n = (named.get(m.name) || 0) + 1;
      named.set(m.name, n);
      const at = `sessions.defaults.plugins.mcp.${m.name}${n > 1 ? `#${n}` : ""}`;
      for (const [field, re] of [["env", SECRET_ENV_RE], ["headers", SECRET_HEADER_RE]]) {
        const map = m[field];
        if (map && typeof map === "object")
          for (const k of Object.keys(map)) if (re.test(k)) out.push([map, k, `${at}.${field}.${k}`]);
      }
    }
  return out;
}

/**
 * An address as a key's move is told by it: its scheme, host and port, in lower case — a path on the same host is the
 * same address —; one that is no URL, its own text. @param {unknown} url
 */
const hostOf = (url) => {
  const text = String(url ?? "").trim();
  try {
    const u = new URL(text);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
};
/**
 * The addresses an upstream sends what it holds to: where its requests go (core/routing.js `upstreamBaseUrl`: its own
 * address, else its kind's) — for a Qoder account with its region, whose hosts differ — and where its models are read
 * from when that is an address of its own (`modelsPath`, as providers/http.js reads it).
 * @param {any} u @returns {string[]}
 */
const sentTo = (u) => {
  const models = String(u?.modelsPath || "").trim();
  return [`${hostOf(upstreamBaseUrl(u))}${u?.qoder ? ` ${String(u.qoder.region || "")}` : ""}`, ...(models.startsWith("http") ? [hostOf(models)] : [])];
};
/**
 * Every credential a config's upstreams hold that Filament sends for them — an upstream's key, its sign-in's tokens, a
 * header that carries one (`secretSlots`; a coding agent's environment is its program's, never sent) — with each
 * address it is sent to (`sentTo`). By the credential itself, never its upstream's id: one a renamed or a new upstream
 * takes with it is the same one. The config's weigher reads it for a key whose address moves (session-settings.js
 * `keysMove`; s-rows, 11-12). @param {any} cfg @returns {Map<string, Set<string>>}
 */
export function keysSentTo(cfg) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const u of Array.isArray(cfg?.upstreams) ? cfg.upstreams : []) {
    if (!u || typeof u !== "object") continue;
    const to = sentTo(u);
    for (const [held, k, where] of secretSlots({ upstreams: [u] }, { idOf: () => "" })) {
      const key = held?.[k];
      if (typeof key !== "string" || !key || where.startsWith("upstreams..acp.")) continue;
      const at = out.get(key) || new Set();
      for (const a of to) at.add(a);
      out.set(key, at);
    }
  }
  return out;
}

export function loadKey(dataDir, { create = true } = {}) {
  const file = join(dataDir, "secret.key");
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8").trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    // Never replace an unreadable key: every stored secret was encrypted with it, and a fresh key would silently turn
    // them all into empty strings and mint a new inbound key nobody knows.
    throw new Error(
      `${file} exists but is not a valid key (expected 32 base64 bytes). Restore it from a backup or, to start over, delete it together with the encrypted values in config.json. Filament will not overwrite it.`,
    );
  }
  if (!create) return null;
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key.toString("base64") + "\n");
  try {
    chmodSync(file, 0o600);
  } catch {}
  return key;
}
export const isSealed = (v) => typeof v === "string" && v.startsWith(PREFIX);
export function seal(plain, key) {
  if (typeof plain !== "string" || !plain || isSealed(plain)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}
export function open(sealed, key) {
  if (!isSealed(sealed)) return sealed;
  const buf = Buffer.from(sealed.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12),
    tag = buf.subarray(12, 28),
    ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
// Returns a copy with every secret field sealed (inbound keys too). Idempotent.
export function sealConfig(cfg, key) {
  const c = structuredClone(cfg);
  for (const [obj, k] of secretSlots(c))
    if (obj && typeof obj[k] === "string" && obj[k]) obj[k] = seal(obj[k], key);
  if (Array.isArray(c.server?.inboundKeys))
    c.server.inboundKeys = c.server.inboundKeys.map((k) => seal(k, key));
  return c;
}
// A config about to be written, with each sealed value of the one stored on disk that `key` cannot open kept as it is
// stored, where the new one holds nothing in its place: a secret.key missing or another's opens such a value as "", and
// a save must not write that "" over it — each stays sealed until one is entered in its place, and opens again once its
// own key is back. Inbound keys likewise, after the ones in use. A secret the new config no longer has a place for (an
// upstream removed) goes with it, and so does one at a place in `forget` — a Remove, the person's own act. Returns `cfg`
// itself when nothing is kept.
/** @param {any} cfg @param {any} stored @param {Buffer | null} key @param {{ forget?: string[] }} [o] */
export function keepUnreadable(cfg, stored, key, { forget = [] } = {}) {
  if (!stored || typeof stored !== "object") return cfg;
  const unreadable = (v) => {
    if (!isSealed(v)) return false;
    if (!key) return true;
    try {
      open(v, key);
      return false;
    } catch {
      return true;
    }
  };
  const kept = new Map();
  for (const [obj, k, where] of secretSlots(stored)) if (obj && unreadable(obj[k]) && !forget.includes(where)) kept.set(where, obj[k]);
  const lostKeys = (Array.isArray(stored.server?.inboundKeys) ? stored.server.inboundKeys : []).filter(unreadable);
  if (!kept.size && !lostKeys.length) return cfg;
  const c = structuredClone(cfg);
  for (const [obj, k, where] of secretSlots(c)) if (obj && kept.has(where) && (obj[k] == null || obj[k] === "")) obj[k] = kept.get(where);
  if (lostKeys.length && c.server) c.server.inboundKeys = [...(Array.isArray(c.server.inboundKeys) ? c.server.inboundKeys : []), ...lostKeys];
  return c;
}
/**
 * The places of `unreadable` a configuration still holds empty. One a value is entered in, or whose upstream goes, drops
 * out: a save writes the value there, or nothing. An inbound key's stays, kept after the keys in use (keepUnreadable).
 * @param {any} cfg @param {string[]} unreadable
 */
export function stillUnreadable(cfg, unreadable) {
  if (!unreadable.length) return unreadable;
  const empty = new Set(secretSlots(cfg).filter(([o, k]) => o?.[k] == null || o[k] === "").map(([, , where]) => where));
  return unreadable.filter((where) => where.startsWith("inboundKeys[") || empty.has(where));
}
// Returns a copy with secrets decrypted; unreadable values (wrong key) become "" and are listed in `problems`, and
// their places in `unreadable` (an inbound key's as `inboundKeys[i]`).
export function openConfig(cfg, key) {
  const c = structuredClone(cfg);
  const problems = [];
  /** @type {string[]} */
  const unreadable = [];
  const tryOpen = (v, where) => {
    if (!isSealed(v)) return v;
    if (!key) {
      problems.push(`${where}: encrypted but no secret.key`);
      unreadable.push(where);
      return "";
    }
    try {
      return open(v, key);
    } catch {
      problems.push(`${where}: could not decrypt (wrong secret.key?)`);
      unreadable.push(where);
      return "";
    }
  };
  for (const [obj, k, where] of secretSlots(c))
    if (obj && typeof obj[k] === "string") obj[k] = tryOpen(obj[k], where);
  if (Array.isArray(c.server?.inboundKeys))
    c.server.inboundKeys = c.server.inboundKeys
      .map((k, i) => tryOpen(k, `inboundKeys[${i}]`))
      .filter(Boolean);
  return { config: c, problems, unreadable };
}
