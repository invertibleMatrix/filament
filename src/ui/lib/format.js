// @ts-check
// Display formatting shared by the admin dashboard and, later, the harness page. En-dash is the empty
// sentinel so a missing number never renders as "0" or "undefined".

export const fmt = {
  /** @param {any} v */
  n: (v) => (v == null ? "–" : Number(v).toLocaleString()),
  /** @param {any} v */
  ms: (v) => (v == null ? "–" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`),
  /** @param {any} v */
  usd: (v) => (v == null ? "–" : `$${Number(v).toFixed(4)}`),
  /** @param {any} v */
  pct: (v) => `${Math.round((v || 0) * 100)}%`,
  /** @param {string} iso */
  t: (iso) => new Date(iso).toLocaleTimeString(),
  // The browser cannot import src/core/tokens.js; this is `tokensForChars` for the surfaces, the one client-side home
  // of the chars/4 estimate (the ratchet counts helper definitions per file). An estimate — label it as one.
  /** @param {any} chars */
  tokens: (chars) => Math.ceil((Number(chars) || 0) / 4),
  /**
   * A token count in a word's room: 840, 4.1k, 82k, 1.2M, 9.8M, 12M — millions as the Brief says them (`tokWords`; the
   * owner's word of 10-25: a side agent's card read "9762k"). Just under a million says 1M, as a million does.
   * @param {any} n
   */
  k: (n) => {
    const v = Math.round(Number(n) || 0);
    if (v >= 999_500) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
    return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v);
  },
  /**
   * The useful words of an error for a one-line chip (BUG-03): a JSON body reads as its message — OpenAI/Anthropic
   * `error.message`, a gateway's `error` word with its `path` (z.ai's Spring 404), `message`, `detail` — with any text
   * before the body kept; anything else stays as it is. The chip still cuts it; its title keeps the whole.
   * @param {any} text
   */
  errorGist: (text) => {
    const s = String(text ?? "").trim();
    const at = s.indexOf("{");
    if (at < 0) return s;
    try {
      const j = JSON.parse(s.slice(at));
      const msg = j?.error?.message || (typeof j?.error === "string" ? j.error : "") || j?.message || j?.detail || j?.msg || "";
      const words = [msg, typeof j?.path === "string" ? j.path : ""].filter((x) => typeof x === "string" && x).join(" — ");
      if (!words) return s;
      const before = s.slice(0, at).trim();
      return before ? `${before} ${words}` : words;
    } catch {
      return s;
    }
  },
};

/**
 * The upstream ids that are Filament's own way into a turn, not a provider (HarnessV3-Launch LD-D9), in words: the
 * loop's entry (a request that stopped there, a command's answer) and the loop turn's own record.
 */
export const SYNTHETIC_UPSTREAMS = Object.freeze({
  __agent__: "Filament agent loop",
  "agent-loop": "Filament agent loop",
});

/**
 * A project in words (HarnessV3-Launch LD-D8): its folder's name, with the folder and the id in its tooltip; the id
 * where no name is known; the empty sentinel for no project (a session that named no folder is "none"'s).
 * @param {{ id?: string | null, name?: string | null, cwd?: string | null } | null | undefined} p
 * @returns {{ text: string, title: string }}
 */
export function projectWords(p) {
  const id = p?.id && p.id !== "none" ? String(p.id) : "";
  if (!id) return { text: "–", title: "" };
  return { text: p?.name ? String(p.name) : id, title: [p?.cwd ? String(p.cwd) : "", `project ${id}`].filter(Boolean).join(" · ") };
}

/**
 * A preset's name in words (HarnessV3-Launch F14): Title case. There are no presets now; a settings card kept from
 * before them still names the one a value came from, and says it so.
 * @param {string | null | undefined} name
 */
export function presetWords(name) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

/**
 * The words `keyWords`' rule can't make by itself: acronyms, the short forms a key uses, and the units a key ends with,
 * said in brackets (`timeoutMs` → "Timeout (ms)").
 */
const KEY_WORDS = Object.freeze({
  ttl: "TTL",
  mcp: "MCP",
  openai: "OpenAI",
  id: "ID",
  url: "URL",
  api: "API",
  acp: "ACP",
  cwd: "working folder",
  env: "environment",
  args: "arguments",
  params: "parameters",
  ops: "operations",
  subagents: "agents",
  chars: "characters",
  ms: "(ms)",
  usd: "(USD)",
});

/**
 * A settings key in words (HarnessV3-Launch LD-D10), the one rule every settings label uses: the key's dots and camel
 * case split into words, in sentence case, with the table's words where the rule can't make them.
 * `maxBodyBytes` → "Max body bytes", `compaction.model` → "Compaction model", `ttl` → "TTL".
 * @param {string} key
 */
export function keyWords(key) {
  const words = String(key ?? "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(" ")
    .map((w) => (Object.hasOwn(KEY_WORDS, w) ? KEY_WORDS[/** @type {keyof typeof KEY_WORDS} */ (w)] : w))
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The key to show beside its words (LD-D10), for whoever writes the config by hand: null when the words already say
 * it ("Enabled" needs no `enabled`).
 * @param {string} key
 * @returns {string | null}
 */
export function keyBeside(key) {
  return keyWords(key).toLowerCase() === String(key ?? "").toLowerCase() ? null : String(key);
}

/**
 * A host and its port as an address writes them: an IPv6 address in brackets (`[::1]:20300`), any other host as it is.
 * @param {string} host @param {number | string} port
 */
export function hostAndPort(host, port) {
  const h = String(host || "").trim();
  return `${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}:${port}`;
}

/**
 * The address Filament is reached at, from its `server` settings, as the console shows and copies it: a wildcard host
 * (0.0.0.0, ::) or none is `localhost`, an IPv6 address goes in brackets, as a URL writes it.
 * @param {{ host?: string, port: number }} server
 */
export function serverBase(server) {
  const host = String(server.host || "").trim();
  return `http://${hostAndPort(!host || host === "0.0.0.0" || host === "::" || host === "[::]" ? "localhost" : host, server.port)}`;
}

/**
 * A session in words (F14): its title, else its first message (the archive's preview, clipped), else "Untitled
 * session", as the harness's sidebar reads a row.
 * @param {{ title?: string | null, preview?: string | null } | null | undefined} s
 */
export function sessionWords(s) {
  return s?.title || s?.preview || "Untitled session";
}

/**
 * An upstream id in words when it is Filament's own, else null: a provider's id, which the caller names its own way.
 * @param {string | null | undefined} id
 * @returns {string | null}
 */
export function upstreamWords(id) {
  if (!id || !Object.hasOwn(SYNTHETIC_UPSTREAMS, id)) return null;
  return SYNTHETIC_UPSTREAMS[/** @type {keyof typeof SYNTHETIC_UPSTREAMS} */ (id)];
}

/** How long ago, in a few letters: "now", "2m ago", "3h ago". @param {number} at @param {number} now */
export function agoShort(at, now) {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) return "now";
  return ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ago` : `${Math.floor(ms / 3_600_000)}h ago`;
}
