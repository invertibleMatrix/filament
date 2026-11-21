// @ts-check
// Where plugins come from (HarnessV4_SpacesPlugins_Plan B1): Claude Code's marketplaces and the plugins it installed or
// Claude Desktop synced down; Anthropic's directory, read from Claude Code's own copy where it is there (PL-D2); Codex's
// marketplaces (its config.toml's, `~/.agents/plugins/marketplace.json`) and the plugins it keeps; and the marketplaces
// a person adds by a GitHub repository, a git address, a marketplace.json's address or a folder. What Claude Code and
// Codex keep is read where it stands, only when the Plugins page asks, and never written; a marketplace added is
// cloned into Filament's own data folder (`plugins/marketplaces/<id>`) and brought up to date on Refresh. Nothing here
// installs or runs a plugin: an install copies one at a fixed commit (B2).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readToml } from "../core/toml.js";
import { hostProblem, judgedLookup } from "../adapters/tools/web-hands.js";
import {
  PLUGIN_LIMITS, directoryOf, foundWords, manifestOf, marketplaceInput, marketplaceOf, pluginName, searchPlugins, sourceKey, sourceWords, textOf,
} from "../core/plugins.js";
import { git as runGit } from "../adapters/git/snapshot.js";
import { removeTree } from "./plugins.js";

/**
 * A marketplace as the page lists it: its id here — `claude/<name>`, `codex/<name>`, `added/<id>` —, where it was found,
 * its name and words, the folder its list is read from, where it came from in words, when it was last brought up to
 * date, how many plugins it lists, and why it could not be read ("" where it was).
 * @typedef {{ id: string, from: "claude" | "codex" | "added", name: string, title: string, description: string,
 *   owner: string, root: string, origin: string, updated: string, count: number, error: string }} MarketView
 */

/**
 * A plugin Claude Code installed, Claude Desktop synced down, or Codex keeps: its name and the name it shows, its words
 * and version, its marketplace, its folder, whether Codex has it on (null where the app says nothing), and why its
 * manifest could not be read.
 * @typedef {{ name: string, title: string, description: string, version: string, marketplace: string, path: string,
 *   from: "claude" | "claude-desktop" | "codex", enabled: boolean | null, error: string }} InstalledView
 */

/**
 * A plugin a marketplace lists, as the page shows it: the marketplace's entry, where its files come from in words, and
 * the apps on this computer that have it installed.
 * @typedef {import("../core/plugins.js").MarketEntry & { where: string, installedIn: string[] }} EntryView
 */

/** A marketplace added, as Filament keeps it. @typedef {{ id: string, source: import("../core/plugins.js").PluginSource, at: number, updated: number, name: string }} AddedRecord */

/** How long a clone, a fetch or a marketplace.json read may take. */
const CLONE_MS = 120_000;
const FETCH_MS = 20_000;
/** The most a marketplace.json read from an address may weigh. */
const LIST_BYTES = 5 * 1024 * 1024;
/** How many times a marketplace.json's address may send the read on. */
const REDIRECTS = 5;
/** Where a marketplace's list stands in its folder: Claude's, Codex's, a bare one (an address's, saved). */
const LIST_FILES = Object.freeze([[".claude-plugin", "marketplace.json"], [".agents", "plugins", "marketplace.json"], ["marketplace.json"]]);

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);
/** A refusal in words, with its HTTP status. @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A JSON file's value, or why it could not be read: "" where it is not there.
 * @param {string} path @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
function readJson(path) {
  if (!existsSync(path)) return { ok: false, error: "" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) };
  } catch (e) {
    return { ok: false, error: `${path} could not be read: ${said(e).slice(0, 160)}` };
  }
}

/** The folders in a folder; none where it is not there. @param {string} dir */
const foldersIn = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  } catch {
    return [];
  }
};

/** A Windows path's `\\?\` prefix (Codex writes one) dropped. @param {string} p */
const plainPath = (p) => p.replace(/^\\\\\?\\/, "");

/** A plugin's name as people say it, where its manifest gives no other: "code-review" → "Code review". @param {string} title @param {string} name */
const shownName = (title, name) => (title && title !== name ? title : name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase()));

/**
 * A plugin's name as its own words write it, where they do: "github" in "Official GitHub MCP server" → "GitHub",
 * "laravel-boost" in "… Laravel Boost …" → "Laravel Boost"; "" where they do not.
 * @param {string} words @param {string} name
 */
export function namedIn(words, name) {
  const parts = name.split(/[-_]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!parts.length) return "";
  const m = new RegExp(`(?<![\\w-])(${parts.join("[ -]?")})(?![\\w-])`, "i").exec(String(words || ""));
  // Its casing only: words that write it all in lower case say no more than its name.
  return m && m[1] !== m[1].toLowerCase() ? m[1] : "";
}

/** Where a marketplace came from, as Claude Code's known_marketplaces.json says it. @param {unknown} s */
function originWords(s) {
  if (!isObject(s)) return "";
  if (s.source === "github" && typeof s.repo === "string") return `github.com/${s.repo}`;
  if (typeof s.url === "string") return s.url.replace(/^https?:\/\//, "");
  if (typeof s.path === "string") return s.path;
  return "";
}

/**
 * Reads where plugins come from on this computer, and keeps the marketplaces a person adds.
 * @param {{ dataDir: string, home?: string, codexHome?: string,
 *   git?: (args: string[], o: { cwd: string, env?: Record<string, string>, timeoutMs?: number }) => Promise<{ code: number, out: string, err: string, error: string | null }>,
 *   fetchText?: (url: string) => Promise<string>, now?: () => number, log?: (level: string, msg: string) => void }} o
 */
export function createPluginSources({ dataDir, home = homedir(), codexHome = "", git = runGit, fetchText = fetchList, now = Date.now, log = () => {} }) {
  const claudeDir = join(home, ".claude", "plugins");
  const codexDir = codexHome || join(home, ".codex");
  const ownDir = join(dataDir, "plugins");
  const addedDir = join(ownDir, "marketplaces");
  const addedFile = join(ownDir, "marketplaces.json");
  /** Lists read, by the file's path and its moment: a page's reads parse each once. @type {Map<string, { at: number, got: ReturnType<typeof marketplaceOf> }>} */
  const lists = new Map();
  /** Anthropic's directory as last read, by its file's moment. @type {{ at: number, got: ReturnType<typeof directoryOf> } | null} */
  let directoryRead = null;
  /** The marketplaces being added or refreshed now, by their source's key or id: a second press waits for none. */
  const busy = new Set();

  /** A list file's marketplace, read again only where the file moved. @param {string} file */
  function listAt(file) {
    let at = 0;
    try {
      at = statSync(file).mtimeMs;
    } catch {
      return null;
    }
    const had = lists.get(file);
    if (had && had.at === at) return had.got;
    const raw = readJson(file);
    const got = raw.ok ? marketplaceOf(raw.value) : { ok: /** @type {const} */ (false), error: raw.error || "not there" };
    lists.set(file, { at, got });
    return got;
  }

  /** The list file a marketplace's folder holds, the first of LIST_FILES; null for none. @param {string} root */
  const listFileOf = (root) => LIST_FILES.map((p) => join(root, ...p)).find((f) => existsSync(f)) || null;

  /**
   * A marketplace's view and its plugins: its list read from its folder, each plugin's relative folder made a folder of
   * this computer — one that leaves the marketplace's folder, or of a list read from an address alone, is said not to be
   * fetched.
   * @param {{ id: string, from: MarketView["from"], root: string, origin: string, updated: string, name?: string, bare?: boolean }} m
   * @returns {{ view: MarketView, plugins: import("../core/plugins.js").MarketEntry[] }}
   */
  function marketAt(m) {
    const base = { id: m.id, from: m.from, name: m.name || "", title: m.name || "", description: "", owner: "", root: m.root, origin: m.origin, updated: m.updated, count: 0, error: "" };
    const file = listFileOf(m.root);
    if (!file) return { view: { ...base, error: existsSync(m.root) ? "it holds no marketplace.json" : `its folder ${m.root} is not there` }, plugins: [] };
    const got = listAt(file);
    if (!got || !got.ok) return { view: { ...base, error: got ? got.error : "its marketplace.json could not be read" }, plugins: [] };
    const market = got.market;
    const plugins = market.plugins.map((p) => {
      if (p.source.kind !== "path") return p;
      if (m.bare) return { ...p, source: /** @type {import("../core/plugins.js").PluginSource} */ ({ kind: "unknown", said: "a folder of a marketplace Filament has only the list of" }) };
      const at = resolve(m.root, p.source.path);
      const inside = relative(resolve(m.root), at);
      return inside.startsWith("..") || isAbsolute(inside) ? { ...p, source: /** @type {import("../core/plugins.js").PluginSource} */ ({ kind: "unknown", said: "a folder outside its marketplace" }) } : { ...p, source: { kind: /** @type {const} */ ("path"), path: at } };
    });
    return { view: { ...base, name: market.name, title: market.title, description: market.description, owner: market.owner, count: plugins.length }, plugins };
  }

  // ---- Claude Code -------------------------------------------------------------------------------------------------

  /** Claude Code's marketplaces, as its known_marketplaces.json names them. */
  function claudeMarkets() {
    const known = readJson(join(claudeDir, "known_marketplaces.json"));
    if (!known.ok) return { markets: [], error: known.error };
    if (!isObject(known.value)) return { markets: [], error: "Claude Code's list of marketplaces is no JSON object" };
    const markets = Object.entries(known.value)
      .filter(([name, k]) => pluginName(name) && isObject(k))
      .map(([name, k]) => marketAt({
        id: `claude/${name}`,
        from: "claude",
        name,
        root: typeof k.installLocation === "string" && k.installLocation ? k.installLocation : join(claudeDir, "marketplaces", name),
        origin: originWords(k.source),
        updated: textOf(k.lastUpdated, 40),
      }));
    return { markets, error: "" };
  }

  /** A plugin folder's manifest, Claude's or Codex's. @param {string} dir @param {".claude-plugin" | ".codex-plugin"} kind */
  function manifestAt(dir, kind) {
    const raw = readJson(join(dir, kind, "plugin.json"));
    if (!raw.ok) return { ok: /** @type {const} */ (false), error: raw.error || `it has no ${kind}/plugin.json` };
    return manifestOf(raw.value);
  }

  /** The plugins Claude Code installed (installed_plugins.json, its version 1 and 2) and those Claude Desktop synced down. @returns {{ installed: InstalledView[], error: string }} */
  function claudeInstalled() {
    /** @type {InstalledView[]} */
    const installed = [];
    const file = readJson(join(claudeDir, "installed_plugins.json"));
    const map = file.ok && isObject(file.value) && isObject(file.value.plugins) ? file.value.plugins : {};
    for (const [key, rec] of Object.entries(map)) {
      const [name, marketplace = ""] = key.split("@");
      const first = Array.isArray(rec) ? rec[0] : rec;
      if (!pluginName(name) || !isObject(first)) continue;
      const path = typeof first.installPath === "string" ? first.installPath : "";
      const m = path ? manifestAt(path, ".claude-plugin") : null;
      installed.push({
        name,
        title: shownName(m?.ok ? m.manifest.title : "", name),
        description: m?.ok ? m.manifest.description : "",
        version: textOf(first.version, 64) || (m?.ok ? m.manifest.version : ""),
        marketplace,
        path,
        from: "claude",
        enabled: null,
        error: m && !m.ok ? m.error : "",
      });
    }
    // Claude Desktop's: a folder per account, its manifest.json naming each plugin's folder there.
    const synced = join(claudeDir, "synced");
    const dir = directoryNow();
    const listings = new Map((dir?.ok ? dir.listings : []).map((l) => [l.id, l]));
    for (const account of foldersIn(synced)) {
      const man = readJson(join(synced, account, "manifest.json"));
      const list = man.ok && isObject(man.value) && Array.isArray(man.value.plugins) ? man.value.plugins : [];
      for (const p of list) {
        if (!isObject(p) || typeof p.name !== "string" || !/^[A-Za-z0-9._-]+$/.test(p.name)) continue;
        const path = join(synced, account, p.name);
        const m = manifestAt(path, ".claude-plugin");
        const listed = typeof p.pluginId === "string" ? listings.get(p.pluginId) : undefined;
        const name = m.ok ? m.manifest.name : listed?.name || p.name;
        installed.push({
          name,
          title: listed?.title || shownName(m.ok ? m.manifest.title : "", name),
          description: (m.ok ? m.manifest.description : "") || textOf(p.description),
          version: m.ok ? m.manifest.version : textOf(p.version, 64),
          marketplace: textOf(p.marketplaceName, 80),
          path,
          from: "claude-desktop",
          enabled: null,
          error: m.ok ? "" : m.error,
        });
      }
    }
    return { installed, error: file.ok || !file.error ? "" : file.error };
  }

  // ---- Anthropic's directory -----------------------------------------------------------------------------------------

  /** Claude Code's copy of the directory, read again only where the file moved; null where it is not there. */
  function directoryNow() {
    const file = join(claudeDir, "plugin-directory-cache-v2.json");
    let at = 0;
    try {
      at = statSync(file).mtimeMs;
    } catch {
      return null;
    }
    if (directoryRead && directoryRead.at === at) return directoryRead.got;
    const raw = readJson(file);
    const got = raw.ok ? directoryOf(raw.value) : { ok: /** @type {const} */ (false), error: raw.error };
    directoryRead = { at, got };
    return got;
  }

  // ---- Codex ---------------------------------------------------------------------------------------------------------

  /** Codex's config.toml, or why it could not be read. */
  function codexConfig() {
    const file = join(codexDir, "config.toml");
    if (!existsSync(file)) return { doc: /** @type {Record<string, any>} */ ({}), error: "" };
    try {
      return { doc: readToml(readFileSync(file, "utf8")), error: "" };
    } catch (e) {
      return { doc: {}, error: `Codex's config.toml could not be read: ${said(e).slice(0, 160)}` };
    }
  }

  /** Codex's marketplaces: its config's, then `~/.agents/plugins/marketplace.json` (the folder above `.agents` its root). @param {Record<string, any>} doc */
  function codexMarkets(doc) {
    const out = [];
    const table = isObject(doc.marketplaces) ? doc.marketplaces : {};
    for (const [name, m] of Object.entries(table)) {
      if (!pluginName(name) || !isObject(m)) continue;
      const src = typeof m.source === "string" ? plainPath(m.source) : "";
      const local = !m.source_type || m.source_type === "local";
      out.push(local && src
        ? marketAt({ id: `codex/${name}`, from: "codex", name, root: src, origin: src, updated: "" })
        : { view: { id: `codex/${name}`, from: /** @type {const} */ ("codex"), name, title: name, description: "", owner: "", root: "", origin: textOf(src, 400), updated: "", count: 0, error: "Codex keeps this marketplace where Filament does not read it: add it here by its address" }, plugins: [] });
    }
    const personal = join(home, ".agents", "plugins", "marketplace.json");
    if (existsSync(personal)) {
      const got = marketAt({ id: "codex/personal", from: "codex", root: home, origin: personal, updated: "" });
      out.push({ ...got, view: { ...got.view, id: got.view.name ? `codex/${got.view.name}` : "codex/personal" } });
    }
    return out;
  }

  /** The plugins Codex keeps (`plugins/cache/<marketplace>/<name>/<version>`, the newest version), on where its config says so. @param {Record<string, any>} doc @returns {InstalledView[]} */
  function codexInstalled(doc) {
    const cache = join(codexDir, "plugins", "cache");
    const on = isObject(doc.plugins) ? doc.plugins : {};
    /** @type {InstalledView[]} */
    const out = [];
    for (const marketplace of foldersIn(cache))
      for (const name of foldersIn(join(cache, marketplace))) {
        if (!pluginName(name)) continue;
        const versions = foldersIn(join(cache, marketplace, name))
          .map((v) => ({ v, at: (() => { try { return statSync(join(cache, marketplace, name, v)).mtimeMs; } catch { return 0; } })() }))
          .sort((a, b) => b.at - a.at);
        if (!versions.length) continue;
        const path = join(cache, marketplace, name, versions[0].v);
        const m = manifestAt(path, ".codex-plugin");
        const cfg = on[`${name}@${marketplace}`];
        out.push({
          name,
          title: shownName(m.ok ? m.manifest.title : "", name),
          description: m.ok ? m.manifest.description : "",
          version: m.ok && m.manifest.version ? m.manifest.version : versions[0].v,
          marketplace,
          path,
          from: "codex",
          enabled: isObject(cfg) && typeof cfg.enabled === "boolean" ? cfg.enabled : null,
          error: m.ok ? "" : m.error,
        });
      }
    return out;
  }

  // ---- Marketplaces you add --------------------------------------------------------------------------------------------

  /** The marketplaces added, as kept. @returns {AddedRecord[]} */
  function addedAll() {
    const raw = readJson(addedFile);
    const list = raw.ok && isObject(raw.value) && Array.isArray(raw.value.marketplaces) ? raw.value.marketplaces : [];
    return list.filter((r) => isObject(r) && typeof r.id === "string" && /^[a-f0-9]{10}$/.test(r.id) && isObject(r.source));
  }
  /** @param {AddedRecord[]} list */
  function addedWrite(list) {
    mkdirSync(ownDir, { recursive: true });
    const tmp = `${addedFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, marketplaces: list }, null, 2));
    renameSync(tmp, addedFile);
  }
  /** Where an added marketplace's list is read: its clone, or its folder where it was given one. @param {AddedRecord} r */
  const addedRoot = (r) => (r.source.kind === "path" ? r.source.path : join(addedDir, r.id));
  /** @param {AddedRecord} r */
  const addedMarket = (r) =>
    marketAt({ id: `added/${r.id}`, from: "added", root: addedRoot(r), origin: sourceWords(r.source), updated: r.updated ? new Date(r.updated).toISOString() : "", name: r.name, bare: r.source.kind === "url" });

  /** git's address for a source Filament clones. @param {import("../core/plugins.js").PluginSource} s */
  const cloneUrl = (s) => (s.kind === "github" ? `https://github.com/${s.repo}.git` : s.kind === "git" ? s.url : "");

  /**
   * A marketplace's copy made or brought up to date in `dir`: cloned (depth 1), fetched and reset, or its list fetched
   * from its address. Throws, in git's or the address's words.
   * @param {import("../core/plugins.js").PluginSource} s @param {string} dir @param {boolean} again
   */
  async function bring(s, dir, again) {
    // A clone never stops to ask for a password: a private repository says so instead.
    const env = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
    const gitSaid = (/** @type {{ code: number, err: string, error: string | null }} */ r) => (r.error || r.err.split(/\r?\n/).filter(Boolean).at(-1) || `git ended with ${r.code}`).slice(0, 240);
    if (s.kind === "url") {
      const text = await fetchText(s.url);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "marketplace.json"), text);
      return;
    }
    const url = cloneUrl(s);
    if (!url) return;
    if (again && existsSync(join(dir, ".git"))) {
      const f = await git(["fetch", "--depth", "1", "origin"], { cwd: dir, env, timeoutMs: CLONE_MS });
      if (f.code !== 0) throw refused(502, `It could not be brought up to date: ${gitSaid(f)}`);
      const r = await git(["reset", "--hard", "FETCH_HEAD"], { cwd: dir, env, timeoutMs: CLONE_MS });
      if (r.code !== 0) throw refused(502, `It could not be brought up to date: ${gitSaid(r)}`);
      return;
    }
    mkdirSync(dirname(dir), { recursive: true });
    const r = await git(["clone", "--depth", "1", "--", url, dir], { cwd: dirname(dir), env, timeoutMs: CLONE_MS });
    if (r.code !== 0) throw refused(502, `It could not be cloned: ${gitSaid(r)}`);
  }

  /** An added marketplace's copy removed: only a folder under Filament's own. @param {string} id */
  function dropCopy(id) {
    const dir = join(addedDir, id);
    if (relative(addedDir, dir).startsWith("..")) return;
    // A clone's packs are read-only: removeTree makes them writable where Windows refuses them.
    if (!removeTree(dir)) log("warn", `plugins: the copy of marketplace ${id} was not removed (a program holds a file in it)`);
  }

  /** A marketplace by its id, with its plugins; else its refusal. @param {string} id @param {Record<string, any>} [doc]  Codex's config, read already */
  function marketOf(id, doc = codexConfig().doc) {
    const m = (id.startsWith("claude/") ? claudeMarkets().markets : id.startsWith("codex/") ? codexMarkets(doc) : addedAll().map(addedMarket)).find((x) => x.view.id === id);
    if (!m) throw refused(404, "There is no such marketplace here.");
    return m;
  }

  /** The names Anthropic's directory shows where they differ from a plugin's own, where Claude Code keeps its copy. */
  const directoryTitles = () => {
    const dir = directoryNow();
    return new Map((dir?.ok ? dir.listings : []).filter((l) => l.title !== l.name).map((l) => [l.name, l.title]));
  };
  /**
   * An entry with a name to show: its list's own, else the directory's, else the casing its own words give it.
   * @param {import("../core/plugins.js").MarketEntry} p @param {Map<string, string>} shown
   */
  const titled = (p, shown) => (p.title && p.title !== p.name ? p : { ...p, title: shown.get(p.name) || namedIn(p.description, p.name) || shownName("", p.name) });

  const api = {
    /**
     * One plugin of a source, by its name, for an install (B2): the marketplace's name and id, and its entry — its
     * folder made one of this computer, titled as the connectors' picker shows it. Anthropic's directory's (`directory`) installs at the commit Anthropic reviewed,
     * under the marketplace name Claude Desktop gives it.
     * @param {string} id @param {string} name
     * @returns {{ market: { id: string, name: string, title: string }, entry: import("../core/plugins.js").MarketEntry }}
     */
    entry(id, name) {
      if (id === "directory") {
        const dir = directoryNow();
        if (!dir) throw refused(404, "Claude Code's copy of Anthropic's directory is not on this computer.");
        if (!dir.ok) throw refused(409, dir.error);
        const l = dir.listings.find((x) => x.name === name || x.id === name);
        if (!l) throw refused(404, `Anthropic's directory lists no plugin "${name}".`);
        return {
          market: { id: "directory", name: "anthropic-plugin-directory", title: "Anthropic's directory" },
          entry: { name: l.name, title: l.title, description: l.summary, version: l.version, category: "", author: l.publisher, homepage: l.docs, source: l.source },
        };
      }
      const m = marketOf(id);
      const entry = m.plugins.find((p) => p.name === name);
      if (!entry) throw refused(404, `${m.view.title} lists no plugin "${name}".`);
      return { market: { id: m.view.id, name: m.view.name, title: m.view.title }, entry: titled(entry, directoryTitles()) };
    },

    /**
     * Everything found, for the Plugins page: the line it heads its list with, Claude Code's marketplaces and installed
     * plugins, Anthropic's directory (its count), Codex's, and the marketplaces added. Each says why a part of it could
     * not be read, and goes on with the rest.
     */
    found() {
      const cm = claudeMarkets();
      const ci = claudeInstalled();
      const dir = directoryNow();
      const cx = codexConfig();
      const xm = codexMarkets(cx.doc);
      const xi = codexInstalled(cx.doc);
      const claudeNames = [...new Set(ci.installed.map((p) => p.title))];
      const codexNames = [...new Set(xi.filter((p) => p.enabled !== false).map((p) => p.title))];
      // Where Add… installs each from (the Designer's §6 D): its marketplace here, else Anthropic's directory; "" where
      // neither lists it.
      const listed = new Set(dir?.ok ? dir.listings.map((l) => l.name) : []);
      /** @param {InstalledView} p @param {{ view: MarketView, plugins?: any[] }[]} markets */
      const fromOf = (p, markets) => {
        const m = markets.find((x) => x.view.name === p.marketplace);
        return m ? m.view.id : listed.has(p.name) ? "directory" : "";
      };
      return {
        line: foundWords({ claude: claudeNames, codex: codexNames }),
        claude: { there: existsSync(claudeDir), marketplaces: cm.markets.map((m) => m.view), installed: ci.installed.map((p) => ({ ...p, addFrom: fromOf(p, cm.markets) })), error: cm.error || ci.error },
        directory: dir ? (dir.ok ? { there: true, count: dir.listings.length, fetchedAt: dir.fetchedAt, error: "" } : { there: true, count: 0, fetchedAt: "", error: dir.error }) : { there: false, count: 0, fetchedAt: "", error: "" },
        codex: { there: existsSync(codexDir), marketplaces: xm.map((m) => m.view), installed: xi.map((p) => ({ ...p, addFrom: fromOf(p, xm) })), error: cx.error },
        added: addedAll().map((r) => addedMarket(r).view),
      };
    },

    /**
     * Every plugin every marketplace lists, for the connectors' picker: Claude Code's marketplaces first, then Codex's,
     * then those added — a marketplace of the same name met again is left out —, each entry with its marketplace and
     * the apps here that have it installed. An entry whose list gives it no name to show takes the one Anthropic's
     * directory gives it ("github" → "GitHub"), where Claude Code keeps its copy. A marketplace that cannot be read
     * brings none.
     * @returns {{ markets: MarketView[], entries: { market: MarketView, entry: import("../core/plugins.js").MarketEntry, installedIn: string[] }[] }}
     */
    allEntries() {
      const ci = claudeInstalled().installed;
      const cx = codexConfig();
      const inClaude = new Set(ci.filter((p) => p.from === "claude").map((p) => `${p.name}@${p.marketplace}`));
      const inCodex = new Set(codexInstalled(cx.doc).map((p) => `${p.name}@${p.marketplace}`));
      const shown = directoryTitles();
      const names = new Set();
      /** @type {MarketView[]} */
      const markets = [];
      const entries = [];
      for (const m of [...claudeMarkets().markets, ...codexMarkets(cx.doc), ...addedAll().map(addedMarket)]) {
        if (m.view.error || names.has(m.view.name)) continue;
        names.add(m.view.name);
        markets.push(m.view);
        for (const p of m.plugins) {
          const key = `${p.name}@${m.view.name}`;
          entries.push({ market: m.view, entry: titled(p, shown), installedIn: [...(inClaude.has(key) ? ["Claude Code"] : []), ...(inCodex.has(key) ? ["Codex"] : [])] });
        }
      }
      return { markets, entries };
    },

    /**
     * A page of one source's plugins, found by `q`: a marketplace's by its id, or `directory`, Anthropic's. Each says
     * where its files come from, and which app here has it installed.
     * @param {string} id @param {{ q?: string, limit?: number, offset?: number }} [o]
     */
    entries(id, o = {}) {
      const ci = claudeInstalled().installed;
      const cx = codexConfig();
      const xi = codexInstalled(cx.doc);
      if (id === "directory") {
        const dir = directoryNow();
        if (!dir) throw refused(404, "Claude Code's copy of Anthropic's directory is not on this computer.");
        if (!dir.ok) throw refused(409, dir.error);
        const synced = new Set(ci.filter((p) => p.from === "claude-desktop").map((p) => p.name));
        const page = searchPlugins(dir.listings, o);
        return {
          market: { id: "directory", title: "Anthropic's directory", fetchedAt: dir.fetchedAt, count: dir.listings.length },
          total: page.total,
          plugins: page.items.map((l) => ({ ...l, where: sourceWords(l.source), installedIn: synced.has(l.name) ? ["Claude Desktop"] : [] })),
        };
      }
      const m = marketOf(id, cx.doc);
      const inClaude = new Set(ci.filter((p) => p.from === "claude").map((p) => `${p.name}@${p.marketplace}`));
      const inCodex = new Set(xi.map((p) => `${p.name}@${p.marketplace}`));
      const page = searchPlugins(m.plugins, o);
      return {
        market: m.view,
        total: page.total,
        plugins: page.items.map((p) => /** @type {EntryView} */ ({
          ...p,
          where: sourceWords(p.source),
          installedIn: [...(inClaude.has(`${p.name}@${m.view.name}`) ? ["Claude Code"] : []), ...(inCodex.has(`${p.name}@${m.view.name}`) ? ["Codex"] : [])],
        })),
      };
    },

    /**
     * A marketplace added by what the person typed: cloned (or its list fetched, or its folder read where it stands),
     * kept, and its view. Refused in words: a source Filament does not take, one added already, past the most, one that
     * holds no marketplace.json — its copy then removed.
     * @param {unknown} input
     */
    async add(input) {
      const got = marketplaceInput(input);
      if (!got.ok) throw refused(400, got.error);
      const s = got.source;
      const key = sourceKey(s);
      const list = addedAll();
      if (list.some((r) => sourceKey(r.source) === key)) throw refused(409, "That marketplace is added already.");
      if (list.length >= PLUGIN_LIMITS.added) throw refused(409, `Filament keeps ${PLUGIN_LIMITS.added} marketplaces of yours at most: remove one first.`);
      if (s.kind === "path" && !existsSync(s.path)) throw refused(404, `There is no folder ${s.path}.`);
      if (busy.has(key)) throw refused(409, "That marketplace is being added now.");
      busy.add(key);
      const id = createHash("sha1").update(key).digest("hex").slice(0, 10);
      try {
        if (s.kind !== "path") {
          dropCopy(id);
          await bring(s, join(addedDir, id), false);
        }
        const at = now();
        /** @type {AddedRecord} */
        const rec = { id, source: s, at, updated: at, name: "" };
        const m = addedMarket(rec);
        if (m.view.error) {
          if (s.kind !== "path") dropCopy(id);
          throw refused(422, `It is not a marketplace: ${m.view.error}.`);
        }
        rec.name = m.view.name;
        addedWrite([...addedAll().filter((r) => r.id !== id), rec]);
        log("info", `plugins: added the marketplace ${m.view.name} (${sourceWords(s)})`);
        return m.view;
      } catch (e) {
        // A clone cut short, or one that holds no list: nothing of it stays.
        if (s.kind !== "path") dropCopy(id);
        throw e;
      } finally {
        busy.delete(key);
      }
    },

    /** An added marketplace brought up to date: fetched again, or its list read again. → its view. @param {string} id */
    async refresh(id) {
      const r = addedAll().find((x) => x.id === id);
      if (!r) throw refused(404, "There is no such marketplace of yours.");
      if (busy.has(id)) throw refused(409, "It is being brought up to date now.");
      busy.add(id);
      try {
        if (r.source.kind !== "path") await bring(r.source, join(addedDir, id), true);
        const rec = { ...r, updated: now() };
        const m = addedMarket(rec);
        addedWrite(addedAll().map((x) => (x.id === id ? { ...rec, name: m.view.name || r.name } : x)));
        return m.view;
      } finally {
        busy.delete(id);
      }
    },

    /** An added marketplace removed, and Filament's copy of it; a folder given is left as it is. → what it was. @param {string} id */
    remove(id) {
      const list = addedAll();
      const r = list.find((x) => x.id === id);
      if (!r) throw refused(404, "There is no such marketplace of yours.");
      addedWrite(list.filter((x) => x.id !== id));
      if (r.source.kind !== "path") dropCopy(id);
      log("info", `plugins: removed the marketplace ${r.name || id}`);
      return { id: `added/${id}`, name: r.name, origin: sourceWords(r.source) };
    },
  };
  return api;
}

/** @param {string} host */
const dnsResolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * A marketplace.json read from its address, LIST_BYTES at most, in FETCH_MS. The address the person gave is read where
 * it points; an answer that sends the read on (a redirect, REDIRECTS at most) is followed only to an address of the web,
 * each connection made to the addresses judged for it — so a marketplace cannot have Filament ask this computer or its
 * network for a page — and the body is read only up to its cap (the bug hunt of 10-30, SVC-5).
 * @param {string} url
 * @param {{ resolve?: (host: string) => Promise<string[]> }} [o]  how a name resolves, for the tests
 */
export async function fetchList(url, { resolve = dnsResolve } = {}) {
  const signal = AbortSignal.timeout(FETCH_MS);
  let at = new URL(url);
  for (let hop = 0; ; hop++) {
    if (hop) {
      const problem = await hostProblem(at, { resolve });
      if (problem) throw refused(502, `It could not be read: its address sent the read on to ${at.host}, which Filament does not follow (${problem.split(";")[0]}).`);
    }
    /** @type {import("node:http").IncomingMessage} */
    let res;
    try {
      res = await new Promise((done, fail) => {
        const options = { method: "GET", agent: false, signal, headers: { accept: "application/json" }, ...(hop ? { lookup: judgedLookup({ allowPrivate: false, resolve }) } : {}) };
        const req = (at.protocol === "https:" ? httpsRequest : httpRequest)(at, options, done);
        req.on("error", fail);
        req.end();
      });
    } catch (e) {
      throw refused(502, `It could not be read: ${said(e).slice(0, 160)}`);
    }
    const status = res.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.destroy();
      if (hop >= REDIRECTS) throw refused(502, `It could not be read: its address sent the read on more than ${REDIRECTS} times.`);
      try {
        at = new URL(res.headers.location, at);
      } catch {
        throw refused(502, "It could not be read: its address sent the read on to something that is not an address.");
      }
      continue;
    }
    if (status < 200 || status > 299) {
      res.destroy();
      throw refused(502, `It could not be read: the address answered ${status}.`);
    }
    /** @type {Buffer[]} */
    const parts = [];
    let bytes = 0;
    try {
      for await (const chunk of res) {
        bytes += chunk.length;
        if (bytes > LIST_BYTES) {
          res.destroy();
          throw refused(413, "Its marketplace.json is larger than Filament reads.");
        }
        parts.push(chunk);
      }
    } catch (e) {
      if (/** @type {any} */ (e)?.status) throw e;
      throw refused(502, `It could not be read: ${said(e).slice(0, 160)}`);
    }
    return Buffer.concat(parts).toString("utf8");
  }
}
