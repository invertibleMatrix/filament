// @ts-check
// Which language server serves a file (the owner's LSP of 11-04: installed ones, nothing bundled): the ones Filament
// knows, by their programs installed here; the ones a plugin on here brings (`lsp.plugins`, app/plugins.js's `into`);
// and yours (`lsp.servers`, merged across the layers by services/session-settings.js). Yours come first, then the
// plugins', then Filament's own; a switch of yours turns the ones of its name on or off. Whether a program is
// installed is looked up as its start finds it (client.js `lspFound`).
import { dirname, extname, resolve } from "node:path";
import { languageOf, lspFound } from "./client.js";

/** How long a program found is taken as there, for one PATH; one not found is looked for again at each ask. */
export const FOUND_TTL_MS = 30_000;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

const SCRIPTS = { ".ts": "typescript", ".tsx": "typescriptreact", ".mts": "typescript", ".cts": "typescript", ".js": "javascript", ".jsx": "javascriptreact", ".mjs": "javascript", ".cjs": "javascript" };
const PYTHON = { ".py": "python", ".pyi": "python" };
const C_FAMILY = { ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp", ".hxx": "cpp" };

/**
 * rust-analyzer as no code of the project runs through it (the owner's of 11-04: the lsp tool runs in every mode,
 * read-only too): no build scripts, no procedural macros, no `cargo check` on save — told at its start and asked for
 * again as its configuration. Where macros make the code, it knows less of it.
 */
const RUST_TAMED = Object.freeze({ cargo: { buildScripts: { enable: false } }, procMacro: { enable: false }, checkOnSave: false });

/**
 * A language server Filament knows: its name (a switch's), its program and arguments, the files it serves, how it is
 * installed, said where none is, and what it is told at its start and asked for as its configuration, where anything.
 * @typedef {{ name: string, command: string, args?: readonly string[], languages: Readonly<Record<string, string>>, install: string,
 *   initializationOptions?: any, settings?: Readonly<Record<string, any>> }} KnownServer
 */

/** The servers Filament knows, in the order a file picks among them: pyright before pylsp. */
export const KNOWN_SERVERS = Object.freeze(/** @type {KnownServer[]} */ ([
  { name: "typescript", command: "typescript-language-server", args: ["--stdio"], languages: SCRIPTS, install: "npm install -g typescript-language-server typescript" },
  { name: "pyright", command: "pyright-langserver", args: ["--stdio"], languages: PYTHON, install: "npm install -g pyright" },
  { name: "pylsp", command: "pylsp", languages: PYTHON, install: "pip install python-lsp-server" },
  { name: "gopls", command: "gopls", languages: { ".go": "go" }, install: "go install golang.org/x/tools/gopls@latest" },
  { name: "rust-analyzer", command: "rust-analyzer", languages: { ".rs": "rust" }, install: "rustup component add rust-analyzer", initializationOptions: RUST_TAMED, settings: { "rust-analyzer": RUST_TAMED } },
  { name: "clangd", command: "clangd", languages: C_FAMILY, install: "clangd from LLVM, or your package manager's" },
]));

/**
 * One language server of a chat: where it comes from, the spec it starts from, whether it is on here, and how it is
 * installed where Filament knows it.
 * @typedef {{ name: string, from: "yours" | "plugin" | "filament", plugin?: string, spec: import("./client.js").LspSpec, on: boolean, install?: string }} LspEntry
 */

/** The files a map serves, each extension as written. @param {unknown} map @returns {Record<string, string>} */
const languagesOf = (map) => Object.fromEntries(Object.entries(isObject(map) ? map : {}).filter(([, id]) => typeof id === "string" && id.trim()).map(([ext, id]) => [ext, String(id).trim()]));

/**
 * Every language server of a chat, in the order a file picks among them: yours that start a program (`lsp.servers`,
 * merged), the plugins' on here (`lsp.plugins`), then Filament's own. A name yours start a program by is yours alone; a
 * switch of yours turns the plugins' and Filament's of its name on or off.
 * @param {unknown} lsp  the effective settings' `lsp`: `{ servers?, plugins? }`
 * @returns {LspEntry[]}
 */
export function languageServers(lsp) {
  const own = isObject(lsp) && Array.isArray(lsp.servers) ? lsp.servers.filter(isObject) : [];
  const plugins = isObject(lsp) && Array.isArray(lsp.plugins) ? lsp.plugins.filter(isObject) : [];
  const switches = new Map(own.filter((e) => typeof e.name === "string" && typeof e.enabled === "boolean").map((e) => [e.name, e.enabled]));
  /** @param {Record<string, any>} s @param {{ env?: boolean }} [o] @returns {import("./client.js").LspSpec} */
  const specOf = (s, { env = false } = {}) => ({
    name: String(s.name),
    command: String(s.command),
    ...(Array.isArray(s.args) ? { args: s.args.map(String) } : {}),
    ...(env && isObject(s.env) ? { env: s.env } : {}),
    languages: languagesOf(s.extensionToLanguage ?? s.languages),
    ...(s.initializationOptions !== undefined ? { initializationOptions: s.initializationOptions } : {}),
    ...(isObject(s.settings) ? { settings: s.settings } : {}),
    ...(Number.isInteger(s.startupTimeout) && s.startupTimeout > 0 ? { startupTimeout: s.startupTimeout } : {}),
  });
  const yours = new Set();
  /** @type {LspEntry[]} */
  const out = [];
  for (const e of own) {
    if (typeof e.name !== "string" || typeof e.command !== "string" || yours.has(e.name)) continue;
    yours.add(e.name);
    out.push({ name: e.name, from: "yours", spec: specOf(e), on: e.enabled !== false });
  }
  const theirs = new Set();
  for (const s of plugins) {
    if (typeof s.name !== "string" || typeof s.command !== "string" || yours.has(s.name) || theirs.has(s.name)) continue;
    theirs.add(s.name);
    out.push({ name: s.name, from: "plugin", plugin: String(s.plugin || ""), spec: specOf(s, { env: true }), on: switches.get(s.name) ?? true });
  }
  for (const k of KNOWN_SERVERS) {
    if (yours.has(k.name)) continue;
    const spec = { name: k.name, command: k.command, ...(k.args ? { args: [...k.args] } : {}), languages: { ...k.languages }, ...(k.initializationOptions !== undefined ? { initializationOptions: k.initializationOptions } : {}), ...(k.settings ? { settings: k.settings } : {}) };
    out.push({ name: k.name, from: "filament", spec, on: switches.get(k.name) ?? true, install: k.install });
  }
  return out;
}

/** @type {Map<string, number>} */
const found = new Map();

/**
 * Whether a server's program is installed here, as its start finds it (`lspFound`). One found is taken as there for
 * FOUND_TTL_MS, for the PATH it was found on; one not found is looked for again at each ask, so a server installed
 * on being told how is found at the next.
 * @param {import("./client.js").LspSpec} spec @param {{ cwd: string, now?: number }} o  `cwd`: the folder it would start in
 */
export function installed(spec, { cwd, now = Date.now() }) {
  const key = JSON.stringify([spec.command, /[\\/]/.test(spec.command) ? cwd : "", spec.env || null, process.env.PATH || "", process.env.APPDATA || ""]);
  const at = found.get(key);
  if (at !== undefined && now - at < FOUND_TTL_MS) return true;
  if (!lspFound(spec, { cwd })) return false;
  if (found.size > 256) found.clear();
  found.set(key, now);
  return true;
}

/**
 * The server that serves a file: the first of `servers` that is on, serves its extension (`languageOf`) and is
 * installed. Else none, and why in words an agent can act on: no server here serves such files, the ones that do are
 * switched off here, or none of them is installed — each named with how it is installed, where Filament knows.
 * @param {string} path @param {readonly LspEntry[]} servers
 * @param {{ root?: string, found?: (spec: import("./client.js").LspSpec) => boolean }} [o]  `root`: the folder it
 *   would start in (the file's own where unsaid); `found`: whether its program is installed (`installed`)
 * @returns {{ server: LspEntry, said: "" } | { server: null, said: string }}
 */
export function serverFor(path, servers, { root = dirname(resolve(path)), found = (spec) => installed(spec, { cwd: root }) } = {}) {
  const serving = servers.filter((s) => languageOf(s.spec.languages, path) !== null);
  const on = serving.filter((s) => s.on);
  const server = on.find((s) => found(s.spec));
  if (server) return { server, said: "" };
  const ext = extname(path);
  const kind = ext ? `${ext} files` : "a file with no extension";
  if (!serving.length) return { server: null, said: `No language server here serves ${kind}.` };
  if (!on.length) return { server: null, said: `The language servers for ${kind} are switched off here (lsp.servers): ${serving.map((s) => s.name).join(", ")}.` };
  const ways = on.map((s) => (s.install ? `${s.spec.command} (${s.install})` : s.spec.command));
  return { server: null, said: `No language server for ${kind} is installed on this computer: ${ways.join(", or ")}. Filament runs the first it finds on the PATH.` };
}
