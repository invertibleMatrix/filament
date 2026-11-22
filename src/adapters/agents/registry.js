// @ts-check
// ACP's registry of coding agents (HarnessV3-ACP AC3-8, AC-D25): the agents anyone can connect over ACP, each with its
// version, its makers, its licence, its links and how it installs — an npm package run with npx, a Python one with uvx,
// or a program to download for each system. The server reads it from the registry's CDN, never the page: on Settings →
// Coding agents' Refresh, and when that section opens on a copy older than a day. What comes back is checked entry by
// entry (https links only; ids, versions, arguments and environment as plain text) and an entry that fails is left out,
// the log saying why. The copy is kept in the data folder with each agent's icon, checked too: an SVG with no script,
// no event attribute and no outside reference, which Filament serves under a policy that runs nothing.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
/** The index's size at most. */
export const REGISTRY_MAX_BYTES = 1024 * 1024;
/** An icon's size at most. */
export const ICON_MAX_BYTES = 64 * 1024;
/** A copy older than this is read again when Settings → Coding agents opens. */
export const REGISTRY_STALE_MS = 24 * 3600_000;

/**
 * A package an agent runs from, npm's (`npx`) or Python's (`uvx`): its name and the registry's exact version, and the
 * arguments and environment the agent is started with.
 * @typedef {{ name: string, version: string, args: string[], env: Record<string, string> }} PackageWay
 */
/**
 * A program to download for one system: its archive, the command inside it, how it's started, its checksum if said —
 * the registry's sha256; a maker's own feed may give a sha512 instead (agy-feed.js), and names itself (`from`) where the
 * install says whose checksum it checked.
 * @typedef {{ archive: string, cmd: string, args: string[], env: Record<string, string>, sha256: string | null,
 *   sha512?: string | null, from?: string }} ProgramWay
 */
/**
 * An agent of the registry, as checked.
 * @typedef {{ id: string, name: string, version: string, description: string, authors: string[], license: string | null,
 *   licenseUrl: string | null, website: string | null, repository: string | null, icon: string | null,
 *   npx: PackageWay | null, uvx: PackageWay | null, binary: Record<string, ProgramWay> | null }} RegistryAgent
 */

// An id and a version are folders' names here: letters, digits, dots, dashes, never ending with a dot (Windows drops
// it) and never one of Windows' device names.
const ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9_-])?$/i;
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const VERSION = /^[\w+-](?:[\w.+-]{0,62}[\w+-])?$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TARGET = /^(darwin|linux|windows)-(aarch64|x86_64)$/;
const NPM_SPEC = /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@([\w.+-]{1,64})$/i;
// uvx takes `name==version` and `name@version` (a leading v dropped).
const UV_SPEC = /^([A-Za-z0-9][\w.-]*)(?:==|@)v?([\w.+!-]{1,64})$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A plain string of at most `max` characters, its white space folded; else null. @param {unknown} v @param {number} max */
const text = (v, max) => {
  if (typeof v !== "string" || v.includes("\u0000")) return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && t.length <= max ? t : null;
};
/** An https address with no credentials in it; else null. @param {unknown} v */
const httpsUrl = (v) => {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
};
/** Arguments as plain text, at most 16; none when not said; null when wrong. @param {unknown} v @returns {string[] | null} */
const argsOf = (v) =>
  v == null ? [] : Array.isArray(v) && v.length <= 16 && v.every((a) => typeof a === "string" && a.length <= 200 && !CONTROL.test(a)) ? [...v] : null;
/** An environment as plain text, at most 16 names; none when not said; null when wrong. @param {unknown} v */
const envOf = (v) => {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > 16) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, x] of entries) {
    if (!ENV_NAME.test(k) || typeof x !== "string" || x.length > 500 || CONTROL.test(x)) return null;
    out[k] = x;
  }
  return out;
};
/** A package way, or false when it's there and wrong. @param {any} v @param {RegExp} spec @returns {PackageWay | null | false} */
const packageOf = (v, spec) => {
  if (v == null) return null;
  const m = typeof v?.package === "string" ? spec.exec(v.package) : null;
  const args = argsOf(v?.args);
  const env = envOf(v?.env);
  return m && args && env ? { name: m[1], version: m[2], args, env } : false;
};

/**
 * One entry of the registry as checked: the agent, or why it's left out. Its own optional words and links that are
 * wrong are dropped, not the agent, and so is a program for a system Filament runs on none of (`TARGET`).
 * @param {any} a @returns {{ agent: RegistryAgent } | { why: string }}
 */
function checkAgent(a) {
  const id = isAgentId(a?.id) ? a.id : null;
  if (!id) return { why: "its id isn't one" };
  const name = text(a.name, 80);
  if (!name) return { why: "it has no name" };
  const version = typeof a.version === "string" && VERSION.test(a.version) ? a.version : null;
  if (!version) return { why: "its version isn't one" };
  const d = a.distribution && typeof a.distribution === "object" ? a.distribution : {};
  const npx = packageOf(d.npx, NPM_SPEC);
  if (npx === false) return { why: "its npm package isn't one" };
  const uvx = packageOf(d.uvx, UV_SPEC);
  if (uvx === false) return { why: "its Python package isn't one" };
  /** @type {Record<string, ProgramWay> | null} */
  let binary = null;
  if (d.binary != null) {
    if (typeof d.binary !== "object" || Array.isArray(d.binary)) return { why: "its programs aren't said rightly" };
    binary = {};
    for (const [target, b] of Object.entries(d.binary)) {
      // The registry names more systems than Filament runs on (a musl Linux): a program for one of those is passed
      // over unread, and the agent stays with the rest — with none, where all its programs are for such systems,
      // which reads as no build for this computer.
      if (!TARGET.test(target)) continue;
      const archive = httpsUrl(b?.archive);
      const cmd = typeof b?.cmd === "string" && b.cmd.length <= 200 && !CONTROL.test(b.cmd) ? b.cmd : null;
      const args = argsOf(b?.args);
      const env = envOf(b?.env);
      const sha256 = b?.sha256 == null ? null : typeof b.sha256 === "string" && /^[a-f0-9]{64}$/i.test(b.sha256) ? b.sha256.toLowerCase() : false;
      if (!archive || !cmd || !args || !env || sha256 === false) return { why: `its program for ${target} isn't said rightly` };
      binary[target] = { archive, cmd, args, env, sha256 };
    }
    if (!Object.keys(d.binary).length) binary = null;
  }
  if (!npx && !uvx && !binary) return { why: "it says no way to install it" };
  const authors = Array.isArray(a.authors) ? a.authors.map((x) => text(x, 80)).filter((x) => x !== null).slice(0, 5) : [];
  return {
    agent: {
      id,
      name,
      version,
      description: text(a.description, 600) || "",
      authors: /** @type {string[]} */ (authors),
      license: text(a.license, 80),
      licenseUrl: httpsUrl(a.license_url),
      website: httpsUrl(a.website),
      repository: httpsUrl(a.repository),
      icon: httpsUrl(a.icon),
      npx,
      uvx,
      binary,
    },
  };
}

/**
 * The registry as read, checked entry by entry: the agents that pass (and their entries as given, which are what is
 * kept), and why each other one was left out. An id met twice keeps its first entry.
 * @param {unknown} raw
 * @returns {{ agents: RegistryAgent[], kept: unknown[], dropped: { id: string, why: string }[] }}
 */
export function checkRegistry(raw) {
  const list = /** @type {any} */ (raw)?.agents;
  if (!Array.isArray(list)) throw new Error("it lists no agents");
  /** @type {RegistryAgent[]} */
  const agents = [];
  /** @type {unknown[]} */
  const kept = [];
  /** @type {{ id: string, why: string }[]} */
  const dropped = [];
  for (const a of list.slice(0, 500)) {
    const id = typeof a?.id === "string" ? a.id.slice(0, 64) : "";
    const r = checkAgent(a);
    if ("why" in r) dropped.push({ id, why: r.why });
    else if (agents.some((x) => x.id === r.agent.id)) dropped.push({ id, why: "its id is another entry's" });
    else {
      agents.push(r.agent);
      kept.push(a);
    }
  }
  return { agents, kept, dropped };
}

/**
 * Whether an SVG may be served from Filament's own address: one `<svg>`, small, with no script, no event attribute, no
 * embedded document and no reference outside itself.
 * @param {unknown} svg
 */
export function safeSvg(svg) {
  const s = String(svg || "");
  if (!s || s.length > ICON_MAX_BYTES || !/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s)) return false;
  // A reference is the document's own only when it starts with `#`, quoted or not.
  return !/<script|<foreignobject|<iframe|<object|<embed|<!entity|<!doctype|@import|javascript:|\bon[a-z]+\s*=|href\s*=\s*(?:["'](?!\s*#)|(?!["'\s#]))|url\(\s*(?:["'](?!\s*#)|(?!["'\s#]))/i.test(s);
}

/** Whether `id` names an agent of the registry as its checks allow: a folder's name, safe on every system. @param {unknown} id */
export const isAgentId = (id) => typeof id === "string" && ID.test(id) && !DEVICE.test(id);

/** This computer as the registry names systems (`windows-x86_64`…); null where it names none. @param {string} platform @param {string} arch */
export function platformTarget(platform, arch) {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null;
  return os && cpu ? `${os}-${cpu}` : null;
}

/**
 * A text at an https address, at most `max` bytes, read as it comes so a larger one stops early.
 * @param {typeof fetch} get @param {string} url @param {number} max
 */
export async function fetchText(get, url, max) {
  const res = await get(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) throw new Error(`it answered ${res.status}`);
  if (res.url && new URL(res.url).protocol !== "https:") throw new Error("it was sent on somewhere that isn't https");
  if (Number(res.headers?.get?.("content-length") || 0) > max) throw new Error(`it is larger than ${max} bytes`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("it sent nothing");
  /** @type {Buffer[]} */
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`it is larger than ${max} bytes`);
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts).toString("utf8");
}

/**
 * The registry kept in `dir` (`<data dir>/agents`): its copy, and each agent's icon; read again on `refresh`.
 * @param {{ dir: string, fetch?: typeof fetch, log?: (level: string, msg: string) => void, now?: () => number }} o
 */
export function createRegistry({ dir, fetch: get = globalThis.fetch, log = () => {}, now = Date.now }) {
  const file = join(dir, "registry.json");
  const icons = join(dir, "icons");
  /** @type {{ at: number, agents: RegistryAgent[] } | null} */
  let copy = null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    copy = { at: Number(j.at) || 0, agents: checkRegistry(j).agents };
  } catch {}
  /** @type {Promise<void> | null} */
  let asking = null;
  /** @type {{ at: number, error: string } | null} */
  let failed = null;

  /**
   * Each agent's icon, fetched from the registry's own address, checked, and kept as `<id>.svg`; an agent no longer
   * listed loses its icon. One that can't be had is left out: the page shows the agent's initial.
   * @param {RegistryAgent[]} agents
   */
  async function keepIcons(agents) {
    mkdirSync(icons, { recursive: true });
    const host = new URL(REGISTRY_URL).host;
    const queue = agents.filter((a) => a.icon && new URL(a.icon).host === host);
    const fetchOne = async (/** @type {RegistryAgent} */ a) => {
      try {
        const svg = await fetchText(get, String(a.icon), ICON_MAX_BYTES);
        if (!safeSvg(svg)) throw new Error("it isn't an SVG Filament serves");
        writeFileSync(join(icons, `${a.id}.svg`), svg);
      } catch (/** @type {any} */ e) {
        log("debug", `registry: ${a.id}'s icon left out (${String(e?.message || e).slice(0, 120)})`);
      }
    };
    // Six at a time: the registry's CDN is asked for forty-odd small files.
    const runners = Array.from({ length: 6 }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) await fetchOne(a);
    });
    await Promise.all(runners);
    const listed = new Set(agents.map((a) => `${a.id}.svg`));
    for (const f of readdirSync(icons)) if (!listed.has(f)) rmSync(join(icons, f), { force: true });
  }

  /** Read the registry again; the copy stays as it was when it can't be read, and why is said until a read works. */
  function refresh() {
    asking ||= (async () => {
      try {
        const { agents, kept, dropped } = checkRegistry(JSON.parse(await fetchText(get, REGISTRY_URL, REGISTRY_MAX_BYTES)));
        for (const d of dropped) log("warn", `registry: ${d.id || "an entry"} left out: ${d.why}`);
        mkdirSync(dir, { recursive: true });
        await keepIcons(agents);
        copy = { at: now(), agents };
        writeFileSync(file, JSON.stringify({ at: copy.at, url: REGISTRY_URL, agents: kept }));
        failed = null;
        log("info", `registry: ${agents.length} agents read${dropped.length ? `, ${dropped.length} left out` : ""}`);
      } catch (/** @type {any} */ e) {
        failed = { at: now(), error: String(e?.message || e).slice(0, 300) };
        log("warn", `registry: couldn't be read (${failed.error})`);
      } finally {
        asking = null;
      }
    })();
    return asking;
  }

  return {
    refresh,
    /** The copy as kept: when it was read, its agents, whether it's being read, and why the last read failed. */
    view: () => ({ at: copy?.at ?? null, agents: copy?.agents || [], asking: !!asking, error: failed?.error ?? null }),
    /** Whether the copy is missing or older than a day. */
    stale: () => !copy || now() - copy.at > REGISTRY_STALE_MS,
    /** An agent's kept icon, as a file; null without one. @param {string} id */
    iconOf: (id) => {
      const f = join(icons, `${id}.svg`);
      return isAgentId(id) && existsSync(f) ? f : null;
    },
  };
}
