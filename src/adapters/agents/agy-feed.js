// @ts-check
// Antigravity's own program, from Google's release feed (the owner's of 11-22): Google's agy CLI, which speaks ACP
// itself (`agy acp`). ACP's registry lists Google's older server for it (agy_acp_server) and follows Google's releases
// late (its 1.5.2 while the feed named 1.5.14), and the models an agent offers come with its version: the 1.4.5
// Filament had installed listed none of the models Google released since, and before 1.5.1 it showed its Claude and
// GPT models only to editors on Google's own list. The feed names the newest release for each system: its version,
// its download (one program on Windows, a tarball of one program elsewhere) and that download's SHA-512. Read with the
// registry (Settings → Coding agents' Refresh, and as that section opens on a copy older than an hour), kept in the
// data folder, and laid over the registry's entry for Antigravity (`withAgyFeed`): Filament installs, updates and
// removes it as it does a registry agent's program.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_AGENTS } from "../../core/catalogues.js";
import { fetchText, platformTarget } from "./registry.js";

/** The feed, by the system Google names (`feedTarget`). */
export const AGY_FEED_URL = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests";
/** The registry's id for Antigravity, the catalogue's too: the entry the feed's release is laid over. */
export const AGY_ID = "antigravity-acp";
/** A feed's answer at most: a few lines of JSON. */
const FEED_MAX_BYTES = 16 * 1024;
/** A copy older than this is read again when Settings → Coding agents opens: Google ships a release most weeks. */
export const AGY_FEED_STALE_MS = 3600_000;
/** Where the feed's downloads are: Google's own bucket for the CLI. */
const DOWNLOADS = "https://storage.googleapis.com/antigravity-public/antigravity-cli/";
/**
 * How Filament starts it: as an ACP server, its folder for Filament's sessions named as the server before it named
 * its own (`<folder>/antigravity-acp`, `~/.gemini` where the account has no folder of its own), so a Default account's
 * sessions and settings stay where they were. Its own updater stays off: Filament updates it, and a program that
 * replaced itself would no longer be the one its receipt names.
 */
export const AGY_ARGS = Object.freeze(["acp", "--app-data-dir", "antigravity-acp"]);
/** The catalogue's (`ownEnv`), which a sign-in line to copy sets too. */
export const AGY_ENV = Object.freeze({ ...KNOWN_AGENTS.find((a) => a.id === "antigravity-acp")?.ownEnv });
/** Whose checksum the install checks, in its words. */
const FROM = "Google's release feed";

/**
 * A release as the feed names it, for one system.
 * @typedef {{ version: string, url: string, sha512: string }} AgyRelease
 */

/** This computer as the feed names systems (`windows_amd64`…); null where it names none. @param {string} platform @param {string} arch */
export function feedTarget(platform, arch) {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const cpu = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : null;
  return os && cpu ? `${os}_${cpu}` : null;
}

/**
 * The feed's answer as checked: a version of three numbers, a download in Google's bucket over https, a SHA-512 in hex.
 * Throws, in words, at the first thing wrong.
 * @param {unknown} raw @returns {AgyRelease}
 */
export function checkRelease(raw) {
  const r = /** @type {any} */ (raw);
  const version = typeof r?.version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(r.version) ? r.version : null;
  if (!version) throw new Error("its version isn't one");
  let url = null;
  try {
    const u = new URL(String(r?.url ?? ""));
    if (u.protocol === "https:" && !u.username && !u.password && u.href.startsWith(DOWNLOADS) && u.href.length <= 500) url = u.href;
  } catch {}
  if (!url) throw new Error("its download isn't in Google's bucket for the CLI");
  const sha512 = typeof r?.sha512 === "string" && /^[a-f0-9]{128}$/i.test(r.sha512) ? r.sha512.toLowerCase() : null;
  if (!sha512) throw new Error("its checksum isn't a SHA-512");
  return { version, url, sha512 };
}

/**
 * The program a release installs, as a registry's program for this system is said: the download, the command in it —
 * `agy.exe`, the program itself on Windows; `antigravity`, the one file its tarball holds, elsewhere —, how Filament
 * starts it, and its SHA-512.
 * @param {AgyRelease} release @param {string} platform
 * @returns {import("./registry.js").ProgramWay}
 */
export function agyProgram(release, platform) {
  return { archive: release.url, cmd: platform === "win32" ? "agy.exe" : "antigravity", args: [...AGY_ARGS], env: { ...AGY_ENV }, sha256: null, sha512: release.sha512, from: FROM };
}

/**
 * The feed kept in `dir` (`<data dir>/agents`), for this computer: its last answer, read again on `refresh`.
 * @param {{ dir: string, fetch?: typeof fetch, log?: (level: string, msg: string) => void, now?: () => number,
 *   platform?: string, arch?: string }} o
 */
export function createAgyFeed({ dir, fetch: get = globalThis.fetch, log = () => {}, now = Date.now, platform = process.platform, arch = process.arch }) {
  const file = join(dir, "agy-feed.json");
  const target = feedTarget(platform, arch);
  /** @type {{ at: number, release: AgyRelease } | null} */
  let copy = null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    if (j?.target === target) copy = { at: Number(j.at) || 0, release: checkRelease(j.release) };
  } catch {}
  /** @type {Promise<void> | null} */
  let asking = null;
  /** @type {string | null} */
  let failed = null;

  /** Read the feed again; the copy stays as it was when it can't be read, and why is said until a read works. */
  function refresh() {
    if (!target) return Promise.resolve();
    asking ||= (async () => {
      try {
        const release = checkRelease(JSON.parse(await fetchText(get, `${AGY_FEED_URL}/${target}.json`, FEED_MAX_BYTES)));
        copy = { at: now(), release };
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify({ at: copy.at, target, release }));
        failed = null;
        log("info", `agy feed: Antigravity ${release.version} is Google's newest for ${target}`);
      } catch (/** @type {any} */ e) {
        failed = String(e?.message || e).slice(0, 300);
        log("warn", `agy feed: couldn't be read (${failed})`);
      } finally {
        asking = null;
      }
    })();
    return asking;
  }

  return {
    refresh,
    /** The release as kept (null before a read worked, and on a system the feed names none), whether it's being read, why the last read failed. */
    view: () => ({ at: copy?.at ?? null, release: copy?.release ?? null, asking: !!asking, error: failed }),
    /** Whether the copy is missing or older than an hour; never on a system the feed names none. */
    stale: () => !!target && (!copy || now() - copy.at > AGY_FEED_STALE_MS),
  };
}

/**
 * The registry with Antigravity's entry taken from Google's feed (the owner's of 11-22): its words, makers and icon the
 * registry's, its version the feed's, and its one program this computer's from the feed — never the registry's older
 * server. Before the feed was read, or on a system it names none, the entry has no program and no version, so nothing
 * installs the server the registry lists, and where the feed names this system it says why (`waiting`: not read yet,
 * or why it couldn't be); an entry the registry left out is made from the feed alone. The rest is the registry's, and
 * a failed read of the feed is said beside the registry's own error.
 * Its `refresh` reads both, or with `staleOnly` the ones gone stale: the feed is read each hour, the registry and its
 * forty-odd icons each day.
 * @param {ReturnType<typeof import("./registry.js").createRegistry>} registry
 * @param {ReturnType<typeof createAgyFeed>} feed
 * @param {{ platform?: string, arch?: string }} [o]
 */
export function withAgyFeed(registry, feed, { platform = process.platform, arch = process.arch } = {}) {
  const target = platformTarget(platform, arch);
  /** @param {import("./registry.js").RegistryAgent | null} listed @returns {import("./registry.js").RegistryAgent} */
  const fromFeed = (listed) => {
    const { release, error } = feed.view();
    // Why there's no program yet, on a system the feed names: its card and Install say so, not that none is made for it.
    const waiting = !release && target && feedTarget(platform, arch) ? (error ? `Google's release feed couldn't be read (${error}): Refresh to try again` : "Google's release feed hasn't been read yet: Refresh") : null;
    return {
      id: AGY_ID,
      name: listed?.name || "Google Antigravity",
      // None before the feed is read: the registry's is its older server's, not what Filament installs.
      version: release?.version || "",
      description: listed?.description || "",
      authors: listed?.authors || ["Google"],
      license: listed?.license ?? null,
      licenseUrl: listed?.licenseUrl ?? null,
      website: listed?.website ?? null,
      repository: listed?.repository ?? null,
      icon: listed?.icon ?? null,
      npx: null,
      uvx: null,
      binary: release && target ? { [target]: agyProgram(release, platform) } : null,
      ...(waiting ? { waiting } : {}),
    };
  };
  return {
    /** @param {{ staleOnly?: boolean }} [o] */
    refresh: async ({ staleOnly = false } = {}) => {
      await Promise.all([!staleOnly || registry.stale() ? registry.refresh() : null, !staleOnly || feed.stale() ? feed.refresh() : null]);
    },
    view: () => {
      const v = registry.view();
      const f = feed.view();
      const listed = v.agents.find((a) => a.id === AGY_ID) || null;
      const agents = listed ? v.agents.map((a) => (a.id === AGY_ID ? fromFeed(a) : a)) : [...v.agents, fromFeed(null)];
      // A failed read of the feed is said with the registry's (Settings → Coding agents' registry line), the registry's first.
      return { ...v, agents, asking: v.asking || f.asking, error: v.error || (f.error ? `Google's release feed for Antigravity: ${f.error}` : null) };
    },
    stale: () => registry.stale() || feed.stale(),
    iconOf: registry.iconOf,
  };
}
