// @ts-check
// The request's own environment (HarnessV3-Memory M3-4, MD-5): what the request in hand shows about where it runs —
// its working folder, its platform, whether it offers file tools, and the package manager its folder's lockfiles name.
// A claim whose value (M3-2) this contradicts is contested: held back from the autopilot while the contradiction holds,
// and labelled where search shows it. Nothing is recorded about the environment itself (M3-D3): the request already
// carries the truth, and another checkout or another machine can make the claim true again (M3-D4).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ECOSYSTEM, LOCKFILES } from "../../core/package-managers.js";
import { kindOfName } from "../../core/tool-vocab.js";
import { rivals } from "./values.js";

/** The tool kinds that read or write files. */
const FILE_KINDS = new Set(["read", "write", "edit", "edit-many"]);
const PLATFORM_LINE = /^\s*Platform:\s*(win32|darwin|linux)\b/im;

/**
 * @typedef {object} RequestEnv
 * @property {string | null} project  the request's project id: it speaks for that project's claims, and global ones (M3-D26)
 * @property {string | null} cwd  the working folder
 * @property {string | null} platform  win32, darwin or linux; null when the request does not say
 * @property {boolean | null} fileTools  whether the request offers a tool that reads or writes files; null when it offers no tools
 * @property {Map<string, { manager: string, source: string }>} managers  per ecosystem, the one manager the folder names, and what names it
 */

/** The tool names a request declares, in any wire format. @param {any} body @param {any} [responsesBody] @returns {string[]} */
export function toolNamesOf(body, responsesBody = null) {
  const tools = responsesBody?.tools || body?.tools || [];
  return Array.isArray(tools) ? tools.map((t) => t?.name || t?.function?.name).filter((n) => typeof n === "string" && n) : [];
}

/** @type {Map<string, { mtime: number, managers: RequestEnv["managers"] }>} */
const folders = new Map();
/**
 * The package manager a folder names, per ecosystem: package.json's `packageManager`, else the one manager its
 * lockfiles name — two lockfiles of one ecosystem name none. Kept per folder until the folder's entries change.
 * @param {string} cwd @returns {RequestEnv["managers"]}
 */
export function managersOf(cwd) {
  let mtime;
  try {
    mtime = statSync(cwd).mtimeMs;
  } catch {
    return new Map();
  }
  const kept = folders.get(cwd);
  if (kept && kept.mtime === mtime) return kept.managers;
  /** @type {RequestEnv["managers"]} */
  const managers = new Map();
  let names;
  try {
    names = new Set(readdirSync(cwd));
  } catch {
    names = new Set();
  }
  /** @type {Map<string, Set<string>>} */
  const byEco = new Map();
  /** @type {Map<string, string>} */
  const lockOf = new Map();
  for (const [file, manager] of LOCKFILES)
    if (names.has(file)) {
      const eco = ECOSYSTEM[/** @type {keyof typeof ECOSYSTEM} */ (manager)];
      byEco.set(eco, new Set([...(byEco.get(eco) || []), manager]));
      if (!lockOf.has(manager)) lockOf.set(manager, file);
    }
  for (const [eco, set] of byEco) if (set.size === 1) for (const m of set) managers.set(eco, { manager: m, source: /** @type {string} */ (lockOf.get(m)) });
  if (names.has("package.json"))
    try {
      const declared = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))?.packageManager;
      const m = typeof declared === "string" ? declared.split("@")[0].trim().toLowerCase() : "";
      if (ECOSYSTEM[/** @type {keyof typeof ECOSYSTEM} */ (m)] === "node") managers.set("node", { manager: m, source: "package.json's packageManager" });
    } catch {
      /* an unreadable package.json names nothing */
    }
  folders.set(cwd, { mtime, managers });
  if (folders.size > 64) folders.delete(/** @type {string} */ (folders.keys().next().value));
  return managers;
}

/**
 * The environment a request shows. `environment` is the harness's frozen Environment (the chain's `meta.environment`),
 * read for the platform when the system prompt does not state one.
 * @param {{ project?: string | null, cwd?: string | null, systemText?: string, tools?: string[] | null, environment?: any }} o
 * @returns {RequestEnv}
 */
export function requestEnv({ project = null, cwd = null, systemText = "", tools = null, environment = null }) {
  const platform = PLATFORM_LINE.exec(String(systemText || ""))?.[1]?.toLowerCase() || environment?.path?.platform || null;
  return {
    project: project || null,
    cwd: cwd || null,
    platform: ["win32", "darwin", "linux"].includes(platform) ? platform : null,
    fileTools: tools && tools.length ? tools.some((n) => FILE_KINDS.has(kindOfName(n) ?? "")) : null,
    managers: cwd ? managersOf(cwd) : new Map(),
  };
}

/**
 * The first of a claim's values the environment contradicts, in the environment's words, or null. Only a value that
 * is this project's (M3-D11) is compared. A folder is contradicted when it is neither the working folder nor inside or
 * around it; a package manager when the folder names exactly one other of its ecosystem.
 * @param {Map<string, { value: string, project: boolean }>} values  `valuesOf(claim)` @param {RequestEnv} env
 * @returns {{ cls: string, value: string, says: string } | null}
 */
export function environmentSays(values, env) {
  for (const [cls, { value, project }] of values) {
    if (!project) continue;
    if (cls === "working folder" && env.cwd && rivals(cls, value, env.cwd)) return { cls, value, says: `the working folder is ${env.cwd}` };
    if (cls === "package manager") {
      const named = env.managers.get(ECOSYSTEM[/** @type {keyof typeof ECOSYSTEM} */ (value)]);
      if (named && named.manager !== value) return { cls, value, says: `${named.manager} (${named.source})` };
    }
    if (cls === "file tools" && value === "none" && env.fileTools) return { cls, value, says: "file tools are offered" };
    if (cls === "platform" && env.platform && env.platform !== value) return { cls, value, says: `the platform is ${env.platform}` };
  }
  return null;
}
