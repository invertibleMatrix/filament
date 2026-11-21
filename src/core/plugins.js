// @ts-check
// Plugins from Claude Code, Codex and marketplaces (HarnessV4_SpacesPlugins_Plan B1): what their files say, in one
// shape. A marketplace's list — Claude's `.claude-plugin/marketplace.json`, Codex's `.agents/plugins/marketplace.json`,
// both a published format —, a plugin's manifest (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`),
// Anthropic's directory as Claude Code keeps its copy (`plugin-directory-cache-v2.json`, each listing with the commit
// Anthropic reviewed), where a plugin's files come from said in words, and what a person types to add a marketplace.
// Nothing here reads a disk or the network: app/plugin-sources.js does.
import { INLINE_FIELDS } from "./plugin-parts.js";

/** How much of a plugin's words, names and lists is kept; how many marketplaces a person adds; a page of the directory. */
export const PLUGIN_LIMITS = Object.freeze({ name: 64, title: 120, text: 600, entries: 2000, added: 32, query: 120, page: 100 });

/**
 * Where a plugin's files come from. `path`: a folder, relative to its marketplace's root until the reader resolves it;
 * `github`: a repository on GitHub; `git`: any git address — `path` a folder in it (Claude's `git-subdir`), `ref` a
 * branch or tag, `sha` the commit; `npm`: a package; `url`: a marketplace's own list at an address; `unknown`: a kind
 * Filament does not fetch, said in words.
 * @typedef {{ kind: "path", path: string }
 *   | { kind: "github", repo: string, ref: string, sha: string, path: string }
 *   | { kind: "git", url: string, ref: string, sha: string, path: string }
 *   | { kind: "npm", package: string, version: string }
 *   | { kind: "url", url: string }
 *   | { kind: "unknown", said: string }} PluginSource
 */

/**
 * A plugin a marketplace lists: its name (how it is addressed, `name@marketplace`), the name it shows, its words, its
 * version where the list says it, its category, who made it, its page, where its files come from, and the parts its
 * entry writes itself, where it writes some (`inline`: Claude's language servers of gopls-lsp, say, which its folder
 * does not hold).
 * @typedef {{ name: string, title: string, description: string, version: string, category: string, author: string,
 *   homepage: string, source: PluginSource, inline?: import("./plugin-parts.js").Inline }} MarketEntry
 */

/**
 * A marketplace's list: its name, words, owner, its plugins, and the names it renamed (Claude's `renames`, old → new).
 * @typedef {{ name: string, title: string, description: string, owner: string, plugins: MarketEntry[],
 *   renames: Record<string, string> }} Marketplace
 */

/**
 * A plugin's own manifest: its name, the name it shows, its words, version, author, page, repository, keywords.
 * @typedef {{ name: string, title: string, description: string, version: string, author: string, homepage: string,
 *   repository: string, keywords: string[] }} PluginManifest
 */

/**
 * A listing of Anthropic's directory: its id, the name it is installed under, the name it shows, its words, version,
 * publisher; who reviewed it (`anthropic`, `partner`, or "" for none yet); the apps it is for; where its files are — the
 * repository, the folder in it, and the commit Anthropic reviewed —; its documentation's address.
 * @typedef {{ id: string, name: string, title: string, summary: string, version: string, publisher: string,
 *   reviewed: "anthropic" | "partner" | "", surfaces: string[], source: PluginSource, docs: string }} DirListing
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A string of a file's, trimmed and cut to `max`; "" for anything else. @param {unknown} v @param {number} [max] */
export const textOf = (v, max = PLUGIN_LIMITS.text) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Who made it, from a string or `{ name }`. @param {unknown} v */
const whoOf = (v) => (typeof v === "string" ? textOf(v, PLUGIN_LIMITS.title) : isObject(v) ? textOf(v.name, PLUGIN_LIMITS.title) : "");

/** An address, from a string or `{ url }`. @param {unknown} v */
const addressOf = (v) => (typeof v === "string" ? textOf(v, 400) : isObject(v) ? textOf(v.url, 400) : "");

/**
 * A plugin's or a marketplace's name as both apps take it: letters, digits, `.`, `_` and `-`, a letter or digit
 * first, 64 at most. null for any other.
 * @param {unknown} v
 */
export function pluginName(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && s.length <= PLUGIN_LIMITS.name ? s : null;
}

/** "owner/repo" as GitHub names a repository; null for any other. @param {unknown} v */
const repoOf = (v) => {
  const s = typeof v === "string" ? v.trim().replace(/\.git$/i, "").replace(/\/+$/, "") : "";
  return /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
};

/** A relative folder in a marketplace or a repository, `./` dropped; null for one that climbs out or is absolute. @param {unknown} v */
function innerPath(v) {
  const s = typeof v === "string" ? v.trim().replace(/\\/g, "/") : "";
  if (!s) return "";
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) return null;
  const parts = s.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) return null;
  return parts.join("/");
}

/**
 * Words for an address, a ref or a commit git would read as one of its options — `--upload-pack=<command>` runs the
 * command —; "" where none does.
 * @param {{ url?: string, ref: string, sha: string }} o
 */
function optionWords({ url = "", ref, sha }) {
  if (url.startsWith("-")) return `an address that reads as one of git's options (${url})`;
  if (ref.startsWith("-")) return `a branch that reads as one of git's options (${ref})`;
  if (sha.startsWith("-")) return `a commit that reads as one of git's options (${sha})`;
  return "";
}

/**
 * Where a marketplace says a plugin's files are, in one shape: a relative path (Claude's string, Codex's `local`),
 * `github`, `url` and `git-subdir` (git), `npm`. A path that climbs out of the marketplace, an address, ref or commit
 * that reads as one of git's options, or a kind Filament does not fetch, is `unknown`, in words.
 * @param {unknown} raw @returns {PluginSource}
 */
export function sourceOf(raw) {
  if (typeof raw === "string") {
    const p = innerPath(raw);
    return p === null ? { kind: "unknown", said: `a folder outside its marketplace (${textOf(raw, 200)})` } : { kind: "path", path: p };
  }
  if (!isObject(raw)) return { kind: "unknown", said: "no source" };
  const ref = textOf(raw.ref, 200);
  const sha = textOf(raw.sha || raw.commit, 64);
  switch (raw.source) {
    case "local":
    case "path":
    case "directory": {
      const p = innerPath(raw.path);
      return p === null ? { kind: "unknown", said: `a folder outside its marketplace (${textOf(raw.path, 200)})` } : { kind: "path", path: p };
    }
    case "github": {
      const repo = repoOf(raw.repo);
      const option = optionWords({ ref, sha });
      if (option) return { kind: "unknown", said: option };
      return repo ? { kind: "github", repo, ref, sha, path: "" } : { kind: "unknown", said: "a GitHub source with no repository" };
    }
    case "url":
    case "git":
    case "git-subdir": {
      const url = textOf(raw.url || raw.repo, 400);
      const path = innerPath(raw.path);
      if (!url) return { kind: "unknown", said: "a git source with no address" };
      const option = optionWords({ url, ref, sha });
      if (option) return { kind: "unknown", said: option };
      if (path === null) return { kind: "unknown", said: `a folder outside its repository (${textOf(raw.path, 200)})` };
      const gh = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(url);
      const repo = gh ? repoOf(gh[1]) : null;
      return repo ? { kind: "github", repo, ref, sha, path } : { kind: "git", url, ref, sha, path };
    }
    case "npm": {
      const pkg = textOf(raw.package, 214);
      return pkg ? { kind: "npm", package: pkg, version: textOf(raw.version, 64) } : { kind: "unknown", said: "an npm source with no package" };
    }
    case "pip":
      return { kind: "unknown", said: "a Python package, which Filament does not install" };
    default:
      return { kind: "unknown", said: `a source of the kind ${textOf(String(raw.source ?? "none"), 40)}, which Filament does not fetch` };
  }
}

/**
 * Where a plugin's files come from, in words: "github.com/obra/superpowers at 8ca22db", "github.com/anthropics/
 * claude-plugins-official · external_plugins/linear", "./plugins/discord", "npm: @acme/plugin 1.2.0".
 * @param {PluginSource} s
 */
export function sourceWords(s) {
  const at = (/** @type {{ ref: string, sha: string }} */ g) => (g.sha ? ` at ${g.sha.slice(0, 7)}` : g.ref ? ` at ${g.ref}` : "");
  switch (s.kind) {
    case "path":
      // A folder inside its marketplace, or one named whole (a marketplace you added from this computer's folder).
      return s.path ? (/^(?:[A-Za-z]:|[\\/])/.test(s.path) ? s.path : `./${s.path}`) : "its marketplace's own folder";
    case "github":
      return `github.com/${s.repo}${s.path ? ` · ${s.path}` : ""}${at(s)}`;
    case "git":
      return `${s.url.replace(/^https?:\/\//, "")}${s.path ? ` · ${s.path}` : ""}${at(s)}`;
    case "npm":
      return `npm: ${s.package}${s.version ? ` ${s.version}` : ""}`;
    case "url":
      return s.url.replace(/^https?:\/\//, "");
    default:
      return s.said;
  }
}

/**
 * A marketplace's list, as Claude's or Codex's file says it. Refused in words for a file that is no list; a plugin
 * whose name neither app would take is left out, and so is a second one of the same name. An entry that writes parts
 * of its plugin's manifest itself keeps them as written, with its `strict` (true unless it says false).
 * @param {unknown} doc
 * @returns {{ ok: true, market: Marketplace } | { ok: false, error: string }}
 */
export function marketplaceOf(doc) {
  if (!isObject(doc)) return { ok: false, error: "it is not a marketplace: no JSON object" };
  if (!Array.isArray(doc.plugins)) return { ok: false, error: "it is not a marketplace: it lists no plugins" };
  const name = pluginName(doc.name);
  if (!name) return { ok: false, error: "it is not a marketplace: it names itself in no way both apps take" };
  /** @type {MarketEntry[]} */
  const plugins = [];
  const seen = new Set();
  for (const p of doc.plugins.slice(0, PLUGIN_LIMITS.entries)) {
    if (!isObject(p)) continue;
    const n = pluginName(p.name);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const ui = isObject(p.interface) ? p.interface : {};
    const parts = Object.fromEntries(INLINE_FIELDS.filter((f) => p[f] !== undefined).map((f) => [f, p[f]]));
    plugins.push({
      name: n,
      title: textOf(p.displayName || ui.displayName, PLUGIN_LIMITS.title) || n,
      description: textOf(p.description || ui.shortDescription),
      version: textOf(p.version, 64),
      category: textOf(p.category, 60),
      author: whoOf(p.author),
      homepage: addressOf(p.homepage),
      source: sourceOf(p.source),
      ...(Object.keys(parts).length ? { inline: { strict: p.strict !== false, parts } } : {}),
    });
  }
  const ui = isObject(doc.interface) ? doc.interface : {};
  const renames = isObject(doc.renames)
    ? Object.fromEntries(Object.entries(doc.renames).filter(([a, b]) => pluginName(a) && pluginName(b)).map(([a, b]) => [a, String(b)]))
    : {};
  return {
    ok: true,
    market: {
      name,
      title: textOf(ui.displayName, PLUGIN_LIMITS.title) || name,
      description: textOf(doc.description || (isObject(doc.metadata) ? doc.metadata.description : "")),
      owner: whoOf(doc.owner),
      plugins,
      renames,
    },
  };
}

/**
 * A plugin's manifest, Claude's or Codex's (`interface.displayName`, `interface.shortDescription`). Refused in words
 * for a file that names no plugin.
 * @param {unknown} doc
 * @returns {{ ok: true, manifest: PluginManifest } | { ok: false, error: string }}
 */
export function manifestOf(doc) {
  if (!isObject(doc)) return { ok: false, error: "its plugin.json is no JSON object" };
  const name = pluginName(doc.name);
  if (!name) return { ok: false, error: "its plugin.json names it in no way both apps take" };
  const ui = isObject(doc.interface) ? doc.interface : {};
  return {
    ok: true,
    manifest: {
      name,
      title: textOf(ui.displayName || doc.displayName, PLUGIN_LIMITS.title) || name,
      description: textOf(doc.description || ui.shortDescription),
      version: textOf(doc.version, 64),
      author: whoOf(doc.author) || textOf(ui.developerName, PLUGIN_LIMITS.title),
      homepage: addressOf(doc.homepage),
      repository: addressOf(doc.repository),
      keywords: Array.isArray(doc.keywords) ? doc.keywords.filter((k) => typeof k === "string").slice(0, 20).map((k) => textOf(k, 40)) : [],
    },
  };
}

/**
 * Anthropic's directory as Claude Code keeps its copy: when it was fetched, and each listing with the name it installs
 * under (`entryNames`), its words, who reviewed it, and the commit Anthropic reviewed. A listing with no repository,
 * or with no name both apps take (`pluginName`), is left out. Refused in words for a file of another shape.
 * @param {unknown} doc
 * @returns {{ ok: true, fetchedAt: string, listings: DirListing[] } | { ok: false, error: string }}
 */
export function directoryOf(doc) {
  if (!isObject(doc) || !Array.isArray(doc.listings)) return { ok: false, error: "it is not Claude Code's copy of the directory: no listings" };
  const names = isObject(doc.entryNames) ? doc.entryNames : {};
  /** @type {DirListing[]} */
  const listings = [];
  for (const l of doc.listings) {
    if (!isObject(l)) continue;
    const id = textOf(l.id, 80);
    const repo = isObject(l.source) && isObject(l.source.repository) ? l.source.repository : null;
    const url = repo ? textOf(repo.url, 400) : "";
    if (!id || !url) continue;
    const title = textOf(l.name, PLUGIN_LIMITS.title);
    // Its id stands in only where it is a name too: an id is any text of the file, and the name is the folder it is
    // installed into (app/plugins.js). A listing with no name both apps take is left out, as a marketplace's entry is.
    const name = pluginName(names[id]) || pluginName(title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || pluginName(id);
    if (!name) continue;
    const by = isObject(l.checks) && isObject(l.checks.review) && l.checks.review.state === "done" && isObject(l.checks.review.by) ? l.checks.review.by.type : "";
    listings.push({
      id,
      name,
      title: title || name,
      summary: textOf(l.summary),
      version: isObject(l.release) ? textOf(l.release.version, 64) : "",
      publisher: isObject(l.publisher) ? textOf(l.publisher.name, PLUGIN_LIMITS.title) : "",
      reviewed: by === "anthropic" || by === "partner" ? by : "",
      surfaces: Array.isArray(l.surfaces) ? l.surfaces.filter((s) => typeof s === "string").slice(0, 8) : [],
      source: sourceOf({ source: "git-subdir", url, path: repo?.path, sha: repo?.reviewed_commit }),
      docs: isObject(l.links) ? textOf(l.links.documentation, 400) : "",
    });
  }
  return { ok: true, fetchedAt: textOf(doc.fetchedAt, 40), listings };
}

/**
 * The listings a search finds, a page of them: every word of `q` in its name, title, words or publisher; a name that
 * starts with the search first, then those Anthropic or a partner reviewed, in the directory's own order otherwise.
 * @template {{ name: string, title: string, summary?: string, description?: string, publisher?: string, author?: string, reviewed?: string }} T
 * @param {readonly T[]} all @param {{ q?: string, limit?: number, offset?: number }} [o]
 * @returns {{ total: number, items: T[] }}
 */
export function searchPlugins(all, { q = "", limit = 50, offset = 0 } = {}) {
  const words = String(q).toLowerCase().slice(0, PLUGIN_LIMITS.query).split(/\s+/).filter(Boolean);
  const hay = (/** @type {T} */ x) => `${x.name} ${x.title} ${x.summary || x.description || ""} ${x.publisher || x.author || ""}`.toLowerCase();
  const found = words.length ? all.filter((x) => words.every((w) => hay(x).includes(w))) : [...all];
  if (words.length) {
    const rank = (/** @type {T} */ x) => (x.name.toLowerCase().startsWith(words[0]) || x.title.toLowerCase().startsWith(words[0]) ? 0 : x.reviewed ? 1 : 2);
    found.sort((a, b) => rank(a) - rank(b));
  }
  const n = Math.max(1, Math.min(PLUGIN_LIMITS.page, Math.floor(Number(limit)) || 50));
  const from = Math.max(0, Math.floor(Number(offset)) || 0);
  return { total: found.length, items: found.slice(from, from + n) };
}

/**
 * What a person types to add a marketplace, as its source: `owner/repo` or a GitHub address (`github`), a git address
 * (`https://….git`, `git@…`, `ssh://`, `file://`: `git`), an address of a marketplace.json (`url`), or a folder on this
 * computer (`path`, read where it stands). Refused in words for anything else.
 * @param {unknown} input
 * @returns {{ ok: true, source: PluginSource } | { ok: false, error: string }}
 */
export function marketplaceInput(input) {
  const s = typeof input === "string" ? input.trim() : "";
  const no = { ok: /** @type {const} */ (false), error: "Say a GitHub repository (owner/repo), a git address, the address of a marketplace.json, or a folder on this computer." };
  if (!s || s.length > 400) return no;
  const repo = repoOf(s);
  if (repo && !s.includes(":")) return { ok: true, source: { kind: "github", repo, ref: "", sha: "", path: "" } };
  const gh = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(s);
  if (gh && repoOf(gh[1])) return { ok: true, source: { kind: "github", repo: /** @type {string} */ (repoOf(gh[1])), ref: "", sha: "", path: "" } };
  if (/^(git@[^:]+:.+|ssh:\/\/.+|file:\/\/.+|https?:\/\/.+\.git\/?)$/i.test(s)) return { ok: true, source: { kind: "git", url: s, ref: "", sha: "", path: "" } };
  if (/^https:\/\/.+\.json(\?.*)?$/i.test(s)) return { ok: true, source: { kind: "url", url: s } };
  if (/^https?:\/\//i.test(s)) return { ok: false, error: "That address is neither a git repository (….git) nor a marketplace.json." };
  if (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\")) return { ok: true, source: { kind: "path", path: s } };
  return no;
}

/** One source's key, for telling a marketplace added twice. @param {PluginSource} s */
export function sourceKey(s) {
  switch (s.kind) {
    case "github":
      return `github:${s.repo.toLowerCase()}`;
    case "git":
      return `git:${s.url.replace(/\.git\/?$/i, "").replace(/\/+$/, "").toLowerCase()}`;
    case "url":
      return `url:${s.url}`;
    case "path":
      return `path:${s.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()}`;
    case "npm":
      return `npm:${s.package}`;
    default:
      return `unknown:${s.said}`;
  }
}

/** "A", "A and B", "A, B and C". @param {readonly string[]} xs */
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The line the Plugins page heads its list with (§6 D): "Found on this computer — Claude Code: Discord · Codex: Browser,
 * PDF and 9 more"; "" where neither app has a plugin installed.
 * @param {{ claude: readonly string[], codex: readonly string[] }} names  the names each shows, installed there
 * @param {number} [most]  how many are named per app before "and N more"
 */
export function foundWords({ claude, codex }, most = 4) {
  const part = (/** @type {string} */ app, /** @type {readonly string[]} */ xs) => {
    if (!xs.length) return "";
    const named = xs.slice(0, xs.length > most ? most - 1 : most);
    const more = xs.length - named.length;
    return `${app}: ${more ? `${named.join(", ")} and ${more} more` : listWords(named)}`;
  };
  const parts = [part("Claude Code", claude), part("Codex", codex)].filter(Boolean);
  return parts.length ? `Found on this computer — ${parts.join(" · ")}` : "";
}
