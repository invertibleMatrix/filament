// @ts-check
// The models an Anthropic API key can use, for a Claude Code account that runs on one: Claude Code lists the models it
// picks itself, and the key may reach more (the owner's of 11-11: claude-fable-5-2 on a Console sign-in's key).
// `keyAccess` finds the key where Claude Code itself reads it, by what its adapter says the account runs on (its
// identity's `detail`, claude-agent-acp 0.93): the variable ANTHROPIC_API_KEY — the person's own Claude Code settings'
// `env`, else its process's —, or a Console sign-in's key, which says no source and is kept in the account's folder
// (`primaryApiKey` of its .claude.json, as claude.exe of claude-agent-sdk 0.3.300 reads it; a Mac keeps it in the
// Keychain, which is not read). A key a command makes (apiKeyHelper), a token, or any other source is not read. With
// it, the address Claude Code calls: ANTHROPIC_BASE_URL, found the same way, else Anthropic's — never a project's
// settings, whose file a folder brings with it: no folder says where a key goes. `keyModels` asks Anthropic's Models
// API there what the key may use (GET /v1/models, every page) within a few seconds. The key goes in that request's
// header and nowhere else: nothing here logs, keeps or returns it, a redirect is not followed, and a failure is said
// by its status and the API's own type for it, never by its body, after the host it went to where that is not
// Anthropic's (`keyListWords`).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentLaunchEnv } from "../../../core/catalogues.js";
import { headChars } from "../../../core/text.js";
import { agentEnv } from "../agent-process.js";
import { listingRead } from "../../providers/http.js";
import { claudeSettingsVar } from "./toolset.js";

/** Anthropic's own address, where no ANTHROPIC_BASE_URL names another. */
const ANTHROPIC_API = "https://api.anthropic.com";
/** How long the whole ask may take, its pages together. */
export const KEY_MODELS_MS = 5000;
const KEY_VAR = "ANTHROPIC_API_KEY";
const BASE_VAR = "ANTHROPIC_BASE_URL";
/** The adapter's words for a key that a command of Claude Code's settings makes: its own, and the setting's name. */
const HELPER_SAID = ["API key helper", "apiKeyHelper"];
/** A page's size, the most the API gives, and the most pages read: a listing that never ends is read no further. */
const PAGE = 1000;
const PAGES_MOST = 20;

/**
 * Where an account's key is, and the address it is sent to; or why Filament does not read it, in words that follow a
 * colon. Never for an account that is not on a key (`identity.kind`), which answers null: nothing is asked.
 * @param {any} upstream  a Claude Code upstream @param {{ kind?: string, detail?: string | null } | null | undefined} identity
 * @param {{ env?: Record<string, string | undefined>, read?: (file: string) => string, platform?: string }} [o]
 *   `env`: the environment its process starts with
 * @returns {{ key: string, base: string } | { why: string } | null}
 */
export function keyAccess(upstream, identity, { env = agentEnv(agentLaunchEnv(upstream), upstream?.acp?.envRemove).env, read = (file) => readFileSync(file, "utf8"), platform = process.platform } = {}) {
  if (identity?.kind !== "api-key") return null;
  /** A variable of the process's environment, named in any case on Windows. @param {string} name */
  const started = (name) => {
    const fold = (/** @type {string} */ k) => (platform === "win32" ? k.toUpperCase() : k);
    return Object.entries(env).find(([k]) => fold(k) === fold(name))?.[1];
  };
  /** A variable as Claude Code's process has it: the person's own settings' over its environment's. @param {string} name */
  const given = (name) => {
    const own = claudeSettingsVar(name, { env, read }) ?? started(name);
    return typeof own === "string" && own.trim() ? own.trim() : null;
  };
  const detail = identity.detail ? String(identity.detail) : null;
  /** @type {string | null} */
  let key = null;
  if (detail === KEY_VAR) {
    key = given(KEY_VAR);
    if (!key) return { why: `${KEY_VAR} is not in the environment Filament starts Claude Code with` };
  } else if (!detail) {
    const mac = platform === "darwin" ? " (a Mac keeps it in the Keychain)" : "";
    /** @type {string | null} */
    let text = null;
    try {
      text = read(join(started("CLAUDE_CONFIG_DIR") || homedir(), ".claude.json"));
    } catch {}
    if (typeof text !== "string") return { why: `the key is not in the account's folder for Filament to read${mac}` };
    /** @type {any} */
    let kept = null;
    try {
      kept = JSON.parse(text);
    } catch {}
    // As Claude Code writes it: one object, its key a string under `primaryApiKey`; anything else is read no further.
    if (!kept || typeof kept !== "object" || Array.isArray(kept)) return { why: "the account's .claude.json is not as Claude Code writes it, so no key is read from it" };
    if (typeof kept.primaryApiKey === "string" && kept.primaryApiKey.trim()) key = String(kept.primaryApiKey).trim();
    else return { why: `the account's .claude.json holds no key where Claude Code keeps one${mac}` };
  } else return { why: HELPER_SAID.includes(detail) ? "a command makes the key (apiKeyHelper), and Filament does not run it" : `the key comes from ${headChars(detail, 40)}, which Filament does not read` };
  const base = (given(BASE_VAR) || ANTHROPIC_API).replace(/\/+$/, "");
  try {
    const at = new URL(base);
    if ((at.protocol !== "https:" && at.protocol !== "http:") || at.username || at.password) throw new Error("not an address to ask");
  } catch {
    return { why: `its ${BASE_VAR} is no http address` };
  }
  return { key, base };
}

/**
 * Whose list of the models an account's key can use was asked for, in words its failure follows: Anthropic's at
 * Anthropic's own address; elsewhere — a gateway the account's ANTHROPIC_BASE_URL names — the host asked, never the
 * address's path, query or credentials.
 * @param {string} base
 */
export function keyListWords(base) {
  let host = "";
  try {
    host = new URL(base).host;
  } catch {}
  if (host === new URL(ANTHROPIC_API).host) return "Anthropic's list of the models this account's API key can use";
  return `The list of the models this account's API key can use${host ? `, asked of ${host},` : ""}`;
}

/**
 * The models a key may use, as Anthropic's Models API lists them at `base`: each id with the API's name for it, in the
 * API's order, every page (`has_more`, `last_id`); or how the ask failed, in words that follow "its list".
 * @param {{ key: string, base: string }} access
 * @param {{ deadlineMs?: number, fetchImpl?: typeof fetch }} [o]
 * @returns {Promise<{ models: { id: string, name: string }[] } | { failed: string }>}
 */
export async function keyModels({ key, base }, { deadlineMs = KEY_MODELS_MS, fetchImpl = fetch } = {}) {
  const stop = AbortSignal.timeout(deadlineMs);
  /** @type {{ id: string, name: string }[]} */
  const models = [];
  /** @type {string | null} */
  let after = null;
  try {
    for (let page = 0; page < PAGES_MOST; page++) {
      const t0 = performance.now();
      const r = await fetchImpl(`${base}/v1/models?limit=${PAGE}${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "user-agent": "filament/0.1" },
        // A redirect would carry the key to another address: its answer is read as it is.
        redirect: "manual",
        signal: stop,
      });
      if (r.status >= 300 && r.status < 400) {
        void r.body?.cancel().catch(() => {});
        return { failed: "answered with a redirect, which Filament does not follow" };
      }
      const got = await listingRead(r, t0);
      if (!got.ok) {
        // The API's type for the refusal ("authentication_error"), where it is one of its plain words: never its message.
        const type = typeof got.json?.error?.type === "string" && /^[a-z_]{1,40}$/.test(got.json.error.type) ? ` ${got.json.error.type}` : "";
        return { failed: `was refused (${got.status}${type})` };
      }
      if (!Array.isArray(got.json?.data)) return { failed: "could not be read" };
      for (const m of got.json.data) {
        const id = typeof m?.id === "string" ? m.id.trim() : "";
        if (id && !models.some((x) => x.id === id)) models.push({ id, name: typeof m.display_name === "string" ? m.display_name.trim() : "" });
      }
      after = got.json.has_more === true && typeof got.json.last_id === "string" && got.json.last_id ? got.json.last_id : null;
      if (!after) return { models };
    }
    return { models };
  } catch (/** @type {any} */ e) {
    if (stop.aborted) return { failed: `gave no answer in ${Math.round(deadlineMs / 100) / 10} s` };
    // A listing too long to read says so in its own words (`listingRead`); any other failure never reached an answer.
    return { failed: /model list is more than/.test(String(e?.message)) ? "is too long to read" : "could not be reached" };
  }
}
