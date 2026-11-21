// @ts-check
// Pure: what Filament's anonymous telemetry sends, built from what it may say and nothing else. The service gathers a
// day's facts raw (usage rows by upstream id and model name, runs by the upstream they ran on, the upstream list, a few
// feature switches and counts); everything that leaves the machine is made here, each value picked from a fixed list or
// checked against a strict form: an upstream is its provider's kind or "custom", a coding agent one of the catalogue's
// or "other-agent", a model a key of the built-in price table, a public model's own name where only its maker names
// models (`publicModel`), or "custom". An upstream's id or name, its address, a
// model's name as asked, a path, a title or anything else typed on this machine has no way into a payload: a field
// nothing here names is never copied. The owner's rule (11-10): never prompts, code, paths, names, keys or IPs.
import { PROVIDERS, providerForBaseUrl } from "./providers.js";
import { AGENT_CATALOGUE, entryOf } from "./catalogues.js";
import { PRICING_DEFAULTS, UPSTREAM_TYPES, AGENT_TYPES } from "./schema.js";
import { normalizeModelForPricing } from "./pricing.js";

/** The events, by name: one at each start of Filament's server, and one a day for the day before. */
export const TELEMETRY_EVENTS = Object.freeze({ opened: "app opened", daily: "daily summary" });

/**
 * An upstream's kind: a provider of the catalogue by its address, Qoder's cloud, another machine's models, a coding
 * agent (which one is `agentKind`'s), an address the catalogue does not know ("custom"), or an upstream no longer
 * there ("unknown").
 */
export const PROVIDER_KINDS = Object.freeze([...PROVIDERS.map((p) => p.id), "qoder-cloud", "machine", "agent", "custom", "unknown"]);
/** The coding agents named by their catalogue id; any other is "other-agent". */
export const AGENT_KINDS = Object.freeze([...AGENT_CATALOGUE.map((a) => a.id), "other-agent"]);
/** What a run ran on: Filament's own loop, a coding agent of `AGENT_KINDS`, or an upstream no longer there. */
export const ENGINE_KINDS = Object.freeze(["filament", ...AGENT_KINDS, "unknown"]);
/** A model as the built-in price table keys it, versioned with the app; any other is "custom", or `publicModel`'s. */
export const MODEL_KEYS = Object.freeze([...Object.keys(PRICING_DEFAULTS), "custom"]);
/**
 * The providers whose model names are their maker's alone (the catalogue's, but the ones serving models on this
 * machine, Ollama and LM Studio, where a model is named by whoever made it): a model there may go out by its name.
 */
const NAMING_PROVIDERS = new Set(PROVIDERS.map((p) => p.id).filter((id) => id !== "ollama" && id !== "lmstudio"));
/**
 * The families a public model's name begins with: OpenAI's, Google's, xAI's, Anthropic's (and Claude Code's aliases),
 * Moonshot's, DeepSeek's, Qwen's, Z.AI's, Mistral's, Meta's, MiniMax's, NVIDIA's, Microsoft's, Cohere's, Cursor's.
 */
const FAMILY = /^(?:gpt-|chatgpt-|o[1-9](?:-|$)|codex-|gemini-|gemma-?\d|grok-|claude-|opus|sonnet|haiku|kimi-|k[1-9](?:[.-]|$)|moonshot-|deepseek-|qwen|qwq-|glm-|mistral-|codestral|devstral|magistral|ministral|pixtral|llama-?\d|llama-|minimax-|nemotron|phi-\d|command-|composer-)/;
/** The vendors an aggregator's name may stand under (`openai/gpt-5.1`, `accounts/fireworks/models/…`): no one else's. */
const VENDORS = new Set([
  "openai", "anthropic", "google", "x-ai", "xai", "moonshotai", "moonshot", "deepseek", "deepseek-ai", "qwen", "alibaba",
  "z-ai", "zai-org", "zhipuai", "thudm", "mistralai", "mistral", "meta-llama", "meta", "minimax", "minimaxai", "nvidia",
  "microsoft", "cohere", "models", "accounts", "fireworks",
]);
/** The form of a public model's name: what `publicModel` gives. */
export const MODEL_FORM = /^[a-z0-9][a-z0-9.-]{0,47}$/;
export const OS_KINDS = Object.freeze(["win32", "darwin", "linux", "other"]);
export const ARCH_KINDS = Object.freeze(["x64", "arm64", "other"]);
/** How Filament was installed: the desktop app, a server install, a checkout of its code. */
export const INSTALL_KINDS = Object.freeze(["desktop", "server", "checkout", "other"]);
/** The features a day's summary says are on (switches) or counts (how many). */
export const FEATURE_SWITCHES = Object.freeze(["memory", "lan", "tailscale"]);
export const FEATURE_COUNTS = Object.freeze(["graphChats", "artifacts", "spaces", "machines", "devices"]);

/** A usage row's sums, as services/daily-usage.js keeps them: what a summary's rows and totals add. */
const SUMS = Object.freeze(["requests", "ok", "errors", "aborted", "input", "cacheRead", "cacheWrite", "output", "thinking", "tpsSum", "tpsN", "ttftSum", "ttftN"]);
const DOLLARS = Object.freeze(["cost", "listCost", "planListCost"]);

/** A count, or 0: a whole number at least 0. @param {unknown} v */
const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
/** Dollars, or 0: at least 0, to the millionth. @param {unknown} v */
const usd = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) / 1e6 : 0;
};
/** `v` where a list has it, else its last word ("other", "custom"…). @param {readonly string[]} list @param {unknown} v */
const oneOf = (list, v) => (typeof v === "string" && list.includes(v) ? v : list[list.length - 1]);

const OFF_WORDS = new Set(["0", "false", "no", "off"]);
/**
 * The environment variable that turns telemetry off, or null: `DO_NOT_TRACK` set to anything but an off word
 * (consoledonottrack.com's `DO_NOT_TRACK=1`), or `FILAMENT_TELEMETRY` set to one (`0`, `false`, `no`, `off`). Neither
 * turns it on: the setting's off stands whatever they say.
 * @param {Record<string, string | undefined> | null | undefined} env
 * @returns {"DO_NOT_TRACK" | "FILAMENT_TELEMETRY" | null}
 */
export function offByEnv(env) {
  const word = (/** @type {string} */ k) => String(env?.[k] ?? "").trim().toLowerCase();
  if (word("DO_NOT_TRACK") && !OFF_WORDS.has(word("DO_NOT_TRACK"))) return "DO_NOT_TRACK";
  if (OFF_WORDS.has(word("FILAMENT_TELEMETRY"))) return "FILAMENT_TELEMETRY";
  return null;
}
/**
 * Why telemetry is off, or null while it is on: the environment first (`offByEnv`), then the setting
 * `telemetry.enabled` switched off, then — where the person chose neither — the build's default: `onByDefault` in an
 * official build, "unofficial" in any other.
 * @param {any} cfg @param {Record<string, string | undefined> | null | undefined} env @param {boolean} [onByDefault]
 * @returns {"DO_NOT_TRACK" | "FILAMENT_TELEMETRY" | "setting" | "unofficial" | null}
 */
export function whyOff(cfg, env, onByDefault = true) {
  const chosen = cfg?.telemetry?.enabled;
  return offByEnv(env) || (chosen === false ? "setting" : chosen !== true && !onByDefault ? "unofficial" : null);
}

/**
 * A coding agent's upstream as its catalogue id (Cursor's SDK apart from its CLI, Qoder CN apart from Qoder), or
 * "other-agent": a command Filament does not know, whatever it is called, never goes out. Null for an upstream that
 * is no coding agent.
 * @param {any} u
 * @returns {string | null}
 */
export function agentKind(u) {
  if (!u || !AGENT_TYPES.has(u.type)) return null;
  const id = entryOf(u, new Set());
  return AGENT_KINDS.includes(id) && id !== "other-agent" ? id : "other-agent";
}

/**
 * An upstream as `PROVIDER_KINDS` says it: a coding agent's is "agent", another machine's "machine", Qoder's cloud
 * "qoder-cloud"; an API's is the catalogue provider its address belongs to (its type's own address where it names
 * none), else "custom". Its id, name and address never leave here.
 * @param {any} u  an upstream of the configuration, or null where none is there
 * @returns {string}
 */
export function upstreamKind(u) {
  if (!u || typeof u !== "object") return "unknown";
  if (AGENT_TYPES.has(u.type)) return "agent";
  if (u.type === "filament") return "machine";
  if (u.type === "qoder") return "qoder-cloud";
  const type = /** @type {Record<string, { baseUrl?: string }>} */ (UPSTREAM_TYPES)[u.type];
  if (!type) return "custom";
  const known = providerForBaseUrl(String(u.baseUrl || type.baseUrl || ""));
  return known ? known.provider.id : "custom";
}

/** The built-in price table's keys, each with its pricing form, longest first: the first that prefixes a name wins. */
const MODEL_ROWS = Object.keys(PRICING_DEFAULTS)
  .map((key) => /** @type {[string, string]} */ ([normalizeModelForPricing(key), key]))
  .filter(([p]) => p)
  .sort((a, b) => b[0].length - a[0].length);
/**
 * A model as the built-in price table keys it, by pricing's longest-prefix rule; else, where it ran on a provider whose
 * model names are its maker's (`NAMING_PROVIDERS`) or on a coding agent Filament knows, its public name
 * (`publicModel`); else "custom": a fine-tune (`ft:…:<org>:…`), a local model, a custom address's, another machine's,
 * a route's alias or an operator's own row never goes out by its name.
 * @param {unknown} model @param {{ provider?: string | null, agent?: string | null } | null} [where]  what it ran on
 * @returns {string}
 */
export function modelKey(model, where = null) {
  const m = normalizeModelForPricing(model);
  if (!m) return "custom";
  const priced = MODEL_ROWS.find(([p]) => m.startsWith(p))?.[1];
  if (priced) return priced;
  const named = (where?.agent && where.agent !== "other-agent") || (!!where?.provider && NAMING_PROVIDERS.has(where.provider));
  return named ? publicModel(model) : "custom";
}
/**
 * A model's public name, or "custom": lowercased, its date (`-20251101`, `-2025-11-01`) and window (`[1m]`) taken off,
 * of `MODEL_FORM`, beginning as a known family does (`FAMILY`), and under no path but known vendors' — so a name the
 * person chose (a fine-tune `ft:…`, a `user/model` of an aggregator's, Gemini's `tunedModels/…`, an Ollama tag
 * `name:7b`) never goes out.
 * @param {unknown} model
 * @returns {string}
 */
export function publicModel(model) {
  const raw = String(model ?? "").trim().toLowerCase();
  if (!raw || raw.length > 96) return "custom";
  const path = raw.split("/");
  const last = /** @type {string} */ (path.pop());
  if (path.some((p) => !VENDORS.has(p))) return "custom";
  const name = last.replace(/\[\d+(?:\.\d+)?[km]\]$/, "").replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
  return MODEL_FORM.test(name) && FAMILY.test(name) ? name : "custom";
}

/**
 * What a run ran on, by the upstream id the service kept for it: none is Filament's own loop, as is an upstream that
 * is no coding agent (the loop's model's); a coding agent's is its `agentKind`; an id no upstream has any more is
 * "unknown".
 * @param {unknown} id @param {any[]} upstreams
 */
function engineOf(id, upstreams) {
  if (id == null || id === "") return "filament";
  const u = upstreams.find((x) => x?.id === id);
  if (!u) return "unknown";
  return agentKind(u) || "filament";
}

/**
 * The machine and the build, as both events carry them: Filament's version (a version's form, else "other"), the
 * system and its architecture, how it was installed, the language and region of its locale (two or three letters and
 * a region, else "other"), and its time zone (one the system's clock knows by name, else "other").
 * @typedef {{ version?: unknown, platform?: unknown, arch?: unknown, install?: unknown, locale?: unknown, timeZone?: unknown }} TelemetryEnv
 * @param {TelemetryEnv | null | undefined} env
 */
export function contextOf(env) {
  const version = String(env?.version ?? "");
  return {
    version: /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,24})?$/.test(version) ? version : "other",
    os: oneOf(OS_KINDS, env?.platform),
    arch: oneOf(ARCH_KINDS, env?.arch),
    install: oneOf(INSTALL_KINDS, env?.install),
    language: languageOf(env?.locale),
    timezone: timeZoneOf(env?.timeZone),
  };
}
/** @param {unknown} locale */
function languageOf(locale) {
  try {
    const l = new Intl.Locale(String(locale ?? ""));
    if (!/^[a-z]{2,3}$/.test(l.language)) return "other";
    return l.region && /^(?:[A-Z]{2}|\d{3})$/.test(l.region) ? `${l.language}-${l.region}` : l.language;
  } catch {
    return "other";
  }
}
/** @param {unknown} tz */
function timeZoneOf(tz) {
  const name = String(tz ?? "");
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,39}$/.test(name)) return "other";
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return name;
  } catch {
    return "other";
  }
}

/**
 * The event at each start of Filament's server.
 * @param {TelemetryEnv | null | undefined} env
 */
export function appOpened(env) {
  return { event: TELEMETRY_EVENTS.opened, properties: contextOf(env) };
}

/**
 * One day's facts as the service gathered them, raw: nothing of it is sent as it is.
 * @typedef {object} DayFacts
 * @property {unknown} day  the day, YYYY-MM-DD in the machine's time zone
 * @property {any} [usage]  the day as services/daily-usage.js `list()` gives it: its sums, `hours[24]`, and `rows`, each
 *   by upstream id and model with what was asked (`asked`)
 * @property {any[]} [upstreams]  the configuration's upstreams
 * @property {{ upstream?: string | null, sub?: boolean, n?: number }[]} [runs]  runs started that day by the upstream
 *   each ran on (none: Filament's own loop), `sub` for a sub-agent's
 * @property {Record<string, unknown>} [features]  `FEATURE_SWITCHES` as true or false, `FEATURE_COUNTS` as numbers
 */
/**
 * The summary of a day: the machine and the build (`contextOf`), the day's totals and its requests per local hour,
 * its usage rows by provider kind, agent and model (rows that come to the same three are added), its runs by engine
 * and how many were sub-agents', the switched-on upstreams counted by kind, and the features.
 * @param {DayFacts} facts @param {TelemetryEnv | null | undefined} env
 */
export function dailySummary(facts, env) {
  const upstreams = Array.isArray(facts?.upstreams) ? facts.upstreams.filter((u) => u && typeof u === "object") : [];
  const usage = facts?.usage && typeof facts.usage === "object" ? facts.usage : {};
  const day = String(facts?.day ?? "");

  /** @type {Map<string, any>} */
  const rows = new Map();
  for (const r of Array.isArray(usage.rows) ? usage.rows : []) {
    const u = upstreams.find((x) => x.id === r?.upstream) || null;
    const provider = upstreamKind(u);
    const agent = agentKind(u);
    const model = modelKey(r?.model, { provider, agent });
    const key = `${provider}|${agent || ""}|${model}`;
    const row = rows.get(key) || { provider, ...(agent ? { agent } : {}), model, ...Object.fromEntries([...SUMS, ...DOLLARS].map((k) => [k, 0])) };
    for (const k of SUMS) row[k] += count(r?.[k]);
    for (const k of DOLLARS) row[k] = usd(row[k] + usd(r?.[k]));
    rows.set(key, row);
  }

  /** @type {Record<string, number>} */
  const runs = {};
  let subagents = 0;
  for (const r of Array.isArray(facts?.runs) ? facts.runs : []) {
    const n = count(r?.n ?? 1);
    if (!n) continue;
    const engine = engineOf(r?.upstream, upstreams);
    runs[engine] = (runs[engine] || 0) + n;
    if (r?.sub === true) subagents += n;
  }

  /** @type {Record<string, number>} */
  const providers = {};
  /** @type {Record<string, number>} */
  const agents = {};
  for (const u of upstreams) {
    if (u.enabled === false) continue;
    const agent = agentKind(u);
    if (agent) agents[agent] = (agents[agent] || 0) + 1;
    else {
      const kind = upstreamKind(u);
      providers[kind] = (providers[kind] || 0) + 1;
    }
  }

  /** @type {Record<string, boolean | number>} */
  const features = {};
  const f = facts?.features && typeof facts.features === "object" ? facts.features : {};
  for (const k of FEATURE_SWITCHES) if (typeof f[k] === "boolean") features[k] = f[k];
  for (const k of FEATURE_COUNTS) if (f[k] != null) features[k] = count(f[k]);
  features.subagents = subagents;

  const hours = Array.isArray(usage.hours) && usage.hours.length === 24 ? usage.hours.map(count) : new Array(24).fill(0);
  return {
    event: TELEMETRY_EVENTS.daily,
    properties: {
      ...contextOf(env),
      day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null,
      totals: { ...speedOf(Object.fromEntries(SUMS.map((k) => [k, count(usage[k])]))), ...Object.fromEntries(DOLLARS.map((k) => [k, usd(usage[k])])) },
      hours,
      rows: [...rows.values()].map(speedOf).sort((a, b) => b.requests - a.requests),
      runs,
      accounts: { providers, agents },
      features,
    },
  };
}
/**
 * Sums with their speed in place of the sums it is made of: `tps` (output tokens a second) and `ttftMs` (time to the
 * first byte), each the mean of the requests that rated it, null where none did.
 * @param {Record<string, any>} s
 * @returns {Record<string, any>}
 */
function speedOf({ tpsSum, tpsN, ttftSum, ttftN, ...rest }) {
  return { ...rest, tps: tpsN ? Math.round((tpsSum / tpsN) * 10) / 10 : null, ttftMs: ttftN ? Math.round(ttftSum / ttftN) : null };
}
