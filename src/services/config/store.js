// Config persistence, defaults, validation, and the live store the running app reads through.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  CONFIG_SCHEMA,
  UPSTREAM,
  ROUTE,
  RULES,
  UPSTREAM_TYPES,
  EFFORT_LEVELS,
  defaultsOf,
  isLeaf,
  isAgentUpstream,
} from "../../core/schema.js";
import { keepUnreadable, loadKey, sealConfig, openConfig, secretSlots, stillUnreadable } from "./secrets.js";
import { BILLINGS } from "../../core/pricing.js";
import { RETIRED_SEEDS, agentHomeVar, agentKey, agentRoute, agentUpstream } from "../../core/catalogues.js";
import { withoutUpstreams } from "../../core/routing.js";
import { LAN_PORT_MAX, lanPortOf } from "../lan-tls.js";
import { TAILNET_PORT_MAX, tailnetPortOf } from "../tailscale.js";

export const CONFIG_VERSION = 1;

export function generateKey(prefix = "sk-filament") {
  return `${prefix}-${randomBytes(18).toString("base64url")}`;
}

// `agents`: the coding agents this machine has, each as { upstream, route } — a list or a function returning one. Which
// agents exist is the adapters' knowledge; the composition root hands it in, so the config service imports no bridge.
/** @param {{ agents?: AgentSeed[] | (() => AgentSeed[]) }} [opts] */
export function defaultConfig({ agents = [] } = {}) {
  const cfg = defaultsOf(CONFIG_SCHEMA);
  cfg.version = CONFIG_VERSION;
  cfg.server.inboundKeys = [generateKey()];
  // Every known coding agent is present from the first start; on as the seed says (Claude Code, Codex and Cursor where
  // their programs are found), the others off until connected.
  for (const a of typeof agents === "function" ? agents() : agents) {
    cfg.upstreams.push(a.upstream);
    cfg.routes.push(a.route);
  }
  return normalizeConfig(cfg);
}

// Values typed into a text box or given by the assistant as strings take the type the schema says ("false" -> false,
// "4000" -> 4000, "a, b" -> ["a","b"]); a `=== false` check downstream must not be defeated by a string.
export function coerceLeaf(node, v) {
  if (node.type === "map" && node.itemShape && v && typeof v === "object" && !Array.isArray(v))
    return coerceMapItems(node, v);
  if (v == null || typeof v !== "string") return v;
  const t = String(v).trim();
  if (node.type === "boolean")
    return /^(true|yes|on|1)$/i.test(t) ? true : /^(false|no|off|0)$/i.test(t) ? false : v;
  if (node.type === "number") return t === "" ? null : Number.isFinite(Number(t)) ? Number(t) : v;
  if (node.type === "array")
    return t === ""
      ? []
      : t
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
  if (node.type === "map" || node.type === "list") {
    try {
      const j = JSON.parse(t);
      if (j && typeof j === "object")
        return node.type === "map" && node.itemShape ? coerceMapItems(node, j) : j;
    } catch {}
  }
  return v;
}
// A map whose items have a declared shape (the price tables): fields typed as text become the declared type.
function coerceMapItems(node, obj) {
  const out = {};
  for (const [k, item] of Object.entries(obj)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      out[k] = item;
      continue;
    }
    const it = { ...item };
    for (const [f, type] of Object.entries(node.itemShape)) if (f in it) it[f] = coerceLeaf({ type }, it[f]);
    out[k] = it;
  }
  return out;
}
// Same coercion for sparse override objects (upstream / route rules, acp, qoder): only keys that are present, and
// only the ones the schema knows — a key it does not know drops here, and so does a group left with nothing in it.
export function coerceTree(obj, schema) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || !schema) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const node = schema[k];
    if (!node || k === "_doc") continue;
    if (isLeaf(node)) out[k] = coerceLeaf(node, v);
    else {
      const inner = coerceTree(v, node);
      if (inner && typeof inner === "object" && !Array.isArray(inner) && Object.keys(inner).length) out[k] = inner;
    }
  }
  return out;
}
// A stored config is read the way a write is checked (HarnessV3-AtHome AH-C1): the schema's keys, each its stored value
// or its default, and nothing else — a key the schema does not know drops here, never by a list of names.
function fillDefaults(target, schema) {
  const from = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  const out = {};
  for (const [k, node] of Object.entries(schema)) {
    if (k === "_doc") continue;
    if (isLeaf(node)) out[k] = from[k] === undefined ? structuredClone(node.default) : coerceLeaf(node, from[k]);
    else out[k] = fillDefaults(from[k], node);
  }
  return out;
}

// Rules overrides are stored sparse (only what differs); do not fill them with defaults.
export function normalizeConfig(raw) {
  const cfg = fillDefaults(raw || {}, CONFIG_SCHEMA);
  // The curator's own model left the schema (the memory plan's m1: it curates on memory's); one turned `off` — a
  // curator by rule alone — is carried to the switch that says so, where none says otherwise.
  if (raw?.memory?.models?.curator === "off" && raw?.memory?.curator?.usesModel === undefined) cfg.memory.curator.usesModel = false;
  // The older Worktree switch is no row now (the owner's of 11-09): Where they edit says it. One turned off on Auto is
  // carried to the Session folder, and the switch back to its default, so a later pick of Auto is never undone by it.
  if (raw?.agentLoop?.subagents?.worktree === false) {
    if (cfg.agentLoop.subagents.workspace === "auto") cfg.agentLoop.subagents.workspace = "folder";
    cfg.agentLoop.subagents.worktree = true;
  }
  cfg.version = CONFIG_VERSION;
  const upstreamDefaults = defaultsOf(UPSTREAM);
  cfg.upstreams = (raw?.upstreams || []).map((u) => ({
    ...upstreamDefaults,
    ...coerceTree(u, UPSTREAM),
    rules: coerceTree(u.rules || {}, RULES),
    acp:
      isAgentUpstream(u) || u.acp
        ? { ...upstreamDefaults.acp, ...UPSTREAM_TYPES[u.type]?.agentDefaults, ...coerceTree(u.acp || {}, UPSTREAM.acp) }
        : undefined,
    qoder:
      u.type === "qoder" || u.qoder
        ? { ...upstreamDefaults.qoder, ...coerceTree(u.qoder || {}, UPSTREAM.qoder) }
        : undefined,
  }));
  for (const u of cfg.upstreams) {
    if (u.acp === undefined) delete u.acp;
    if (u.qoder === undefined) delete u.qoder;
  }
  cfg.routes = (raw?.routes || []).map((r) => ({
    ...defaultsOf(ROUTE),
    ...coerceTree(r, ROUTE),
    rules: coerceTree(r.rules || {}, RULES),
  }));
  return cfg;
}

/** One value as JSON, its keys in one order, so two equal values read the same. @param {any} v */
const canon = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );

/**
 * Whether `value` holds a setting that is neither `seed`'s nor the schema's default, the keys in `aside` (by their
 * paths) left out: what a person set on something an install seeded.
 * @param {any} value @param {any} seed @param {any} schema @param {string[]} aside @param {string} [at]
 * @returns {boolean}
 */
function setsMore(value, seed, schema, aside, at = "") {
  if (!value || typeof value !== "object") return false;
  for (const [k, node] of Object.entries(schema)) {
    if (k === "_doc" || value[k] === undefined || aside.includes(at + k)) continue;
    if (isLeaf(node)) {
      if (canon(value[k]) !== canon(node.default) && canon(value[k]) !== canon(seed?.[k])) return true;
    } else if (setsMore(value[k], seed?.[k], node, aside, `${at}${k}.`)) return true;
  }
  return false;
}

/**
 * Whether a retired agent's connection, once off, leaves the settings as they are next read (`withoutRetiredAgents`):
 * it is the one an install seeded (core/catalogues.js `RETIRED_SEEDS`, by its id) and holds nothing of the person's.
 * Theirs (the Fable 5.2 re-read's finding 7: only a variable, an MCP server, a model name and a folder counted, so
 * arguments, a permission policy, rules and routes made by hand went with it, unsaid): a setting of its upstream that
 * is neither the seeded one nor Filament's default — whether it is on aside —, a route to it that is not the seeded
 * one, a fallback that names it, another upstream that runs the same agent.
 * @param {any} cfg  the config it stands in @param {any} u  its upstream
 * @returns {boolean}
 */
export function retiredLeaves(cfg, u) {
  const a = Object.hasOwn(RETIRED_SEEDS, u?.id) ? RETIRED_SEEDS[u.id] : null;
  if (!a) return false;
  const seed = normalizeConfig({ upstreams: [agentUpstream(a)], routes: [agentRoute(a)] });
  if (u.type !== seed.upstreams[0].type || setsMore(u, seed.upstreams[0], UPSTREAM, ["id", "type", "enabled", "acp.turnedOff", "acp.accountOff"])) return false;
  if ((cfg?.upstreams || []).some((/** @type {any} */ x) => x.id !== u.id && isAgentUpstream(x) && agentKey(x) === agentKey(u))) return false;
  return !(cfg?.routes || []).some((/** @type {any} */ r) =>
    r.upstream === u.id
      ? r.match !== seed.routes[0].match || setsMore(r, seed.routes[0], ROUTE, ["match", "upstream", "enabled"])
      : (r.fallbacks || []).some((/** @type {any} */ f) => f?.upstream === u.id));
}

/**
 * Gemini CLI left Filament's agents (the owner's of 11-10: Google retired it for Antigravity): the connection an
 * install seeded, still off and holding nothing of the person's (`retiredLeaves`), goes as the settings are read, with
 * its route, whose `gemini/*` would hold Google's API's names. One turned on stays, as an agent made by hand, its card
 * saying why and what becomes of it (core/catalogues.js `RETIRED_AGENTS`); so does one turned off later, until the
 * settings are read again. Never on a write: a Turn off would take it from under its own process (the review of 11-10).
 * @param {any} cfg  a normalized config @returns {any} the same config where nothing goes, else a new one
 */
export function withoutRetiredAgents(cfg) {
  const retired = new Set((cfg.upstreams || []).filter((u) => u.enabled === false && retiredLeaves(cfg, u)).map((u) => u.id));
  return retired.size ? withoutUpstreams(cfg, retired) : cfg;
}
/**
 * What of `value` differs from `schema`'s defaults: a leaf where it differs, a group where anything under it does.
 * `always` names the keys written whatever they hold (what names an upstream or a route).
 * @param {any} value @param {any} schema @param {string[]} [always]
 */
function diffOf(value, schema, always = []) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, node] of Object.entries(schema)) {
    if (k === "_doc" || value[k] === undefined) continue;
    if (always.includes(k)) out[k] = value[k];
    else if (isLeaf(node)) {
      if (canon(value[k]) !== canon(node.default)) out[k] = value[k];
    } else {
      const inner = diffOf(value[k], node);
      if (Object.keys(inner).length) out[k] = inner;
    }
  }
  return out;
}

/**
 * What config.json holds (HarnessV3-AtHome AH-C3): its version, the upstreams and the routes always, and every other
 * value only where it differs from its default — so a default the build changes reaches every install whose person
 * never set that value. An upstream and a route are written the same way against their own defaults, with what names
 * each always; their `rules` are overrides already.
 * @param {any} cfg  a normalized config
 */
export function sparseConfig(cfg) {
  /** @type {Record<string, [any, string[]]>} */
  const LISTS = {
    upstreams: [UPSTREAM, ["id", "type"]],
    routes: [ROUTE, ["match", "upstream"]],
  };
  /** @type {Record<string, any>} */
  const out = { version: CONFIG_VERSION, ...diffOf(cfg, CONFIG_SCHEMA) };
  for (const [k, [schema, always]] of Object.entries(LISTS)) out[k] = (cfg?.[k] || []).map((/** @type {any} */ x) => diffOf(x, schema, always));
  return out;
}

/** Whether a config holds an account on Cursor's SDK that is switched on. @param {any} cfg */
const runsCursorSdk = (cfg) => (cfg?.upstreams || []).some((/** @type {any} */ u) => u?.type === "cursor-sdk" && u.enabled !== false);

export function validateConfig(cfg) {
  const errors = [];
  const ids = new Set();
  if (!Number.isInteger(cfg.server?.port) || cfg.server.port < 1 || cfg.server.port > 65535)
    errors.push("server.port must be 1-65535");
  // The network listener's port (Settings › Remote access), with its artifacts' at the one after it: one the listener
  // reads as it is (lan-tls.js `lanPortOf`), or none is saved. On, it is neither the loopback listener's nor the one before
  // it; off, its default may be either, and a save of anything else goes on.
  const lan = cfg.server?.lan;
  if (lan && lan.port !== undefined) {
    if (lanPortOf(lan) !== lan.port)
      errors.push(`server.lan.port must be a whole number from 0 to ${LAN_PORT_MAX} (0 picks a free port; the artifacts' network address takes the port after it)`);
    else if (lan.enabled === true && lan.port !== 0 && lan.port === cfg.server.port)
      errors.push(`server.lan.port ${lan.port} is server.port, where this machine's apps call Filament: the network listener takes a port of its own — choose another, or 0 for any free one`);
    else if (lan.enabled === true && lan.port !== 0 && lan.port + 1 === cfg.server.port)
      errors.push(`server.lan.port ${lan.port} puts the artifacts' network address, at the port after it, on server.port (${cfg.server.port}): choose another, or 0 for any free one`);
  }
  // The tailnet's door (Settings › Remote access › Share on my tailnet), with its artifacts' at the one after it: none of
  // the loopback listener's nor, while it is on, the network listener's and its artifacts'.
  const ts = cfg.server?.tailscale;
  if (ts && ts.port !== undefined) {
    const taken = [cfg.server.port, ...(lan?.enabled === true && lanPortOf(lan) !== 0 ? [lanPortOf(lan), lanPortOf(lan) + 1] : [])];
    if (tailnetPortOf(ts) !== ts.port) errors.push(`server.tailscale.port must be a whole number from 0 to ${TAILNET_PORT_MAX} (0 picks a free port; the artifacts' door takes the port after it)`);
    else if (ts.serve === true && ts.port !== 0 && (taken.includes(ts.port) || taken.includes(ts.port + 1)))
      errors.push(`server.tailscale.port ${ts.port} or the port after it is one of Filament's other listeners' (server.port, or the network listener's and its artifacts'): the tailnet's door takes two ports of its own — choose another`);
  }
  for (const [i, u] of (cfg.upstreams || []).entries()) {
    const at = `upstreams[${i}]`;
    // A name, never a value that only reads like one: `["claude-code"]` passed the pattern as its text and was no
    // duplicate of `claude-code`, while a turn finds an upstream by `id ===` (routing.js `findUpstream`).
    if (typeof u.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(u.id))
      errors.push(`${at}.id must be letters, digits, dashes or underscores`);
    else if (ids.has(u.id)) errors.push(`${at}.id "${u.id}" is duplicated`);
    else ids.add(u.id);
    if (!UPSTREAM_TYPES[u.type]) errors.push(`${at}.type "${u.type}" is unknown`);
    if (u.billing != null && !BILLINGS.includes(u.billing)) errors.push(`${at}.billing must be ${BILLINGS.join(" or ")} (empty follows the catalogue, else metered)`);
    if (UPSTREAM_TYPES[u.type]?.local) {
      if (!u.acp?.command) errors.push(`${at}.acp.command is required for a coding agent`);
      // An account's own folder (HarnessV3-ACP AC3-7): only an agent whose CLI reads one can keep a second login.
      const home = String(u.acp?.home || "").trim();
      if (home && !isAbsolute(home)) errors.push(`${at}.acp.home "${home}" is not a folder path: give a full path, or leave it empty for the agent's usual folder`);
      else if (home && !agentHomeVar(u))
        errors.push(`${at}.acp.home: this agent has no setting for a folder of its own, so it keeps one account — leave acp.home empty`);
      continue;
    }
    if (UPSTREAM_TYPES[u.type]?.builtin) continue; // no URL: Filament knows the endpoints
    // Another machine's models: its address, certificate and token are the machines store's (remotes.json), read at
    // each call, and its path and headers the wire's own — none of them is set here.
    if (UPSTREAM_TYPES[u.type]?.machine) {
      if (!String(u.machine || "").trim()) errors.push(`${at}.machine names the paired machine whose models it offers: its id, as this machine keeps it`);
      const set = [
        String(u.baseUrl || "").trim() && "baseUrl",
        String(u.apiKey || "") && "apiKey",
        Object.keys(u.headers || {}).length && "headers",
        String(u.modelsPath || "").trim() && "modelsPath",
        (u.authStyle || "auto") !== "auto" && "authStyle",
      ].filter(Boolean);
      if (set.length)
        errors.push(`${at} (${u.id || "?"}) is another machine's models, which takes no ${set.join(", ")}: its address, certificate and token are kept in Settings › Remote access, and its path and headers are the wire's own`);
      continue;
    }
    const base = u.baseUrl || UPSTREAM_TYPES[u.type]?.baseUrl;
    if (!base) errors.push(`${at}.baseUrl is required for type ${u.type}`);
    else {
      try {
        new URL(base);
      } catch {
        errors.push(`${at}.baseUrl is not a valid URL`);
      }
    }
  }
  for (const [i, r] of (cfg.routes || []).entries()) {
    const at = `routes[${i}]`;
    if (!r.match) errors.push(`${at}.match is required`);
    if (!r.upstream) errors.push(`${at}.upstream is required`);
    else if (!ids.has(r.upstream))
      errors.push(
        `${at} (${r.match || "?"}) points at upstream "${r.upstream}", which does not exist: remove that route or give it another upstream`,
      );
    for (const [j, f] of (r.fallbacks || []).entries())
      if (f.upstream && !ids.has(f.upstream))
        errors.push(`${at}.fallbacks[${j}].upstream "${f.upstream}" does not exist`);
    if (r.rules?.effort?.suffixes && !Array.isArray(r.rules.effort.suffixes))
      errors.push(`${at}.rules.effort.suffixes must be a list`);
  }
  const rx = (v, where) => {
    if (v) {
      try {
        new RegExp(v);
      } catch {
        errors.push(`${where} is not a valid regular expression`);
      }
    }
  };
  for (const pat of ["adaptiveOnlyModels", "rejectsDisabledModels", "noAdaptiveModels", "displayModels"])
    rx(cfg.rules?.thinking?.[pat], `rules.thinking.${pat}`);
  rx(cfg.rules?.speed?.models, "rules.speed.models");
  rx(cfg.rules?.tools?.forcedToolChoiceModels, "rules.tools.forcedToolChoiceModels");
  (cfg.rules?.effort?.modelCaps || []).forEach((c, i) => rx(c?.match, `rules.effort.modelCaps[${i}].match`));
  (cfg.rules?.params?.stripRules || []).forEach((c, i) =>
    rx(c?.match, `rules.params.stripRules[${i}].match`),
  );
  // A word that is none of the permission policies is refused here, at every save: the bridges ask for one where
  // someone can be asked and refuse it where nobody can, and only a config.json edited by hand reaches them with it.
  const policies = UPSTREAM.acp.permissions.options;
  for (const [i, u] of (cfg.upstreams || []).entries()) {
    const policy = u.acp?.permissions;
    if (policy != null && policy !== "" && !policies.includes(policy))
      errors.push(`upstreams[${i}].acp.permissions "${policy}" is none of the permission policies: use ${policies.slice(0, -1).join(", ")} or ${policies.at(-1)}`);
    rx(u.acp?.cwdPattern, `upstreams[${i}].acp.cwdPattern`);
    for (const [j, e] of (u.acp?.cwdAllowlist || []).entries())
      if (!isAbsolute(String(e ?? "").trim()))
        errors.push(
          `upstreams[${i}].acp.cwdAllowlist[${j}] "${e}" is not a folder path; list full folder paths such as C:\\Projects (or /home/you/projects), or leave the list empty (the permissions policy belongs in acp.permissions)`,
        );
  }
  // A model card's capability fields (the Upstreams page's Tune): a level Filament cannot send, a window that is not a
  // token count, a multiplier under 1 or request fields that are not an object would each be read as nonsense.
  for (const [i, u] of (cfg.upstreams || []).entries())
    for (const [name, row] of Object.entries(u?.pricing || {})) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const at = `upstreams[${i}].pricing["${name}"]`;
      if (row.efforts != null && (!Array.isArray(row.efforts) || row.efforts.some((l) => !EFFORT_LEVELS.includes(String(l).trim().toLowerCase()))))
        errors.push(`${at}.efforts must list effort levels (${EFFORT_LEVELS.join(", ")}); [] says the model takes none`);
      if (row.effortDefault != null && !EFFORT_LEVELS.includes(String(row.effortDefault).trim().toLowerCase()))
        errors.push(`${at}.effortDefault must be one of ${EFFORT_LEVELS.join(", ")}`);
      for (const f of ["fast", "flex", "thinking", "keepsThinking", "tools"])
        if (row[f] != null && typeof row[f] !== "boolean") errors.push(`${at}.${f} must be true or false`);
      if (row.billing != null && !BILLINGS.includes(row.billing)) errors.push(`${at}.billing must be ${BILLINGS.join(" or ")} (empty follows the upstream)`);
      if (row.fastMultiplier != null && !(Number(row.fastMultiplier) >= 1))
        errors.push(`${at}.fastMultiplier must be a number of at least 1 (2 = twice the standard price)`);
      if (row.windowMultipliers != null && (typeof row.windowMultipliers !== "object" || Array.isArray(row.windowMultipliers) || Object.entries(row.windowMultipliers).some(([w, x]) => !(Number(w) >= 1000) || !(Number(x) >= 1))))
        errors.push(`${at}.windowMultipliers must map context windows (tokens, at least 1000) to what each costs against the cheapest, at least 1 — {"1000000": 2}`);
      if (row.fastParams != null && (typeof row.fastParams !== "object" || Array.isArray(row.fastParams)))
        errors.push(`${at}.fastParams must be an object of request fields, such as {"service_tier": "priority"}`);
      if (row.flexMultiplier != null && !(Number(row.flexMultiplier) > 0 && Number(row.flexMultiplier) <= 1))
        errors.push(`${at}.flexMultiplier must be a number above 0 and at most 1 (0.5 = half the standard price)`);
      if (row.flexParams != null && (typeof row.flexParams !== "object" || Array.isArray(row.flexParams)))
        errors.push(`${at}.flexParams must be an object of request fields, such as {"service_tier": "flex"}`);
      if (row.windows != null && (!Array.isArray(row.windows) || row.windows.some((n) => !(Number(n) >= 1000))))
        errors.push(`${at}.windows must list context windows in tokens, each at least 1000`);
      // Prices too: a negative one would be billed as a refund.
      for (const f of ["input", "output", "cacheRead", "cacheWrite", "contextTokens", "maxOutputTokens", "maxConcurrency"])
        if (row[f] != null && !(typeof row[f] === "number" && Number.isFinite(row[f]) && row[f] >= 0))
          errors.push(`${at}.${f} must be a number of at least 0 (empty = not stated)`);
    }
  // The variables commands are given whatever their names read like (hands.js `safeEnv`; r-hands, 11-12): names, never
  // a value — `NAME=value` typed whole would keep the value in the configuration, so the refusal does not repeat the
  // entry —, and none of Filament's own, which no command is given.
  const passed = cfg.agentLoop?.envPass;
  if (passed != null && !Array.isArray(passed)) errors.push("agentLoop.envPass must be a list of variable names");
  for (const [i, name] of (Array.isArray(passed) ? passed : []).entries()) {
    if (typeof name !== "string" || !/^[^\s=]+$/.test(name)) errors.push(`agentLoop.envPass[${i}] must be a variable's name alone, such as HTTPS_PROXY: no value, no "=" and no space`);
    else if (/^FILAMENT_/i.test(name)) errors.push(`agentLoop.envPass[${i}] "${name}" is one of Filament's own variables, which no command is given`);
  }
  return { ok: errors.length === 0, errors };
}

/** Filament's own folder: the checkout, or the installed app's `resources/app`. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Whether this Filament runs from a git checkout: its own folder holds `.git` (a folder, or a worktree's file). The
 * installed app's holds none.
 * @param {string} [root]
 */
export const isCheckout = (root = ROOT) => existsSync(join(root, ".git"));

/** The port a checkout's data folder starts with, beside the installed app's 20300 (the owner's of 10-28). */
export const DEV_PORT = 20301;

/**
 * Filament's folder in the user's application-data folder — `%APPDATA%\Filament` on Windows, the XDG config folder's
 * `filament` elsewhere: the installed app's. `dev`: `Filament-dev` (`filament-dev`) beside it, a checkout's.
 * @param {{ dev?: boolean }} [o]
 */
export function appDataDir({ dev = false } = {}) {
  const tail = dev ? "-dev" : "";
  return process.platform === "win32"
    ? join(process.env.APPDATA || process.env.USERPROFILE || ".", `Filament${tail}`)
    : join(process.env.XDG_CONFIG_HOME || join(process.env.HOME || ".", ".config"), `filament${tail}`);
}

/**
 * The data folder: the one given, `FILAMENT_DATA_DIR`, else Filament's in the user's application-data folder — the
 * dev one when run from a checkout, so a Filament being worked on never opens the installed app's chats, memory and
 * keys (see `appDataDir`).
 * @param {string | null} [explicit] @param {{ checkout?: boolean }} [o]
 */
export function resolveDataDir(explicit, { checkout = isCheckout() } = {}) {
  if (explicit) return explicit;
  if (process.env.FILAMENT_DATA_DIR) return process.env.FILAMENT_DATA_DIR;
  return appDataDir({ dev: checkout });
}

/**
 * The port a data folder's first config holds, and the one the desktop app looks at before there is a config:
 * `DEV_PORT` for the checkout's folder, so it runs beside the installed app, else the default.
 * @param {string} dataDir
 */
export function defaultPort(dataDir) {
  const f = (/** @type {string} */ p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return f(dataDir) === f(appDataDir({ dev: true })) ? DEV_PORT : Number(defaultsOf(CONFIG_SCHEMA).server.port);
}

/** @param {string} dataDir @param {{ agents?: AgentSeed[] | (() => AgentSeed[]) }} [opts]  the first-run seed, see `defaultConfig` */
export function loadConfig(dataDir, { agents = [] } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "config.json");
  if (!existsSync(file)) {
    const cfg = defaultConfig({ agents });
    cfg.server.port = defaultPort(dataDir);
    saveConfig(dataDir, cfg);
    return { config: cfg, created: true, file };
  }
  let raw;
  const text = readFileSync(file, "utf8");
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const backup = `${file}.broken-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      copyFileSync(file, backup);
    } catch {}
    throw new Error(
      `${file} is not valid JSON (${e.message}). A copy was saved as ${backup}. Fix the file, or delete config.json to start again with defaults (secret.key keeps your encrypted values readable).`,
    );
  }
  const encrypt = raw?.server?.encryptSecrets !== false;
  const key = loadKey(dataDir, { create: encrypt });
  const opened = openConfig(raw, key);
  const read = normalizeConfig(opened.config);
  const config = withoutRetiredAgents(read);
  let mustSave = config !== read;
  // Cursor's SDK went behind Settings › Experimental's switch on 11-10, off by default: a config whose person runs an
  // account on it and never set the switch — one from before it — reads as on, or the account goes from the pickers on
  // upgrade with no word (the re-read of 11-11). Here alone, and it asks for no save: the file holds the switch once
  // something is saved — as on, ahead of a save of this read's own, which would else write it off (`saveConfig`, as
  // it writes one the person turned off, so that stays off).
  if (raw?.experimental?.cursorSdk === undefined && runsCursorSdk(config)) config.experimental.cursorSdk = true;
  if (!config.server.inboundKeys?.length) {
    config.server.inboundKeys = [generateKey()];
    mustSave = true;
  } // and remember it, or every restart would mint a new one
  // a hand-edited file: any plain-text secret gets sealed right away
  let plainSecret = false;
  try {
    plainSecret =
      secretSlots(raw).some(
        ([obj, k]) => typeof obj?.[k] === "string" && obj[k] && !String(obj[k]).startsWith("enc:v1:"),
      ) ||
      (Array.isArray(raw?.server?.inboundKeys) &&
        raw.server.inboundKeys.some((k) => typeof k === "string" && k && !k.startsWith("enc:v1:")));
  } catch {}
  if (mustSave || (encrypt && plainSecret)) saveConfig(dataDir, config);
  return { config, created: false, file, secretProblems: opened.problems, unreadable: opened.unreadable };
}

/** The config as stored on disk, or null where there is none or it does not read. @param {string} file */
function storedConfig(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The data folder's secret.key where it has a readable one, else null; none is made. @param {string} dataDir */
function keyIfAny(dataDir) {
  try {
    return loadKey(dataDir, { create: false });
  } catch {
    return null;
  }
}

/** @param {string} dataDir @param {any} cfg @param {{ forget?: string[] }} [o] */
export function saveConfig(dataDir, cfg, { forget = [] } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "config.json");
  const tmp = file + ".tmp";
  const encrypt = cfg?.server?.encryptSecrets !== false;
  const key = encrypt ? loadKey(dataDir) : keyIfAny(dataDir);
  // What the file holds sealed that this key cannot open stays as it is (`keepUnreadable`): a secret.key missing or
  // another's costs no secret (the bug hunt of 10-30, SEC-1). One the person removed (`forget`) goes.
  const sparse = sparseConfig(keepUnreadable(cfg, storedConfig(file), key, { forget }));
  // Cursor's SDK's switch turned off is written beside an account on it, though off is its default: left out, the next
  // read would take it as never set, and count it on (`loadConfig`).
  if (cfg?.experimental?.cursorSdk === false && runsCursorSdk(cfg)) sparse.experimental = { ...sparse.experimental, cursorSdk: false };
  const toWrite = encrypt ? sealConfig(sparse, key) : sparse;
  // Its owner's alone, as secret.key is: a secret left open (encryptSecrets off) is no other account's to read (the bug
  // hunt of 10-30, SEC-7).
  writeFileSync(tmp, JSON.stringify(toWrite, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
  return file;
}

/** A secret as a page shows it: its first and last four characters, or dots where it is too short to show any. */
const maskOf = (s) => (typeof s === "string" && s.length > 8 ? s.slice(0, 4) + "…" + s.slice(-4) : s ? "••••" : "");

// Redact secrets for API responses / UI. `masked`: each key's first and last four characters beside it, for a page to
// tell keys apart; the assistant's view takes none, so no part of a key goes into a model's prompt (the bug hunt of
// 10-30, SEC-4). `unreadable`: the places whose stored value this secret.key cannot open (the store's `unreadable()`),
// each shown as a value kept, with no mask: a page keeps it under its own name, and the file keeps it until a value
// is typed in its place.
/** @param {any} cfg @param {{ masked?: boolean, unreadable?: string[] }} [o] */
export function redactConfig(cfg, { masked = true, unreadable = [] } = {}) {
  const c = structuredClone(cfg);
  for (const u of c.upstreams || []) {
    if (u.apiKey) {
      if (masked) u.apiKeyMasked = maskOf(u.apiKey);
      u.apiKey = "__SECRET__";
    }
    if (u.qoder) {
      for (const k of ["accessToken", "refreshToken"])
        if (u.qoder[k]) {
          if (masked) u.qoder[`${k}Masked`] = maskOf(u.qoder[k]);
          u.qoder[k] = "__SECRET__";
        }
    }
  }
  if (c.server?.adminToken) c.server.adminToken = "__SECRET__";
  if (c.agentLoop?.web?.searchApiKey) c.agentLoop.web.searchApiKey = "__SECRET__";
  if (Array.isArray(c.server?.inboundKeys)) {
    if (masked) c.server.inboundKeysMasked = c.server.inboundKeys.map(maskOf);
    c.server.inboundKeys = c.server.inboundKeys.map(() => "__SECRET__");
  }
  for (const [obj, k, where] of secretSlots(c))
    if (/\.env\.|\.headers\./.test(where) && typeof obj[k] === "string" && obj[k]) obj[k] = "__SECRET__";
  if (unreadable.length) {
    const lost = new Set(unreadable);
    for (const [obj, k, where] of secretSlots(c)) if (lost.has(where) && (obj[k] == null || obj[k] === "")) obj[k] = "__SECRET__";
  }
  return c;
}

/**
 * The configuration as a page reads it (GET /api/state, a Save's and a reload's answers): redacted, each place whose
 * stored value this secret.key cannot open shown as a value kept and named beside it (`unreadable`), for its card and
 * the Settings page to say so.
 * @param {{ get: () => any, unreadable: () => string[] }} config  the ConfigStore
 */
export function configView(config) {
  const unreadable = config.unreadable();
  return { config: redactConfig(config.get(), { unreadable }), unreadable };
}

/**
 * Each place a configuration holds the placeholder, named as its changes are (describeDiff): an upstream by its id, a
 * route by its match. @param {any} c @returns {string[]}
 */
function placeholdersIn(c) {
  /** @type {string[]} */
  const out = [];
  /** @param {any} v @param {string} at */
  const walk = (v, at) => {
    if (v === "__SECRET__") out.push(at);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
  };
  for (const [k, v] of Object.entries(c || {}))
    if ((k === "upstreams" || k === "routes") && Array.isArray(v)) v.forEach((x, i) => walk(x, `${k}.${(k === "upstreams" ? x?.id : x?.match) ?? i}`));
    else walk(v, k);
  return out;
}

/** The id a page's upstream was read under: the one it was renamed from (`renamedFrom`), else its own. @param {any} u */
const readAs = (u) => (typeof u?.renamedFrom === "string" && u.renamedFrom) || u?.id;

/**
 * The places of `unreadable` a page's configuration empties on purpose. The page was shown each as a value kept
 * (`redactConfig`), so a field merely left empty sends the placeholder back, and an empty value is a Remove: the
 * person's own act, which forgets it (the store's `save({ forget })`).
 * @param {any} incoming @param {string[]} unreadable @returns {string[]}
 */
export function forgottenIn(incoming, unreadable) {
  if (!unreadable.length) return [];
  const lost = new Set(unreadable);
  return secretSlots(incoming, { idOf: readAs }).filter(([o, k, where]) => lost.has(where) && o?.[k] === "").map(([, , where]) => where);
}

/**
 * A configuration a page sends back, each "__SECRET__" placeholder the secret kept where the page read it, in `existing`
 * (the configuration as the page read it). An upstream the page renamed names the id it was read under (`renamedFrom`)
 * and takes the secrets kept under it; the inbound keys come back by the masks beside them. A placeholder that stands
 * for nothing kept — a header or a variable renamed with it, an id changed by hand — refuses the save in words, which
 * tell an upstream renamed by hand how to name the id it had; so does one that would take to a new name a secret this
 * secret.key cannot open (`unreadable`), which the file keeps under its own: a secret is never dropped, nor the
 * placeholder saved as a value (the bug hunt of 10-30).
 * @param {any} incoming @param {any} existing @param {{ unreadable?: string[] }} [o]
 */
export function mergeSecrets(incoming, existing, { unreadable = [] } = {}) {
  const out = structuredClone(incoming);
  const stored = new Map(secretSlots(existing).map(([obj, k, where]) => [where, obj[k]]));
  const lost = new Set(unreadable);
  const asRead = secretSlots(out, { idOf: readAs });
  const asNow = secretSlots(out);
  const kept = new Set((existing.upstreams || []).map((/** @type {any} */ u) => u.id));
  /** The upstreams read under an id the configuration does not hold: new here, or renamed by hand. */
  const fresh = (out.upstreams || []).filter((/** @type {any} */ u) => !kept.has(readAs(u))).map((/** @type {any} */ u) => u.id);
  /** @type {string[]} */
  const stuck = [];
  asRead.forEach(([obj, k, where], i) => {
    if (obj[k] !== "__SECRET__" || !stored.has(where)) return;
    if (lost.has(where) && where !== asNow[i][2]) {
      stuck.push(`${where} cannot be read (it was sealed with another secret.key), so it cannot move to ${asNow[i][2]}`);
      obj[k] = ""; // said below, and the save refused
      return;
    }
    const v = stored.get(where);
    obj[k] = typeof v === "string" ? v : "";
  });
  for (const u of out.upstreams || []) {
    delete u.renamedFrom;
    delete u.apiKeyMasked;
    if (u.qoder) for (const k of ["accessToken", "refreshToken"]) delete u.qoder[`${k}Masked`];
  }
  if (Array.isArray(out.server?.inboundKeys)) {
    out.server.inboundKeys = inboundBack(out.server.inboundKeys, out.server.inboundKeysMasked, existing.server?.inboundKeys);
    delete out.server.inboundKeysMasked;
  }
  const left = placeholdersIn(out);
  if (left.length || stuck.length) {
    const byHand = fresh.filter((id) => left.some((at) => at.startsWith(`upstreams.${id}.`)));
    const said = [
      ...(left.length ? [`nothing is kept for ${left.join(", ")}, where this page holds __SECRET__ (a value kept under the name it was read with): ${left.length === 1 ? "type the value again, or put back the name it had" : "type each value again, or put back the names they had"}`] : []),
      ...(byHand.length ? [`${byHand.map((id) => `upstreams.${id}`).join(", ")} ${byHand.length === 1 ? "has an id" : "have ids"} the configuration does not hold: an upstream renamed here takes its secrets with it when it names the id it had — add "renamedFrom": "<the id it had>" to it`] : []),
      ...stuck.map((s) => `${s}: put back the secret.key it was sealed with and start Filament again, or type the value again`),
    ];
    // `places`: where a placeholder stands for nothing kept, for a caller that says it in words of its own.
    throw Object.assign(new Error(`Not saved: ${said.join("; ")}.`), { status: 400, places: left });
  }
  return out;
}

/**
 * The inbound keys a page sends back, their placeholders made keys again: each the stored key its mask beside it names,
 * where the page sent its masks in step with its keys — so a key taken out of the list takes out that one, never the
 * last (the bug hunt of 10-30, SEC-8) — else the stored key at its place. A mask no stored key has names a key no
 * longer kept: nothing comes back for it.
 * @param {unknown[]} keys @param {unknown} masks @param {unknown} stored
 * @returns {string[]}
 */
function inboundBack(keys, masks, stored) {
  const have = Array.isArray(stored) ? stored : [];
  const named = Array.isArray(masks) && masks.length === keys.length;
  /** @type {Set<number>} */
  const taken = new Set();
  return /** @type {string[]} */ (
    keys
      .map((k, i) => {
        if (k !== "__SECRET__") return k;
        if (!named) return have[i];
        const at = [i, ...have.keys()].find((j) => j < have.length && !taken.has(j) && maskOf(have[j]) === masks[i]);
        if (at === undefined) return undefined;
        taken.add(at);
        return have[at];
      })
      .filter((k) => typeof k === "string" && k)
  );
}

/**
 * The inbound keys a draft keeps, against the keys it was read with and the keys as they stand: unchanged, the keys as
 * they stand; changed, the draft's, with each key made since it was read (a rotate's) first and each one taken out since
 * left out — a key changed elsewhere is never dropped, nor one taken out put back (the bug hunt of 10-30, SEC-8).
 * @param {unknown} mine @param {unknown} was @param {string[]} now
 */
function inboundNow(mine, was, now) {
  if (JSON.stringify(mine ?? null) === JSON.stringify(was ?? null)) return [...now];
  if (!Array.isArray(mine)) return mine;
  const before = Array.isArray(was) ? was : [];
  const made = now.filter((k) => !before.includes(k));
  const gone = new Set(before.filter((k) => !now.includes(k)));
  return [...made, ...mine.filter((k) => !gone.has(k) && !made.includes(k))];
}

/**
 * A draft written whole over the configuration as it stands (the console's assistant's Apply, a console Save after
 * Keep mine): each secret the draft never changed since it was read is the configuration's now, so a key rotated, a
 * sign-in's tokens refreshed or a key pasted meanwhile stay, never put back as they were when the draft was read (the
 * bug hunt of 10-30, SEC-5, SEC-8).
 * @param {any} draft  the draft as it stands @param {any} base  the configuration it was read from
 * @param {any} now  the configuration as it stands
 */
export function secretsNow(draft, base, now) {
  const out = structuredClone(draft);
  const was = new Map(secretSlots(base).map(([o, k, where]) => [where, o[k]]));
  const is = new Map(secretSlots(now).map(([o, k, where]) => [where, o[k]]));
  for (const [o, k, where] of secretSlots(out))
    if (was.has(where) && o[k] === was.get(where) && is.has(where)) {
      if (is.get(where) === undefined) delete o[k];
      else o[k] = is.get(where);
    }
  if (out.server && Array.isArray(now?.server?.inboundKeys)) out.server.inboundKeys = inboundNow(out.server.inboundKeys, base?.server?.inboundKeys, now.server.inboundKeys);
  return out;
}

/**
 * What `--port` was given, as a number. 0 asks the system for a free port, and the server says which it got; anything
 * that is not a port is refused in words, never swapped for the config's.
 * @param {string | undefined} text
 */
export function portOption(text) {
  const n = /^\d+$/.test(String(text ?? "").trim()) ? Number(text) : NaN;
  if (!(n <= 65535)) throw new Error(`--port takes a number from 0 to 65535 (0 picks a free port); it was given ${text === undefined ? "nothing" : JSON.stringify(text)}`);
  return n;
}

/**
 * Whether a listener's host is this machine's own: `localhost`, any address of 127.0.0.0/8, `::1`, or an IPv4 loopback
 * address written as IPv6 (`::ffff:127.0.0.1`), however each is spelled (`127.1`, `[::1]`). A wildcard (0.0.0.0, ::,
 * none), a name, or any other address reaches beyond this machine.
 * @param {unknown} host
 */
export function loopbackHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (h === "localhost") return true;
  let name = "";
  try {
    name = new URL(`http://${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}/`).hostname;
  } catch {
    return false;
  }
  return /^127\.\d+\.\d+\.\d+$/.test(name) || name === "[::1]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(name);
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
 * Where an app on this machine reaches Filament, from its `server` settings, as a URL: a wildcard host (0.0.0.0, ::)
 * or none is `localhost`, an IPv6 address goes in brackets.
 * @param {{ host?: string, port: number }} server
 */
export function serverAddress(server) {
  const host = String(server.host || "").trim();
  return `http://${hostAndPort(!host || host === "0.0.0.0" || host === "::" || host === "[::]" ? "localhost" : host, server.port)}`;
}

/**
 * Where Filament reaches itself — its calls to its own doors, and the addresses it hands out for them: the address it
 * listens on, as a URL. A wildcard is this machine's loopback of the same family (127.0.0.1 for 0.0.0.0 or none, [::1]
 * for ::), any other address that address, an IPv6 one in brackets.
 * @param {{ address?: string, host?: string, port: number }} at  the listener's address once it listens (`server.address()`),
 *   else the `server` settings it will listen on
 */
export function selfAddress(at) {
  const a = String(at.address ?? at.host ?? "").trim().replace(/^\[|\]$/g, "");
  return `http://${hostAndPort(!a || a === "0.0.0.0" ? "127.0.0.1" : a === "::" ? "::1" : a, at.port)}`;
}

/** @typedef {import("../../core/ports.js").ConfigStore} ConfigStore */
/** @typedef {{ upstream: any, route: any }} AgentSeed  one detected coding agent as its upstream entry and its route */

/** How many saved versions the store keeps, for telling a stale draft what changed since it was read (HS-D3). */
const KEPT_VERSIONS = 50;

/**
 * The live configuration: one object everyone reads through `get()`, replaced whole by `set()` (normalised on the way
 * in), written by `save()`, with every subscriber told after each replacement — the memory service, the health board
 * and the stores re-read their knobs that way instead of being poked one by one. `loaded` is what loading reported
 * besides the config: whether the file was created and which secrets could not be read.
 * Every save and every reload moves the configuration's `version()` on by one (HarnessV4_Settings_Plan HS-D3), tells
 * `onSaved` subscribers, and keeps a copy of what that version holds: `at(v)` answers it for the last fifty, so a page
 * that read version v can be told what changed since — a change written in place (a sign-in's tokens) included.
 * `unreadable()` names the places whose stored value this secret.key cannot open, as loading found them (openConfig):
 * the file keeps each until a value is saved in its place, its upstream goes, or a save forgets it as a Remove does
 * (`save({ forget })`; keepUnreadable).
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {AgentSeed[] | (() => AgentSeed[])} [opts.agents]  the first-run seed, see `defaultConfig`
 * @param {{ port?: number, host?: string }} [opts.overrides]  command-line overrides applied to the loaded config
 * @returns {ConfigStore}
 */
export function createConfigStore({ dataDir, agents = [], overrides = {} }) {
  const loaded = loadConfig(dataDir, { agents });
  let current = loaded.config;
  if (overrides.port != null) current.server.port = overrides.port;
  if (overrides.host) current.server.host = overrides.host;
  /** @type {Set<(cfg: any) => void>} */
  const listeners = new Set();
  /** @type {Set<(version: number) => void>} */
  const savedListeners = new Set();
  let version = 1;
  /** @type {{ version: number, cfg: any }[]} */
  const kept = [{ version, cfg: structuredClone(current) }];
  /** What loading could not open (openConfig), less each place a save has since filled, or dropped with its upstream. */
  let unreadable = loaded.unreadable || [];
  const moved = () => {
    version += 1;
    kept.push({ version, cfg: structuredClone(current) });
    if (kept.length > KEPT_VERSIONS) kept.shift();
    for (const fn of savedListeners) fn(version);
  };
  const set = (next) => {
    current = normalizeConfig(next);
    for (const fn of listeners) fn(current);
    return current;
  };
  return {
    dataDir,
    loaded: { created: !!loaded.created, file: loaded.file, secretProblems: loaded.secretProblems || [] },
    get: () => current,
    set,
    reload: () => {
      const read = loadConfig(dataDir, { agents });
      unreadable = read.unreadable || [];
      set(read.config);
      moved();
      return current;
    },
    save: ({ forget = [] } = {}) => {
      const file = saveConfig(dataDir, current, { forget });
      unreadable = stillUnreadable(current, unreadable).filter((where) => !forget.includes(where));
      moved();
      return file;
    },
    unreadable: () => stillUnreadable(current, unreadable),
    version: () => version,
    at: (v) => kept.find((k) => k.version === v)?.cfg ?? null,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onSaved(fn) {
      savedListeners.add(fn);
      return () => savedListeners.delete(fn);
    },
  };
}
