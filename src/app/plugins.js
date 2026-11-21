// @ts-check
// Plugins installed in Filament (HarnessV4_SpacesPlugins_Plan B2): a plugin a source lists (app/plugin-sources.js) is
// copied at a fixed version or commit into Filament's own data folder — `plugins/installed/<name@marketplace>/<version>`
// —, never run from Claude's or Codex's copy, which update under it (PL-D1); beside it a data folder of its own,
// `plugins/data/<name@marketplace>`, which its updates keep. What it holds is read once, as it is copied: its MCP
// servers, hooks, skills, commands and agents, the values it asks for, and the parts Filament does not run here, said
// (PL-D6) — with the parts its marketplace's entry writes itself, kept with it. The values it asks for are kept per
// place — all chats, a project (a Space), a chat —, a secret one sealed with Filament's key and never shown again.
// Check looks at its source and its entry for a newer version: one that changes only words goes through; one that
// changes what runs — a server's command, a hook — waits for Update, as a dashboard's new version waits for Keep.
// Uninstall removes its copy, and its data folder only when asked. Installing runs nothing: a plugin's parts reach a
// chat once it is turned on at a place (B3), its hooks only once switched on there (PL-D3).
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { SKILL_BODY_CAP, parseSkillFile, pluginLine } from "./agent/skills.js";
import { manifestOf, pluginName, sourceWords } from "../core/plugins.js";
import { estimateTokens } from "../core/tokens.js";
import { HOOK_MOMENTS, checkValues, envAsksOf, fillPaths, fillSpec, hooksOf, inlineConflict, lspServersOf, mcpServersOf, notHereWords, partPaths, pluginEnv, runChangeWords, runKeyOf, userConfigOf } from "../core/plugin-parts.js";
import { git as runGit } from "../adapters/git/snapshot.js";
import { loadKey, open, seal } from "../services/config/secrets.js";
import { SECRET_MARK, mergeServers } from "../services/mcp-servers.js";

/**
 * A plugin as Filament keeps it installed: its id (`name@marketplace`), name, the marketplace and the source it came
 * from (the source's id on the Plugins page, the source as fetched — its commit where git has one — and in words), its
 * kind (Claude's or Codex's layout), its name and words, version and commit, the folder of the version in use, the
 * parts its marketplace's entry wrote itself as it was installed (`inline`; null, or not there, where it wrote none),
 * when it was installed and last changed, an update that waits for the person's press — with its entry's parts —, and
 * when its source was last looked at.
 * @typedef {{ id: string, name: string, marketplace: string, from: string, source: import("../core/plugins.js").PluginSource,
 *   origin: string, kind: "claude" | "codex", title: string, description: string, version: string, sha: string,
 *   folder: string, inline?: import("../core/plugin-parts.js").Inline | null, at: number, updated: number, checked: number,
 *   pending: { folder: string, version: string, sha: string, words: string, at: number, inline?: import("../core/plugin-parts.js").Inline | null } | null }} InstalledPlugin
 */

/**
 * A folder removed whole, never thrown: git keeps its packs read-only, and the Node in Filament's desktop app refuses to
 * delete a read-only file on Windows — every look at a repository failed on its cleanup, and its folder stayed (10-26).
 * Where the plain removal fails, each file is made writable and the removal tried again. → whether it is gone.
 * @param {string} path
 */
export function removeTree(path) {
  const rm = () => {
    try {
      rmSync(path, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };
  if (rm()) return true;
  /** @param {string} at */
  const writable = (at) => {
    let st;
    try {
      st = lstatSync(at);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    try {
      chmodSync(at, st.isDirectory() ? 0o777 : 0o666);
    } catch {
      // Left as it is: the removal says whether it mattered.
    }
    if (!st.isDirectory()) return;
    let names = /** @type {string[]} */ ([]);
    try {
      names = readdirSync(at);
    } catch {
      return;
    }
    for (const n of names) writable(join(at, n));
  };
  writable(path);
  return rm();
}

/** A place a plugin's values are kept for: your defaults, a project's (a Space's), a chat's. */
const PLACE =/^(all|project:[A-Za-z0-9_-]{1,80}|chat:[A-Za-z0-9_-]{1,120})$/;
/** How long fetching a plugin's commit may take. */
const FETCH_MS = 180_000;
/** How long a look at a plugin in its repository may take, each git step; the most files and JSON files it reads. */
const LOOK_MS = 60_000;
const LOOK_FILES = 20_000;
const LOOK_JSON = 40;
/** A server on demand's weight in every request: its line among the MCP servers, its name and how many tools it has. */
const WEIGHT_PER_SERVER = 10;
/** The files a tree's key reads whole: those under this many bytes; bigger ones by their size alone. */
const HASH_WHOLE_BYTES = 1024 * 1024;

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);
/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A JSON file's value, or null where it is not there or not JSON. @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

/** A file written whole, through a temporary one. @param {string} path @param {unknown} value */
function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

/** The entries of a folder; none where it is not one. @param {string} dir */
const entriesOf = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * A plugin's MCP server's name in Filament (B3): `<plugin>`, or `<plugin>-<server>` where the two differ, as Filament
 * names a server — a-z, 0-9 and -, a letter first, 32 at most.
 * @param {string} plugin @param {string} server
 */
export function serverName(plugin, server) {
  const raw = (plugin.toLowerCase() === server.toLowerCase() ? plugin : `${plugin}-${server}`).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const named = /^[a-z]/.test(raw) ? raw : `p-${raw}`;
  const cut = named.slice(0, 32).replace(/-+$/, "") || "plugin";
  // Filament's own server has its name: a plugin's of that name is told apart.
  return cut === "filament" ? "filament-plugin" : cut;
}

/**
 * A plugin's language server as its page shows it: its name in Filament (`serverName`), what it starts, and the files
 * it serves.
 * @param {string} plugin @param {{ name: string, spec: Record<string, any> }} s
 */
const lspRow = (plugin, s) => ({ name: s.name, as: serverName(plugin, s.name), runs: [s.spec.command, ...(s.spec.args || [])].join(" "), files: Object.keys(s.spec.languages || {}) });

/**
 * What a server reaches, as one key: its address with its headers, or its program with its arguments and environment —
 * and the account it signs in with. Two servers of one key are one connection twice. Null for an entry that is no
 * server (a switch, a pick).
 * @param {unknown} m
 */
export function reachOf(m) {
  if (!isObject(m)) return null;
  /** @param {unknown} o */
  const sorted = (o) => JSON.stringify(Object.entries(isObject(o) ? o : {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const account = String(m.account || "").trim().toLowerCase();
  if (typeof m.url === "string" && m.url.trim()) {
    let at = m.url.trim();
    try {
      const u = new URL(at);
      at = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    } catch {}
    return `url ${at} ${sorted(m.headers)} ${account}`;
  }
  if (typeof m.command === "string" && m.command.trim()) return `run ${m.command.trim().replace(/\.(cmd|exe|bat)$/i, "").toLowerCase()} ${JSON.stringify(Array.isArray(m.args) ? m.args : [])} ${sorted(m.env)}`;
  return null;
}

/** Claude's tools that only read: an agent whose list names no other reads only. */
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch", "NotebookRead", "TodoRead", "TodoWrite", "BashOutput"]);
/** Claude's tools that write files: an agent whose list names one edits in its own copy. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** A part of a plugin's agent's tag: lower case, a-z, 0-9, `.`, `_`, `-`. @param {string} s */
const tagPart = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 64) || "agent";

/**
 * A plugin's agent (`agents/<name>.md`, Claude's sub-agent file) as an agent card (B3): tagged `<plugin>:<name>`, its
 * name as its file gives it, good for the first words of its description (its examples left out), thinking its body.
 * Its tool list sets what it may do, as near as Filament's levels come: only Claude's reading tools — reads only; a tool
 * that writes files — edits in its own copy; others, such as Bash — runs in its own copy; no list (all of them) — edits
 * in its own copy. A list also switches off what it leaves out: the shell without Bash, the web without WebFetch or
 * WebSearch, MCP servers without an `mcp__` tool, and Filament's own browser, visuals and Space. It runs on the chat's
 * model (`inherit`, and any model it names, for now) and sees nothing of the chat, as a card of yours starts.
 * @param {{ id: string, name: string }} p @param {string} file @param {string} text
 * @returns {import("../services/agent-cards.js").AgentCard}
 */
export function pluginAgentCard(p, file, text) {
  const { meta, body } = parseSkillFile(text);
  const own = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : basename(file).replace(/\.md$/i, "");
  const listed = Array.isArray(meta.tools) ? meta.tools : typeof meta.tools === "string" ? meta.tools.split(",") : [];
  const tools = listed.map((t) => String(t).trim()).filter(Boolean);
  const may = !tools.length ? "edit" : tools.every((t) => READ_TOOLS.has(t)) ? "read" : tools.some((t) => WRITE_TOOLS.has(t)) ? "edit" : "copy";
  /** @type {("shell" | "browser" | "web" | "mcp" | "visuals" | "space")[]} */
  const toolsOff = tools.length
    ? [
        ...(tools.includes("Bash") ? [] : /** @type {const} */ (["shell"])),
        /** @type {const} */ ("browser"),
        ...(tools.includes("WebFetch") || tools.includes("WebSearch") ? [] : /** @type {const} */ (["web"])),
        ...(tools.some((t) => t.startsWith("mcp__")) ? [] : /** @type {const} */ (["mcp"])),
        /** @type {const} */ ("visuals"),
        /** @type {const} */ ("space"),
      ]
    : [];
  const words = String(meta.description || "").replace(/\\n/g, "\n").replace(/<example>[\s\S]*?<\/example>/gi, " ").replace(/\s+/g, " ").trim();
  const goodFor = words.length > 160 ? `${words.slice(0, 159).trimEnd()}…` : words || `An agent of the plugin ${p.name}`;
  return {
    tag: `${tagPart(p.name)}:${tagPart(own)}`,
    name: own.slice(0, 40),
    partOf: null,
    goodFor,
    thinks: body.slice(0, SKILL_BODY_CAP),
    may,
    models: [],
    model: null,
    sees: { view: "none", running: false, changes: null },
    mayRun: [],
    toolsOff,
    shipped: false,
    from: null,
    plugin: p.id,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A folder name for a version: letters, digits, `.`, `-`, `_`. @param {string} s */
const folderName = (s) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "local";
/** A version's folder as `folderName` makes one: one plain name, never a path. */
const FOLDER_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
/** A name both apps take, as it is: what `pluginName` gives back unchanged. @param {unknown} v */
const namedSo = (v) => typeof v === "string" && pluginName(v) === v;
/**
 * Whether a record of `installed.json` names its folders as Filament does, the one rule for them: its id
 * `<name>@<marketplace>`, each a name both apps take, and its version's folder — and a waiting update's — one
 * `folderName` makes. Each becomes a folder under `installed/` and `data/` that is read, replaced and removed by that
 * name, so none is ever a path.
 * @param {Record<string, any>} p
 */
function asInstalled(p) {
  const [name, market, ...more] = p.id.split("@");
  const waits = p.pending == null || (isObject(p.pending) && typeof p.pending.folder === "string" && FOLDER_NAME.test(p.pending.folder));
  return !more.length && namedSo(name) && namedSo(market) && FOLDER_NAME.test(p.folder) && waits;
}

/** A value as JSON, each object's keys in order: two copies that differ in their order alone are one. @param {unknown} v */
const sortedJson = (v) => JSON.stringify(v, (_k, x) => (isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** The key of the parts an entry writes itself; "" for none. @param {import("../core/plugin-parts.js").Inline | null | undefined} inline */
const inlineKey = (inline) => (inline ? createHash("sha1").update(sortedJson(inline)).digest("hex") : "");

/**
 * A version's folder: its name for a version, and the key of the parts its marketplace's entry writes itself where it
 * writes some — the same files under another entry are another version.
 * @param {string} s @param {import("../core/plugin-parts.js").Inline | null | undefined} inline
 */
const versionFolder = (s, inline) => (inline ? `${folderName(s).slice(0, 50)}-e${inlineKey(inline).slice(0, 8)}` : folderName(s));

/** Whether a path is a folder's own or inside it. @param {string} root @param {string} p */
const within = (root, p) => {
  const rel = relative(root, p);
  return !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * A plugin folder copied, its `.git` left out. Every later read of the copy follows its links, so a link is copied as
 * what it points to where that is a file or a folder inside the plugin's own — each folder once, never one holding the
 * link — and left out where it points anywhere else: a `SKILL.md` that is a link to `~/.ssh/id_rsa` brings nothing in
 * (the bug hunt of 10-30, SVC-4).
 * @param {string} from @param {string} to
 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  const root = realpathSync(from);
  /** The folders a link brought in, so links that point at each other's folders end. @type {Set<string>} */
  const linked = new Set();
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      if (/[\\/]\.git$/.test(src) && resolve(src) !== resolve(from)) return false;
      try {
        if (!lstatSync(src).isSymbolicLink()) return true;
        const at = realpathSync(src);
        if (!within(root, at)) return false;
        if (!statSync(at).isDirectory()) return true;
        if (linked.has(at) || within(at, realpathSync(dirname(src)))) return false;
        linked.add(at);
        return true;
      } catch {
        return false;
      }
    },
  });
}

/**
 * A key of what a folder holds: each file's path and its content (a big one by its size), `.git` and `node_modules`
 * left out. Two copies of the same folder have the same key.
 * @param {string} root
 */
export function treeKey(root) {
  const h = createHash("sha1");
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of entriesOf(dir).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const rel = relative(root, p).replace(/\\/g, "/");
        let size = 0;
        try {
          size = statSync(p).size;
        } catch {}
        h.update(`${rel}\0${size}\0`);
        if (size < HASH_WHOLE_BYTES) {
          try {
            h.update(readFileSync(p));
          } catch {}
        }
      }
    }
  };
  walk(root);
  return h.digest("hex");
}

/**
 * What a plugin's folder holds (B3's table): its manifest (or the marketplace's words where it has none), its kind, its
 * MCP servers, language servers, hooks, skills, commands and agents, the values it asks for, and the parts Filament
 * does not run here. The parts its marketplace's entry writes itself (`inline`) are read as Claude Code reads them: a
 * `strict: false` entry is its whole manifest, a strict one adds to its plugin.json. One that is its whole manifest
 * beside a plugin.json that says what it holds too is refused in words, the two in conflict (`inlineConflict`).
 * @param {string} root @param {"claude" | "codex"} guess  the kind where its folder says neither
 * @param {{ name: string, title?: string, description?: string, version?: string, inline?: import("../core/plugin-parts.js").Inline | null }} fallback
 *   its marketplace's entry
 */
export function readPlugin(root, guess, fallback) {
  const claude = readJson(join(root, ".claude-plugin", "plugin.json"));
  const codex = readJson(join(root, ".codex-plugin", "plugin.json"));
  const kind = claude ? "claude" : codex ? "codex" : guess;
  const raw = (kind === "claude" ? claude : codex) || {};
  const inline = fallback.inline || null;
  const conflict = inlineConflict(raw, inline);
  if (conflict) throw refused(422, conflict);
  const m = manifestOf(Object.keys(raw).length ? raw : { name: fallback.name, description: fallback.description, version: fallback.version });
  const manifest = m.ok ? m.manifest : { name: fallback.name, title: fallback.title || fallback.name, description: fallback.description || "", version: fallback.version || "", author: "", homepage: "", repository: "", keywords: [] };
  const paths = partPaths(raw, kind, inline);
  // The manifests its values, monitors and channels are read from: its entry's where that is the whole manifest, else
  // its plugin.json's, then a strict entry's.
  const written = inline && !inline.strict ? [inline.parts] : [raw, ...(inline ? [inline.parts] : [])];
  const inside = (/** @type {string} */ p) => {
    const at = resolve(root, p);
    return within(resolve(root), at) ? at : null;
  };
  /** A file its manifest names, read; null where it is not there, is no JSON, or climbs out. @param {string} p */
  const fileJson = (p) => {
    const at = inside(p);
    return at !== null && existsSync(at) ? readJson(at) : null;
  };
  // MCP servers, language servers and hooks: a file, files, or an object the manifest or its entry writes.
  const docs = (/** @type {import("../core/plugin-parts.js").PartPaths["hooks"]} */ where) => (Array.isArray(where) ? where : [where]).map((p) => (typeof p === "string" ? fileJson(p) : p)).filter(Boolean);
  const servers = [];
  const skipped = [];
  for (const d of docs(paths.mcp)) {
    const got = mcpServersOf(d);
    for (const s of got.servers) if (!servers.some((x) => x.name === s.name)) servers.push(s);
    skipped.push(...got.skipped);
  }
  const lsp = [];
  const lspSkipped = [];
  for (const d of docs(paths.lsp)) {
    const got = lspServersOf(d);
    for (const s of got.servers) if (!lsp.some((x) => x.name === s.name)) lsp.push(s);
    lspSkipped.push(...got.skipped);
  }
  const hooks = docs(paths.hooks).flatMap((d) => hooksOf(d));
  // Skills: folders holding a SKILL.md (a skills path that is itself one counts); commands and agents: Markdown files.
  // Each once: a folder an entry names inside a default one (`./skills/box`) is found in both.
  /** @type {string[]} */
  const found = [];
  for (const p of paths.skills) {
    const at = inside(p);
    if (!at) continue;
    if (existsSync(join(at, "SKILL.md"))) found.push(relative(root, at).replace(/\\/g, "/"));
    else for (const e of entriesOf(at)) if (e.isDirectory() && existsSync(join(at, e.name, "SKILL.md"))) found.push(relative(root, join(at, e.name)).replace(/\\/g, "/"));
  }
  const skills = [...new Set(found)];
  const mdIn = (/** @type {string[]} */ list) => [
    ...new Set(
      list.flatMap((p) => {
        const at = inside(p);
        if (!at) return [];
        if (/\.md$/i.test(p) && existsSync(at)) return [relative(root, at).replace(/\\/g, "/")];
        return entriesOf(at).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => relative(root, join(at, e.name)).replace(/\\/g, "/"));
      }),
    ),
  ];
  const commands = mdIn(paths.commands);
  const agents = mdIn(paths.agents);
  const has = (/** @type {string} */ p) => existsSync(join(root, p));
  const notHere = notHereWords({
    hooks,
    lsp: lspSkipped,
    outputStyles: paths.outputStyles.some((p) => entriesOf(join(root, p)).length > 0),
    apps: paths.apps.some((p) => has(p)) || has(".app.json"),
    bin: entriesOf(join(root, "bin")).length > 0,
    settings: has("settings.json"),
    skipped,
    monitors: written.some((x) => isObject(x.monitors) || Array.isArray(x.monitors)),
    channels: written.some((x) => Array.isArray(x.channels) || isObject(x.channels)),
  });
  // The values it asks for — a strict entry's after its plugin.json's, a key asked once —, and the names its servers
  // read that nothing of Filament's fills (a token in a header). A language server's are read from what it starts: its
  // settings are the server's own words (`${workspaceFolder}`).
  const asked = written.flatMap((x) => userConfigOf(x)).filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
  const starts = lsp.map((s) => ({ spec: { command: s.spec.command, args: s.spec.args, env: s.spec.env } }));
  return { kind, manifest, parts: { servers, lsp, hooks, skills, commands, agents, asks: [...asked, ...envAsksOf([...servers, ...starts], manifest.name, asked)], notHere } };
}

/**
 * One MCP server a plugin on at a place brings, as the Connectors list shows it: its name in Filament and in its plugin,
 * its plugin, the spec it starts from there — its paths, environment and the place's values filled in, on demand — and
 * the spec as its plugin writes it (`shown`: no value of yours in it); or, where a value it needs is not set there, no
 * spec and `waits`, the values' titles. `only`: its plugin brings connectors and nothing else; `onPlace`: the place
 * whose own list turns it on, where its values are set (added where the Connectors list reads it).
 * @typedef {{ name: string, server: string, plugin: string, title: string, spec: Record<string, any> | null, shown: Record<string, any>,
 *   waits: string[], only: boolean, onPlace?: string | null }} PluginServer
 */

/**
 * What a marketplace's plugin brings, looked at before it is installed (the connectors' picker): its words, its MCP
 * servers as written, the values they need, and how many skills, hooks, commands and agents come with them.
 * @typedef {{ title: string, description: string, servers: { name: string, spec: Record<string, any> }[], asks: import("../core/plugin-parts.js").UserValue[],
 *   skills: number, hooks: number, commands: number, agents: number }} PluginLook
 */

/**
 * The plugins installed, and the values they ask for per place.
 * @param {{ dataDir: string, sources: { entry: (id: string, name: string) => { market: { id: string, name: string, title: string }, entry: import("../core/plugins.js").MarketEntry } },
 *   git?: typeof runGit, now?: () => number, log?: (level: string, msg: string) => void, key?: () => Buffer | null,
 *   mcpLayers?: (where: { project: string | null, chat: string | null }) => { at: string, list: unknown }[], env?: Record<string, string | undefined>,
 *   spaceOf?: (projectId: string) => string | null }} o
 *   `mcpLayers`: your connectors' stored lists at a chat's place, broadest first — a switch, an account or a load
 *   picked there for a plugin's server is the plugin's server's too; `env`: Filament's environment, where a name a
 *   server reads (`envAsksOf`) is found when no value is set; `spaceOf`: the Space of your own that shows a project,
 *   whose values its chats read beneath the project's
 */
export function createPlugins({ dataDir, sources, git = runGit, now = Date.now, log = () => {}, key = () => loadKey(dataDir), mcpLayers = () => [], env = process.env, spaceOf = () => null }) {
  const ownDir = join(dataDir, "plugins");
  const installedDir = join(ownDir, "installed");
  const dataRoot = join(ownDir, "data");
  const tmpRoot = join(ownDir, "tmp");
  const listFile = join(ownDir, "installed.json");
  const valuesFile = join(ownDir, "values.json");
  /** Plugins being installed, checked or updated now, by id. */
  const busy = new Set();
  /** What each version folder holds, read once. @type {Map<string, ReturnType<typeof readPlugin>>} */
  const read = new Map();
  /** Each version folder's agents as cards, read once. @type {Map<string, import("../services/agent-cards.js").AgentCard[]>} */
  const agentsRead = new Map();

  /** The records a read left out, by id: the list is read at every look, and each is said once. @type {Set<string>} */
  const leftOut = new Set();
  /**
   * The installed plugins, as the list holds them: those whose id and version folders are names Filament makes
   * (`asInstalled`), so no code past this read holds one that is a path. One left out is said once in the log.
   * @returns {InstalledPlugin[]}
   */
  const all = () => {
    const doc = readJson(listFile);
    const listed = isObject(doc) && Array.isArray(doc.plugins) ? doc.plugins.filter((p) => isObject(p) && typeof p.id === "string" && typeof p.folder === "string") : [];
    return listed.filter((p) => {
      if (asInstalled(p)) return true;
      const shown = JSON.stringify(p.id.slice(0, 64));
      if (!leftOut.has(shown) && leftOut.size < 1000) {
        leftOut.add(shown);
        log("warn", `plugins: installed.json lists a plugin whose id or version folder is no name Filament makes (its id: ${shown}). It is left out, and nothing is read or removed by its names: install the plugin again to have it.`);
      }
      return false;
    });
  };
  /** @param {InstalledPlugin[]} list */
  const writeAll = (list) => writeJson(listFile, { version: 1, plugins: list });
  /** @param {string} id */
  const one = (id) => {
    const p = all().find((x) => x.id === id);
    if (!p) throw refused(404, "There is no such plugin installed.");
    return p;
  };
  /** A plugin's folder of a version, and its data folder. @param {InstalledPlugin} p @param {string} [folder] */
  const rootOf = (p, folder = p.folder) => join(installedDir, p.id, folder);
  const dataOf = (/** @type {string} */ id) => join(dataRoot, id);
  /** What a version folder holds, with the parts its entry wrote as it was installed. @param {InstalledPlugin} p @param {string} [folder] */
  function partsAt(p, folder = p.folder) {
    const root = rootOf(p, folder);
    const had = read.get(root);
    if (had) return had;
    const got = readPlugin(root, p.kind, { name: p.name, title: p.title, description: p.description, version: p.version, inline: p.inline });
    read.set(root, got);
    return got;
  }

  // A version folder no record names any more — an update's old one Windows held open, a copy a stop cut short — goes.
  for (const p of all())
    for (const e of entriesOf(join(installedDir, p.id)))
      if (e.isDirectory() && e.name !== p.folder && e.name !== p.pending?.folder) removeTree(join(installedDir, p.id, e.name));
  // Never thrown: a folder Windows holds stays until the next start, and Filament starts.
  removeTree(tmpRoot);

  /**
   * A plugin's files fetched into `dir` at its source's commit: a folder copied; a git repository fetched at the commit
   * or branch the marketplace names (its newest where it names none), the folder it names copied. → the commit ("" for
   * a folder). Refused in words for a source Filament does not install from.
   * @param {import("../core/plugins.js").PluginSource} s @param {string} dir
   */
  async function fetchInto(s, dir) {
    if (s.kind === "path") {
      if (!existsSync(s.path)) throw refused(404, `Its folder ${s.path} is not there.`);
      copyTree(s.path, dir);
      return "";
    }
    if (s.kind === "npm") throw refused(422, "It comes from npm, which Filament does not install from yet.");
    if (s.kind === "url") throw refused(422, "It names a marketplace's list, not a plugin.");
    if (s.kind === "unknown") throw refused(422, `Filament cannot fetch it: ${s.said}.`);
    const url = s.kind === "github" ? `https://github.com/${s.repo}.git` : s.url;
    const env = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
    const repo = join(tmpRoot, `git-${randomBytes(6).toString("hex")}`);
    mkdirSync(repo, { recursive: true });
    const run = async (/** @type {string[]} */ args) => git(args, { cwd: repo, env, timeoutMs: FETCH_MS });
    const words = (/** @type {{ code: number, err: string, error: string | null }} */ r) => (r.error || r.err.split(/\r?\n/).filter(Boolean).at(-1) || `git ended with ${r.code}`).slice(0, 240);
    try {
      // Its files as committed: a hook script turned to CRLF by this computer's git settings would not run under bash.
      // What the marketplace names follows `--end-of-options`, so git never reads it as one of its options.
      for (const args of [["init", "-q"], ["config", "core.autocrlf", "false"], ["config", "core.eol", "lf"], ["remote", "add", "--end-of-options", "origin", url]]) {
        const r = await run(args);
        if (r.code !== 0) throw refused(502, `It could not be fetched: ${words(r)}`);
      }
      const want = s.sha || s.ref || "HEAD";
      let r = await run(["fetch", "-q", "--depth", "1", "--end-of-options", "origin", want]);
      // A server that will not hand out one commit by its id: the whole history, then that commit.
      if (r.code !== 0 && s.sha) r = await run(["fetch", "-q", "origin"]);
      if (r.code !== 0) throw refused(502, `It could not be fetched: ${words(r)}`);
      const c = await run(["checkout", "-q", "--end-of-options", s.sha || "FETCH_HEAD"]);
      if (c.code !== 0) throw refused(502, `Its commit ${s.sha || want} could not be checked out: ${words(c)}`);
      const head = await run(["rev-parse", "HEAD"]);
      const from = s.path ? join(repo, ...s.path.split("/")) : repo;
      if (!existsSync(from)) throw refused(404, `Its repository holds no folder ${s.path}.`);
      copyTree(from, dir);
      removeTree(join(dir, ".git"));
      return head.out.trim();
    } finally {
      removeTree(repo);
    }
  }

  /** A fresh folder under tmp. */
  const tmpDir = () => join(tmpRoot, `p-${randomBytes(6).toString("hex")}`);

  /**
   * A plugin as the page shows it: its record's words, where it stands, and what it holds — each MCP server with what it
   * starts, each hook with its event and command, its skills, commands and agents, the values it asks for, what does
   * not run here —, and an update that waits.
   * @param {InstalledPlugin} p
   */
  function view(p) {
    const got = partsAt(p);
    const parts = got.parts;
    return {
      id: p.id,
      name: p.name,
      title: p.title,
      description: p.description,
      version: p.version,
      sha: p.sha ? p.sha.slice(0, 12) : "",
      marketplace: p.marketplace,
      from: p.from,
      origin: p.origin,
      kind: p.kind,
      at: p.at,
      updated: p.updated,
      checked: p.checked,
      root: rootOf(p),
      data: dataOf(p.id),
      parts: {
        servers: parts.servers.map((s) => ({ name: s.name, as: serverName(p.name, s.name), runs: s.spec.url ? String(s.spec.url) : [s.spec.command, ...(s.spec.args || [])].join(" "), remote: !!s.spec.url })),
        lsp: parts.lsp.map((s) => lspRow(p.name, s)),
        hooks: parts.hooks.map((x) => ({ event: x.event, matcher: x.matcher, type: x.type, command: x.command })),
        skills: parts.skills,
        commands: parts.commands,
        agents: parts.agents,
        asks: parts.asks,
        notHere: parts.notHere,
      },
      pending: p.pending ? { version: p.pending.version, sha: p.pending.sha.slice(0, 12), words: p.pending.words, at: p.pending.at } : null,
    };
  }

  // ---- Values per place ------------------------------------------------------------------------------------------------

  /** @returns {Record<string, Record<string, Record<string, string | number | boolean>>>} place → plugin → key → value (a secret sealed) */
  const valuesAll = () => {
    const doc = readJson(valuesFile);
    return isObject(doc) && isObject(doc.places) ? doc.places : {};
  };
  /** A place, checked. @param {unknown} place */
  const placeOf = (place) => {
    const s = typeof place === "string" ? place : "";
    if (!PLACE.test(s)) throw refused(400, "say the place: all, project:<id> or chat:<id>");
    return s;
  };
  /** The key secrets are sealed with, or its refusal. */
  const sealKey = () => {
    const k = key();
    if (!k) throw refused(503, "Filament's secret key could not be read: a secret value cannot be kept.");
    return k;
  };
  /** A kept value opened. @param {unknown} v */
  const opened = (v) => (typeof v === "string" && v.startsWith("enc:") ? open(v, sealKey()) : v);

  /**
   * The places a chat's values are read from, broadest first: your defaults, the Space of your own that shows its
   * project (whose plugins reach the projects it shows), the project, the chat.
   * @param {string | null} project @param {string | null} chat
   */
  const placesOf = (project, chat) => {
    const at = project && project !== "none" ? project : null;
    const space = at ? spaceOf(at) : null;
    return ["all", ...(space && space !== at ? [`project:${space}`] : []), ...(at ? [`project:${at}`] : []), ...(chat ? [`chat:${chat}`] : [])].filter((x) => PLACE.test(x));
  };

  /**
   * A plugin's parts with the values it needs at the places: the folders and values its parts are filled with, or the
   * titles of the required values none of the places sets.
   * @param {InstalledPlugin} p @param {import("../core/plugin-parts.js").PluginParts} parts @param {readonly string[]} places @param {string} cwd
   */
  function varsOf(p, parts, places, cwd) {
    const values = api.valuesFor(p.id, places);
    // A name its servers read is there where Filament's own environment holds it, as Claude Code's does.
    const missing = parts.asks.filter((a) => a.required && values[a.key] == null && a.default == null && !(a.env && env[a.key])).map((a) => a.title);
    return { vars: { root: rootOf(p), data: dataOf(p.id), project: cwd, values, asks: parts.asks, env }, missing };
  }

  /**
   * A plugin's MCP servers as Filament runs them: named `<plugin>` or `<plugin>-<server>`, each spec filled — its paths,
   * its environment, the values — and on demand (PL-D4).
   * @param {InstalledPlugin} p @param {import("../core/plugin-parts.js").PluginParts} parts @param {import("../core/plugin-parts.js").FillVars} vars
   */
  const specsOf = (p, parts, vars) =>
    parts.servers.map((s) => {
      const name = serverName(p.name, s.name);
      const spec = fillSpec(s.spec, vars);
      return { name, server: s.name, spec: { ...spec, name, ...(spec.url ? {} : { env: { ...pluginEnv(vars), ...(spec.env || {}) } }), load: "on-demand" } };
    });

  const api = {
    /** Every plugin installed, as the page shows it. */
    list() {
      return all().map(view);
    },

    /** One plugin installed, as the page shows it. @param {string} id */
    get(id) {
      return view(one(id));
    },

    /**
     * The agents the plugins installed bring (B3), as agent cards, each `<plugin>:<name>` — a second plugin of the same
     * name has its marketplace in its tag. Read once per version; a file that cannot be read is left out.
     * @returns {import("../services/agent-cards.js").AgentCard[]}
     */
    agents() {
      /** @type {import("../services/agent-cards.js").AgentCard[]} */
      const out = [];
      const tags = new Set();
      for (const p of all()) {
        const root = rootOf(p);
        let cards = agentsRead.get(root);
        if (!cards) {
          cards = [];
          for (const f of partsAt(p).parts.agents)
            try {
              cards.push(pluginAgentCard(p, f, readFileSync(join(root, ...f.split("/")), "utf8")));
            } catch (e) {
              log("warn", `plugins: ${p.id}'s agent ${f} could not be read (${said(e).slice(0, 120)})`);
            }
          agentsRead.set(root, cards);
        }
        for (const c of cards) {
          const tag = tags.has(c.tag) ? `${tagPart(`${p.name}-${p.marketplace}`)}:${c.tag.split(":")[1]}` : c.tag;
          if (tags.has(tag)) continue;
          tags.add(tag);
          out.push({ ...c, tag });
        }
      }
      return out;
    },

    /** The record of one, for B3's parts: its folder of the version in use, its data folder, what it holds. @param {string} id */
    use(id) {
      const p = all().find((x) => x.id === id);
      if (!p) return null;
      return { plugin: p, root: rootOf(p), data: dataOf(p.id), ...partsAt(p) };
    },

    /**
     * A plugin a source lists, read before it is installed, for the install sheet (the Designer's §6 E): fetched into a
     * folder that goes once read, nothing kept and nothing run — its name and words, version, where it comes from, what
     * it holds, what does not run here, and what it adds to every request where it is on. Refused as Install is.
     * @param {{ from: string, name: string }} o
     */
    async preview({ from, name }) {
      const { market, entry } = sources.entry(String(from || ""), String(name || ""));
      const id = `${entry.name}@${market.name}`;
      const tmp = tmpDir();
      try {
        const sha = await fetchInto(entry.source, tmp);
        const got = readPlugin(tmp, market.id.startsWith("codex/") ? "codex" : "claude", entry);
        const p = got.parts;
        const description = got.manifest.description || entry.description;
        // Its line among the prompt's plugins, where it brings skills or commands — what they hold loads on demand.
        const line = p.skills.length || p.commands.length ? pluginLine(entry.name, description, { skills: p.skills.length, commands: p.commands.length, servers: p.servers.map((s) => serverName(entry.name, s.name)) }) : "";
        return {
          id,
          name: entry.name,
          title: got.manifest.title !== got.manifest.name ? got.manifest.title : entry.title || got.manifest.title,
          description,
          version: got.manifest.version || entry.version,
          sha: sha ? sha.slice(0, 12) : "",
          kind: got.kind,
          from: market.id,
          market: market.title,
          origin: `${market.title} · ${sourceWords(entry.source)}`,
          installed: all().some((x) => x.id === id),
          parts: {
            servers: p.servers.map((s) => ({ name: s.name, as: serverName(entry.name, s.name), runs: s.spec.url ? String(s.spec.url) : [s.spec.command, ...(s.spec.args || [])].join(" "), remote: !!s.spec.url })),
            lsp: p.lsp.map((s) => lspRow(entry.name, s)),
            hooks: p.hooks.map((x) => ({ event: x.event, matcher: x.matcher, type: x.type, command: x.command })),
            skills: p.skills,
            commands: p.commands,
            agents: p.agents,
            asks: p.asks,
            notHere: p.notHere,
          },
          // Its line among the plugins, and each server's line among the MCP servers.
          weight: (line ? estimateTokens(line) : 0) + p.servers.length * WEIGHT_PER_SERVER,
        };
      } finally {
        removeTree(tmp);
      }
    },

    /**
     * What a marketplace's plugin brings, looked at before it is installed, for the connectors' picker: a folder read
     * where it stands; a repository's files listed at its commit with only its plugin's JSON files fetched
     * (`--filter=blob:none`), its Markdown files standing empty — enough to count its skills, commands and agents —, the
     * folder let go. Nothing kept, nothing run. Refused in words for a source Filament does not fetch.
     * @param {import("../core/plugins.js").MarketEntry} entry @param {"claude" | "codex"} kind
     * @returns {Promise<PluginLook>}
     */
    async look(entry, kind) {
      const s = entry.source;
      const lookAt = (/** @type {string} */ root) => {
        const got = readPlugin(root, kind, entry);
        const p = got.parts;
        return {
          title: got.manifest.title !== got.manifest.name ? got.manifest.title : entry.title || got.manifest.title,
          description: entry.description || got.manifest.description,
          servers: p.servers.map((x) => ({ name: x.name, spec: x.spec })),
          asks: p.asks,
          skills: p.skills.length,
          hooks: p.hooks.length,
          commands: p.commands.length,
          agents: p.agents.length,
        };
      };
      if (s.kind === "path") {
        if (!existsSync(s.path)) throw refused(404, `Its folder ${s.path} is not there.`);
        return lookAt(s.path);
      }
      if (s.kind !== "github" && s.kind !== "git") throw refused(422, s.kind === "npm" ? "It comes from npm, which Filament does not install from yet." : s.kind === "unknown" ? `Filament cannot fetch it: ${s.said}.` : "It names a marketplace's list, not a plugin.");
      const url = s.kind === "github" ? `https://github.com/${s.repo}.git` : s.url;
      const env = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
      const repo = join(tmpRoot, `look-${randomBytes(6).toString("hex")}`);
      mkdirSync(repo, { recursive: true });
      const run = async (/** @type {string[]} */ args) => git(args, { cwd: repo, env, timeoutMs: LOOK_MS });
      const words = (/** @type {{ code: number, err: string, error: string | null }} */ r) => (r.error || r.err.split(/\r?\n/).filter(Boolean).at(-1) || `git ended with ${r.code}`).slice(0, 240);
      const must = async (/** @type {string[]} */ args, /** @type {string} */ what) => {
        const r = await run(args);
        if (r.code !== 0) throw refused(502, `${what}: ${words(r)}`);
        return r;
      };
      try {
        // A partial clone: the commit's tree now, each file's content only when it is checked out. What the marketplace
        // names follows `--end-of-options`, as at Install.
        for (const args of [["init", "-q"], ["config", "core.autocrlf", "false"], ["config", "core.repositoryformatversion", "1"], ["config", "extensions.partialClone", "origin"],
          ["remote", "add", "--end-of-options", "origin", url], ["config", "remote.origin.promisor", "true"], ["config", "remote.origin.partialclonefilter", "blob:none"]])
          await must(args, "It could not be looked at");
        await must(["fetch", "-q", "--depth", "1", "--filter=blob:none", "--end-of-options", "origin", s.sha || s.ref || "HEAD"], "It could not be fetched");
        const prefix = s.path ? `${s.path.replace(/\/+$/, "")}/` : "";
        // Each file with its blob's id: `<mode> blob <id>\t<path>`.
        /** @type {Map<string, string>} */
        const blobs = new Map();
        for (const line of (await must(["ls-tree", "-r", "-z", "FETCH_HEAD", ...(prefix ? ["--", prefix] : [])], "Its files could not be listed")).out.split("\0")) {
          const m = /^\d+ blob ([0-9a-f]{40,64})\t(.+)$/.exec(line);
          if (m && m[2].startsWith(prefix)) blobs.set(m[2].slice(prefix.length), m[1]);
          if (blobs.size >= LOOK_FILES) break;
        }
        const listed = [...blobs.keys()];
        if (!listed.length) throw refused(404, `Its repository holds no folder ${s.path}.`);
        const out = new Set();
        // The files' blobs fetched by their ids in one go — a checkout in a shallow partial clone does not fetch them
        // itself —, then checked out.
        const fetchFiles = async (/** @type {string[]} */ files) => {
          const want = [...new Set(files)].filter((f) => blobs.has(f) && !out.has(f)).slice(0, Math.max(0, LOOK_JSON - out.size));
          if (!want.length) return;
          await must(["fetch", "-q", "--no-tags", "--no-write-fetch-head", "--filter=blob:none", "origin", ...want.map((f) => /** @type {string} */ (blobs.get(f)))], "Its files could not be fetched");
          await must(["checkout", "-q", "FETCH_HEAD", "--", ...want.map((f) => prefix + f)], "Its files could not be read");
          for (const f of want) out.add(f);
        };
        // Its manifests, its top folder's JSON and its hooks'; then the files its manifest names for servers and hooks.
        await fetchFiles(listed.filter((f) => /^[^/]+\.json$/i.test(f) || /^(\.claude-plugin|\.codex-plugin|hooks)\/[^/]+\.json$/i.test(f)));
        const root = prefix ? join(repo, ...prefix.split("/").filter(Boolean)) : repo;
        const raw = readJson(join(root, ".claude-plugin", "plugin.json")) || readJson(join(root, ".codex-plugin", "plugin.json")) || {};
        const paths = partPaths(raw, existsSync(join(root, ".claude-plugin", "plugin.json")) ? "claude" : existsSync(join(root, ".codex-plugin", "plugin.json")) ? "codex" : kind, entry.inline || null);
        const named = [paths.mcp, paths.hooks].flatMap((p) => (Array.isArray(p) ? p.filter((x) => typeof x === "string") : [])).map((p) => p.replace(/\\/g, "/").replace(/^(\.\/)+/, ""));
        await fetchFiles(named);
        // A name of the tree is the repository's words: one that climbs out of the folder is no file of it, and one the
        // folder has already is kept as it is — a placeholder is made, never written over (the bug hunt of 10-30, SVC-8).
        for (const f of listed) {
          if (!/\.md$/i.test(f) || out.has(f)) continue;
          const at = join(root, ...f.split("/"));
          if (f.split("/").some((part) => part === "" || part === "." || part === "..") || !within(root, at)) continue;
          try {
            mkdirSync(dirname(at), { recursive: true });
            writeFileSync(at, "", { flag: "wx" });
          } catch {
            // A name this computer cannot hold: one file fewer counted.
          }
        }
        return lookAt(root);
      } finally {
        // What was read stands though its folder stays (removeTree never throws): the next start removes it.
        removeTree(repo);
      }
    },

    /**
     * The values a plugin still needs at a place before its servers start there, for the connectors' setup step: each
     * required one that neither the place nor a broader one sets, nor Filament's environment holds.
     * @param {string} id @param {unknown} place @param {string | null} [project]  a chat's project, read beneath it
     * @returns {import("../core/plugin-parts.js").UserValue[]}
     */
    needsAt(id, place, project = null) {
      const p = one(id);
      const at = placeOf(place);
      const m = /^project:(.+)$/.exec(at);
      const places = at === "all" ? ["all"] : m ? placesOf(m[1], null) : placesOf(project, at.slice("chat:".length));
      const values = api.valuesFor(p.id, places);
      return partsAt(p).parts.asks.filter((a) => a.required && values[a.key] == null && a.default == null && !(a.env && env[a.key]));
    },

    /**
     * A plugin a source lists, installed: fetched at its commit into a folder of its own, read, kept — with the parts
     * its marketplace's entry writes itself, as the entry stands now. Nothing runs. Refused in words: installed already,
     * a source Filament does not install from, a fetch that fails, an entry and a plugin.json in conflict.
     * @param {{ from: string, name: string }} o  `from`: the source's id on the Plugins page — a marketplace's, or `directory`
     */
    async install({ from, name }) {
      const { market, entry } = sources.entry(String(from || ""), String(name || ""));
      // Its id names its folders under `installed/` and `data/`: a source leaves out an entry with no name both apps
      // take as it reads its list, and whatever one hands over, none is installed under a name that is not one.
      if (!namedSo(entry.name) || !namedSo(market.name)) throw refused(400, `${String(entry.title || "It").slice(0, 80)} is listed under a name no app takes for a plugin (letters, digits, . _ and -, a letter or digit first): Filament installs none under it.`);
      const id = `${entry.name}@${market.name}`;
      if (all().some((p) => p.id === id)) throw refused(409, `${entry.title} is installed already: Check for updates brings a newer version.`);
      if (busy.has(id)) throw refused(409, `${entry.title} is being installed now.`);
      busy.add(id);
      const tmp = tmpDir();
      try {
        const sha = await fetchInto(entry.source, tmp);
        const got = readPlugin(tmp, market.id.startsWith("codex/") ? "codex" : "claude", entry);
        const version = got.manifest.version || entry.version;
        const folder = versionFolder(sha ? `${version || "v"}-${sha.slice(0, 12)}` : version || `local-${treeKey(tmp).slice(0, 12)}`, entry.inline);
        const at = now();
        mkdirSync(join(installedDir, id), { recursive: true });
        removeTree(join(installedDir, id, folder));
        renameSync(tmp, join(installedDir, id, folder));
        mkdirSync(dataOf(id), { recursive: true });
        /** @type {InstalledPlugin} */
        const rec = {
          id,
          name: entry.name,
          marketplace: market.name,
          from: market.id,
          source: entry.source.kind === "github" || entry.source.kind === "git" ? { ...entry.source, sha: sha || entry.source.sha } : entry.source,
          origin: `${market.title} · ${sourceWords(entry.source)}`,
          kind: got.kind,
          title: got.manifest.title !== got.manifest.name ? got.manifest.title : entry.title || got.manifest.title,
          description: got.manifest.description || entry.description,
          version,
          sha,
          folder,
          inline: entry.inline || null,
          at,
          updated: at,
          checked: at,
          pending: null,
        };
        writeAll([...all().filter((p) => p.id !== id), rec]);
        log("info", `plugins: installed ${id}${version ? ` ${version}` : ""}${sha ? ` at ${sha.slice(0, 7)}` : ""}`);
        return view(rec);
      } finally {
        removeTree(tmp);
        busy.delete(id);
      }
    },

    /**
     * Its source looked at for a newer version: the marketplace's entry as it lists it now (a marketplace added is
     * brought up to date by its own Refresh), fetched afresh — its files, and the parts the entry writes itself, each
     * newer when it moved. Nothing newer: said. Newer, and only its words changed: it goes through. Newer, and what runs
     * changed: it waits for Update, with what changed in words.
     * @param {string} id
     * @returns {Promise<{ newer: boolean, applied: boolean, words: string, plugin: ReturnType<typeof view> }>}
     */
    async check(id) {
      const p = one(id);
      if (busy.has(id)) throw refused(409, "It is being checked or updated now.");
      busy.add(id);
      const tmp = tmpDir();
      try {
        const { entry } = sources.entry(p.from, p.name);
        // The newest the source has: a git source at its branch's head unless the marketplace pins a commit.
        const src = entry.source.kind === "github" || entry.source.kind === "git" ? { ...entry.source, sha: entry.source.sha || "" } : entry.source;
        const sha = await fetchInto(src, tmp);
        const at = now();
        const same = (sha ? sha === p.sha : treeKey(tmp) === treeKey(rootOf(p))) && inlineKey(entry.inline) === inlineKey(p.inline);
        if (same) {
          writeAll(all().map((x) => (x.id === id ? { ...x, checked: at } : x)));
          return { newer: false, applied: false, words: "", plugin: view({ ...p, checked: at }) };
        }
        const was = partsAt(p).parts;
        const got = readPlugin(tmp, p.kind, entry);
        const version = got.manifest.version || entry.version;
        const folder = versionFolder(sha ? `${version || "v"}-${sha.slice(0, 12)}` : `${version || "local"}-${treeKey(tmp).slice(0, 12)}`, entry.inline);
        if (folder === p.folder) return { newer: false, applied: false, words: "", plugin: view(p) };
        removeTree(join(installedDir, id, folder));
        renameSync(tmp, join(installedDir, id, folder));
        const runs = runKeyOf(was) !== runKeyOf(got.parts);
        if (runs) {
          const words = runChangeWords(was, got.parts) || "what it runs changed";
          const pending = { folder, version, sha, words, at, inline: entry.inline || null };
          // An update waiting before this one is let go: the newest waits.
          if (p.pending && p.pending.folder !== folder) removeTree(join(installedDir, id, p.pending.folder));
          const rec = { ...p, pending, checked: at };
          writeAll(all().map((x) => (x.id === id ? rec : x)));
          log("info", `plugins: ${id} has a newer version that changes what runs (${words}); it waits for Update`);
          return { newer: true, applied: false, words, plugin: view(rec) };
        }
        const rec = { ...p, folder, version, sha, source: sha ? /** @type {any} */ ({ ...p.source, sha }) : p.source, inline: entry.inline || null, description: got.manifest.description || p.description, updated: at, checked: at, pending: null };
        writeAll(all().map((x) => (x.id === id ? rec : x)));
        retire(p, p.folder);
        log("info", `plugins: ${id} updated to ${version || sha.slice(0, 7) || "its newest"}: only its words changed`);
        return { newer: true, applied: true, words: "", plugin: view(rec) };
      } finally {
        removeTree(tmp);
        busy.delete(id);
      }
    },

    /** The update that waits, taken: its version in use from now on; the one before goes. @param {string} id */
    update(id) {
      const p = one(id);
      if (!p.pending) throw refused(409, "No update waits: Check for updates looks for one.");
      const at = now();
      const rec = { ...p, folder: p.pending.folder, version: p.pending.version, sha: p.pending.sha, source: p.pending.sha ? /** @type {any} */ ({ ...p.source, sha: p.pending.sha }) : p.source, inline: p.pending.inline || null, updated: at, pending: null };
      rec.description = partsAt(rec).manifest.description || p.description;
      writeAll(all().map((x) => (x.id === id ? rec : x)));
      retire(p, p.folder);
      log("info", `plugins: ${id} updated to ${rec.version || rec.sha.slice(0, 7)}, as you pressed`);
      return view(rec);
    },

    /**
     * Uninstalled: its copy, its record and the values kept for it go; its data folder only with `data` — the sheet
     * asks first. → what went.
     * @param {string} id @param {{ data?: boolean }} [o]
     */
    uninstall(id, { data = false } = {}) {
      const p = one(id);
      if (busy.has(id)) throw refused(409, "It is being installed, checked or updated now.");
      writeAll(all().filter((x) => x.id !== id));
      const places = valuesAll();
      for (const v of Object.values(places)) delete v[id];
      writeJson(valuesFile, { version: 1, places: Object.fromEntries(Object.entries(places).filter(([, v]) => Object.keys(v).length)) });
      for (const dir of [join(installedDir, id), ...(data ? [dataOf(id)] : [])])
        if (!removeTree(dir)) log("warn", `plugins: ${dir} was not removed (a program holds a file in it); remove it by hand once it lets go`);
      log("info", `plugins: uninstalled ${id}${data ? ", its data folder too" : ""}`);
      return { id, title: p.title, data: data ? dataOf(id) : null, kept: data ? null : dataOf(id) };
    },

    /**
     * The values a plugin asks for at a place, as the page shows them: what it asks, and what is kept there — a secret
     * as the placeholder.
     * @param {string} id @param {unknown} place
     */
    valuesAt(id, place) {
      const p = one(id);
      const at = placeOf(place);
      const asks = partsAt(p).parts.asks;
      const kept = valuesAll()[at]?.[id] || {};
      const secret = new Set(asks.filter((a) => a.sensitive).map((a) => a.key));
      return { id, place: at, asks, values: Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, secret.has(k) ? SECRET_MARK : v])) };
    },

    /**
     * The values a plugin asks for, kept for a place: each checked against its ask, a secret sealed — the placeholder
     * written back keeps it —; none given clears the place's. → the place's values as the page shows them.
     * @param {string} id @param {unknown} place @param {unknown} given
     */
    setValues(id, place, given) {
      const p = one(id);
      const at = placeOf(place);
      const asks = partsAt(p).parts.asks;
      const places = valuesAll();
      const kept = places[at]?.[id] || {};
      const had = Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, opened(v)]));
      const got = checkValues(asks, given, { had, keep: SECRET_MARK, need: false });
      if (!got.ok) throw refused(400, got.error);
      const secret = new Set(asks.filter((a) => a.sensitive).map((a) => a.key));
      const stored = Object.fromEntries(Object.entries(got.values).map(([k, v]) => [k, secret.has(k) && typeof v === "string" ? seal(v, sealKey()) : v]));
      const next = { ...places, [at]: { ...(places[at] || {}), [id]: stored } };
      if (!Object.keys(stored).length) delete next[at][id];
      writeJson(valuesFile, { version: 1, places: Object.fromEntries(Object.entries(next).filter(([, v]) => Object.keys(v).length)) });
      return api.valuesAt(id, at);
    },

    /**
     * A plugin's values as a chat's parts are filled with (B3): each place's, the narrower over the broader — your
     * defaults, then the project's, then the chat's —, secrets opened. Never sent to the page.
     * @param {string} id @param {readonly string[]} places  broadest first
     */
    valuesFor(id, places) {
      const kept = valuesAll();
      /** @type {Record<string, string | number | boolean>} */
      const out = {};
      for (const at of places) for (const [k, v] of Object.entries(kept[at]?.[id] || {})) out[k] = /** @type {any} */ (opened(v));
      return out;
    },

    /**
     * The MCP servers the plugins on at a place bring, as the Connectors list shows them (the Designer's of 10-26): each
     * one's, filled for the place, or waiting for the values it needs there. A plugin on there that is not installed,
     * or cannot be read, brings none. Nothing starts here.
     * @param {readonly { id: string }[]} on  the plugins on at the place
     * @param {{ project?: string | null, chat?: string | null, cwd?: string }} [where]
     * @returns {PluginServer[]}
     */
    serversAt(on, { project = null, chat = null, cwd = "" } = {}) {
      const installed = all();
      const places = placesOf(project, chat);
      /** @type {PluginServer[]} */
      const out = [];
      for (const { id } of on) {
        const p = installed.find((x) => x.id === id);
        if (!p) continue;
        try {
          const { parts } = partsAt(p);
          if (!parts.servers.length) continue;
          const { vars, missing } = varsOf(p, parts, places, cwd);
          const specs = missing.length ? [] : specsOf(p, parts, vars);
          // A plugin that brings connectors and nothing else is a connector's: its row may Remove it from the place.
          const only = !parts.lsp.length && !parts.hooks.length && !parts.skills.length && !parts.commands.length && !parts.agents.length;
          for (const s of parts.servers) {
            const name = serverName(p.name, s.name);
            out.push({ name, server: s.name, plugin: id, title: p.title, spec: specs.find((x) => x.name === name)?.spec || null, shown: { ...s.spec, name }, waits: missing, only });
          }
        } catch (e) {
          log("warn", `plugins: ${id}'s connectors could not be read: ${said(e).slice(0, 160)}`);
        }
      }
      return out;
    },

    /**
     * A chat's settings with what its plugins on bring (B3), the document given left as it was: each one's MCP servers
     * join `plugins.mcp` — on demand (PL-D4), its paths and its values for the place filled in, named `<plugin>` or
     * `<plugin>-<server>`, one of yours of that name keeping it —, and its skills and commands `skills.plugins`, each
     * `<plugin>:<name>` (PL-D5). Its hooks, where they are switched on here (PL-D3), join `hooks` after yours: each
     * command hook on an event Filament has a moment for, in Claude's dialect (app/agent/hooks.js), its paths and values
     * filled in — with forward slashes on Windows, for the bash they run in — and its plugin's environment. Its language
     * servers join `lsp.plugins`, filled as its MCP servers are and named as they are (adapters/lsp/servers.js picks
     * among them and yours, `lsp.servers`). What is
     * left out — a plugin on that is not installed, a server or hook a value it needs is missing for — is said in
     * `plugins.notes`, for the turn's record. A switch, an account or a load the place picked for a plugin's server in
     * your Connectors is its own (`mcpLayers`): one switched off there is left out. Nothing starts here.
     * @param {any} doc  the effective settings document
     * @param {{ project?: string | null, chat?: string | null, cwd?: string }} [where]  the chat's project and folder
     */
    into(doc, { project = null, chat = null, cwd = "" } = {}) {
      const on = Array.isArray(doc?.plugins?.on) ? doc.plugins.on : [];
      if (!on.length) return doc;
      const installed = all();
      const own = Array.isArray(doc.plugins.mcp) ? doc.plugins.mcp : [];
      const names = new Set(own.map((/** @type {any} */ m) => m?.name));
      const places = placesOf(project, chat);
      /** The place's picks, read once a plugin brings a server. @type {{ at: string, list: unknown }[] | null} */
      let picks = null;
      /** @type {Record<string, any>[]} */
      const servers = [];
      /** @type {Record<string, any>[]} */
      const hooks = [];
      /** @type {Record<string, any>[]} */
      const lsp = [];
      /** @type {import("./agent/skills.js").PluginSkill[]} */
      const skills = [];
      /** The plugins on that bring skills or commands, each a line in the prompt. @type {import("./agent/skills.js").PluginOn[]} */
      const pluginsOn = [];
      /** @type {string[]} */
      const notes = [];
      const slashed = (/** @type {string} */ s) => (process.platform === "win32" ? s.replace(/\\/g, "/") : s);
      /** What each server joined reaches, so a plugin's that reaches the same is left out. @type {Map<string, string>} */
      const reached = new Map();
      for (const m of own) {
        const key = reachOf(m);
        if (key && !reached.has(key)) reached.set(key, String(m.name));
      }
      for (const { id, hooks: hooksOn } of on) {
        const p = installed.find((x) => x.id === id);
        if (!p) {
          notes.push(`the plugin ${id} is on here but not installed: it brings nothing`);
          continue;
        }
        try {
          const { parts } = partsAt(p);
          const root = rootOf(p);
          for (const s of parts.skills) skills.push({ plugin: p.name, kind: "skill", path: join(root, ...s.split("/"), "SKILL.md") });
          for (const c of parts.commands) skills.push({ plugin: p.name, kind: "command", path: join(root, ...c.split("/")) });
          /** @type {import("./agent/skills.js").PluginOn} */
          const about = { name: p.name, title: p.title, description: p.description, servers: [] };
          if (parts.skills.length || parts.commands.length) pluginsOn.push(about);
          const runs = hooksOn === true ? parts.hooks.filter((x) => x.type === "command" && Object.hasOwn(HOOK_MOMENTS, x.event) && x.command.trim()) : [];
          if (!parts.servers.length && !parts.lsp.length && !runs.length) continue;
          const { vars, missing } = varsOf(p, parts, places, cwd);
          if (missing.length) {
            const kinds = [parts.servers.length ? "connectors" : "", parts.lsp.length ? "language servers" : "", runs.length ? "hooks" : ""].filter(Boolean);
            const what = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}` : kinds[0];
            notes.push(`${p.title}'s ${what} wait for ${missing.join(", ")}: set ${missing.length === 1 ? "it" : "them"} on its sheet in Library › Plugins & Connectors`);
            continue;
          }
          /** Its servers' names here → Claude's, `plugin_<plugin>_<server>`, which its hooks' matchers may name. @type {Record<string, string>} */
          const aliases = {};
          const specs = specsOf(p, parts, vars);
          if (specs.length && !picks)
            try {
              picks = mcpLayers({ project: project && project !== "none" ? project : null, chat: chat || null });
            } catch (e) {
              picks = [];
              notes.push(`the connectors' picks for this place could not be read: ${said(e).slice(0, 120)}`);
            }
          // The place's picks over its servers, as your own servers take them: a plugin's is the broadest layer.
          const merged = new Map(mergeServers([{ at: /** @type {any} */ ("plugin"), list: specs.map((s) => s.spec) }, ...(/** @type {any[]} */ (picks || []))]).map((m) => [m.name, m]));
          for (const s of specs) {
            const m = merged.get(s.name);
            if (names.has(s.name) || !m || /** @type {string} */ (m.from) !== "plugin") {
              notes.push(`${p.title}'s connector ${s.server} is left out: one of yours is named ${s.name}`);
              continue;
            }
            if (!m.on) {
              notes.push(`${p.title}'s connector ${s.server} is switched off here (Library › Plugins & Connectors)`);
              continue;
            }
            // One that reaches what another here reaches already — the address and headers, or the program and its
            // arguments and environment, and the account — would give the agent every tool twice: the first keeps it.
            const key = reachOf(m.spec);
            const same = key ? reached.get(key) : undefined;
            if (same) {
              notes.push(`${p.title}'s connector ${s.server} is left out: ${same} here reaches the same`);
              // Its hooks' matchers then name the one kept.
              aliases[same] = `plugin_${p.name}_${s.server}`;
              about.servers.push(same);
              continue;
            }
            if (key) reached.set(key, s.name);
            names.add(s.name);
            servers.push({ ...m.spec, plugin: id });
            aliases[s.name] = `plugin_${p.name}_${s.server}`;
            about.servers.push(s.name);
          }
          for (const s of parts.lsp) {
            const name = serverName(p.name, s.name);
            const same = lsp.find((x) => x.name === name);
            if (same) {
              notes.push(`${p.title}'s language server ${s.name} is left out: ${same.plugin}'s is named ${name} too`);
              continue;
            }
            const spec = fillSpec(s.spec, vars);
            lsp.push({ ...spec, name, env: { ...pluginEnv(vars), ...(spec.env || {}) }, plugin: id });
          }
          const inBash = { ...vars, root: slashed(root), data: slashed(dataOf(id)), project: cwd ? slashed(cwd) : cwd };
          for (const x of runs)
            hooks.push({
              on: /** @type {Record<string, string>} */ (HOOK_MOMENTS)[x.event],
              event: x.event,
              matcher: x.matcher,
              command: fillPaths(x.command, inBash),
              ...(x.timeout && x.timeout > 0 ? { timeoutMs: Math.round(x.timeout * 1000) } : {}),
              env: pluginEnv(vars),
              plugin: id,
              dialect: "claude",
              ...(Object.keys(aliases).length ? { aliases } : {}),
            });
        } catch (e) {
          notes.push(`the plugin ${id} could not be read: ${said(e).slice(0, 160)}`);
        }
      }
      return {
        ...doc,
        plugins: { ...doc.plugins, mcp: [...own, ...servers], notes },
        skills: { ...(doc.skills || {}), plugins: skills, pluginsOn },
        ...(hooks.length ? { hooks: [...(Array.isArray(doc.hooks) ? doc.hooks : []), ...hooks] } : {}),
        ...(lsp.length ? { lsp: { ...(doc.lsp || {}), plugins: lsp } } : {}),
      };
    },
  };

  /** An old version folder removed; one Windows holds open goes at the next start. @param {InstalledPlugin} p @param {string} folder */
  function retire(p, folder) {
    read.delete(rootOf(p, folder));
    agentsRead.delete(rootOf(p, folder));
    if (!removeTree(rootOf(p, folder))) log("warn", `plugins: ${p.id}'s old version was not removed yet (a program holds a file in it); it goes at the next start`);
  }

  return api;
}
