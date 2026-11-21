// @ts-check
// A plugin's parts (HarnessV4_SpacesPlugins_Plan B2, B3), pure: where each part stands in its folder — Claude's
// defaults (`commands/`, `agents/`, `skills/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`) or the paths its manifest
// names, or its marketplace's entry (Claude's `strict`), Codex's (`skills`, `mcpServers`, `hooks`, `apps`) —; its MCP
// servers as Filament keeps a server, and its language servers; its hooks' commands, each with its event; the values
// it asks for (`userConfig`), checked; the parts Filament does not run here, named so that
// none is dropped silently (PL-D6); its paths and values filled in — `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`,
// Codex's `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`, `${user_config.<key>}` — and the environment
// its programs get; and what runs, as one key an update is compared by. The disk is app/plugins.js's.

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** How many of each part are read; how long a value may be. */
export const PART_LIMITS = Object.freeze({ servers: 32, hooks: 64, files: 400, value: 4000, options: 40 });

/** Claude's hook events Filament has a moment for, and the moment (B3's table): the rest are "not here yet" (PL-D6). */
export const HOOK_MOMENTS = Object.freeze({ PreToolUse: "pre-tool", PostToolUse: "post-tool", Stop: "turn-end", SessionStart: "session-start", UserPromptSubmit: "prompt-submit", PreCompact: "pre-compact", SubagentStop: "subagent-end" });

/**
 * The fields of a plugin's manifest that say what it holds — its parts, the values it asks for, its monitors and
 * channels —, which a marketplace's entry may write itself (Claude's: an entry is a plugin.json's fields, all optional).
 */
export const INLINE_FIELDS = Object.freeze(["commands", "agents", "skills", "hooks", "mcpServers", "lspServers", "outputStyles", "userConfig", "monitors", "channels"]);

/**
 * What a marketplace's entry writes of its plugin's manifest itself, as Claude Code reads it: the fields of
 * INLINE_FIELDS it writes, as written, and whether it is the whole manifest (`strict: false`) or adds to the plugin's
 * own plugin.json (`strict`, the default).
 * @typedef {{ strict: boolean, parts: Record<string, any> }} Inline
 */

/**
 * Where a plugin's parts stand, relative to its folder: lists of files or folders, or an inline object where the
 * manifest writes one (`hooks`, `mcpServers`, `lspServers`) — a list of files with an entry's own object beside them
 * where a strict entry adds one.
 * @typedef {{ commands: string[], agents: string[], skills: string[], hooks: (string | Record<string, any>)[] | Record<string, any>,
 *   mcp: (string | Record<string, any>)[] | Record<string, any>, lsp: (string | Record<string, any>)[] | Record<string, any>,
 *   outputStyles: string[], apps: string[] }} PartPaths
 */

/** A path or paths a manifest names, `./` dropped; none that climbs out. @param {unknown} v @returns {string[]} */
function pathsOf(v) {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return list
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, ""))
    .filter((p) => p && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.split("/").includes(".."));
}

/**
 * Where each part stands: Claude's defaults, then what its manifest adds (Claude adds to its default folders; a path
 * given for hooks or MCP servers replaces the default file), or Codex's manifest's fields. Where its marketplace's entry
 * writes parts itself (`inline`), as Claude Code reads them: a `strict: false` entry is the whole manifest, the
 * plugin.json's fields not read; a strict one adds to the plugin.json — each field it writes after the plugin.json's
 * (or its default file's), a file or an object of its own beside them.
 * @param {Record<string, any>} manifest  the plugin.json as written ({} where there is none) @param {"claude" | "codex"} kind
 * @param {Inline | null} [inline]
 * @returns {PartPaths}
 */
export function partPaths(manifest, kind, inline = null) {
  if (inline && !inline.strict) return pathsIn(inline.parts, kind);
  const own = pathsIn(manifest, kind);
  if (!inline) return own;
  const its = pathsIn(inline.parts, kind);
  /** @template T @param {string} field @param {T[] | Record<string, any>} a @param {T[] | Record<string, any>} b */
  const add = (field, a, b) => (inline.parts[field] === undefined ? a : [...new Set([...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])])]);
  return {
    commands: /** @type {string[]} */ (add("commands", own.commands, its.commands)),
    agents: /** @type {string[]} */ (add("agents", own.agents, its.agents)),
    skills: /** @type {string[]} */ (add("skills", own.skills, its.skills)),
    hooks: add("hooks", own.hooks, its.hooks),
    mcp: add("mcpServers", own.mcp, its.mcp),
    lsp: add("lspServers", own.lsp, its.lsp),
    outputStyles: /** @type {string[]} */ (add("outputStyles", own.outputStyles, its.outputStyles)),
    apps: own.apps,
  };
}

/**
 * Words for a plugin whose marketplace's entry is its whole manifest (`strict: false`) while its plugin.json says what
 * it holds as well, which would go unread; "" for any other. Claude Code refuses to load one whose entry writes
 * commands, agents, skills, hooks or output styles beside a plugin.json, its manifests in conflict.
 * @param {Record<string, any>} manifest  the plugin.json as written ({} where there is none) @param {Inline | null} [inline]
 */
export function inlineConflict(manifest, inline = null) {
  if (!inline || inline.strict || !isObject(manifest)) return "";
  const both = INLINE_FIELDS.filter((f) => manifest[f] !== undefined);
  return both.length ? `Its marketplace's entry is its whole manifest (strict: false), and its plugin.json says what it holds too (${both.join(", ")}): the two are in conflict, and Filament does not install it.` : "";
}

/** Where each part stands, by one manifest's fields alone. @param {unknown} manifest @param {"claude" | "codex"} kind @returns {PartPaths} */
function pathsIn(manifest, kind) {
  const m = isObject(manifest) ? manifest : {};
  const pick = (/** @type {string} */ key, /** @type {string[]} */ dflt) => (isObject(m[key]) ? m[key] : m[key] !== undefined ? pathsOf(m[key]) : dflt);
  if (kind === "codex")
    return {
      commands: pathsOf(m.commands),
      agents: pathsOf(m.agents),
      skills: m.skills !== undefined ? pathsOf(m.skills) : ["skills"],
      hooks: pick("hooks", []),
      mcp: pick("mcpServers", [".mcp.json"]),
      lsp: pick("lspServers", []),
      outputStyles: [],
      apps: m.apps !== undefined ? pathsOf(m.apps) : [],
    };
  return {
    commands: [...new Set(["commands", ...pathsOf(m.commands)])],
    agents: [...new Set(["agents", ...pathsOf(m.agents)])],
    skills: [...new Set(["skills", ...pathsOf(m.skills)])],
    hooks: pick("hooks", ["hooks/hooks.json"]),
    mcp: pick("mcpServers", [".mcp.json"]),
    lsp: pick("lspServers", [".lsp.json"]),
    outputStyles: [...new Set(["output-styles", ...pathsOf(m.outputStyles)])],
    apps: [],
  };
}

/** A map of strings. @param {unknown} m @returns {Record<string, string>} */
const stringsOf = (m) => (isObject(m) ? Object.fromEntries(Object.entries(m).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : {});

/**
 * A plugin's MCP servers as Filament keeps a server: `{ command, args?, env?, cwd? }` over stdio or `{ url, headers? }`
 * (an SSE one marked `type: "sse"`), from `.mcp.json` — `{ mcpServers: {…} }` or the servers alone — or the manifest's
 * own object. A server with neither a command nor an address is named in `skipped`.
 * @param {unknown} doc
 * @returns {{ servers: { name: string, spec: Record<string, any> }[], skipped: string[] }}
 */
export function mcpServersOf(doc) {
  const map = isObject(doc) && isObject(doc.mcpServers) ? doc.mcpServers : isObject(doc) ? doc : {};
  /** @type {{ name: string, spec: Record<string, any> }[]} */
  const servers = [];
  /** @type {string[]} */
  const skipped = [];
  for (const [name, s] of Object.entries(map).slice(0, PART_LIMITS.servers)) {
    if (!isObject(s) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) continue;
    if (typeof s.url === "string" && s.url) {
      const headers = stringsOf(s.headers);
      servers.push({ name, spec: { url: s.url, ...(Object.keys(headers).length ? { headers } : {}), ...(s.type === "sse" ? { type: "sse" } : {}) } });
    } else if (typeof s.command === "string" && s.command.trim()) {
      const args = Array.isArray(s.args) ? s.args.map(String) : [];
      const env = stringsOf(s.env);
      servers.push({ name, spec: { command: s.command, ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}), ...(typeof s.cwd === "string" && s.cwd ? { cwd: s.cwd } : {}) } });
    } else skipped.push(name);
  }
  return { servers, skipped };
}

/** A file extension as a language server's map names it: `.go`, `.tsx`. */
export const EXTENSION_RE = /^\.[A-Za-z0-9_+-]{1,16}$/;

/**
 * A plugin's language servers as Filament runs one (src/adapters/lsp/client.js's LspSpec, its name aside): `{ command,
 * args?, env?, languages, initializationOptions?, settings?, startupTimeout? }`, from `.lsp.json` — `{ lspServers: {…} }`
 * or the servers alone — or the manifest's own object, as Claude Code writes them (`extensionToLanguage` read as
 * `languages`, each extension as written: `.c` and `.C` are two). One Filament cannot run — over a socket, with nothing
 * to start, serving no file — is named in `skipped`, with why.
 * @param {unknown} doc
 * @returns {{ servers: { name: string, spec: Record<string, any> }[], skipped: { name: string, why: string }[] }}
 */
export function lspServersOf(doc) {
  const map = isObject(doc) && isObject(doc.lspServers) ? doc.lspServers : isObject(doc) ? doc : {};
  /** @type {{ name: string, spec: Record<string, any> }[]} */
  const servers = [];
  /** @type {{ name: string, why: string }[]} */
  const skipped = [];
  for (const [name, s] of Object.entries(map).slice(0, PART_LIMITS.servers)) {
    if (!isObject(s) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) continue;
    const languages = Object.fromEntries(
      Object.entries(isObject(s.extensionToLanguage) ? s.extensionToLanguage : {})
        .filter(([ext, id]) => EXTENSION_RE.test(ext) && typeof id === "string" && id.trim())
        .map(([ext, id]) => [ext, String(id).trim()]),
    );
    if (s.transport != null && s.transport !== "stdio") skipped.push({ name, why: `it talks over ${String(s.transport)}, and Filament speaks to language servers over stdio` });
    else if (typeof s.command !== "string" || !s.command.trim()) skipped.push({ name, why: "it names nothing to start" });
    else if (!Object.keys(languages).length) skipped.push({ name, why: "it names no files it serves" });
    else {
      const args = Array.isArray(s.args) ? s.args.map(String) : [];
      const env = stringsOf(s.env);
      servers.push({
        name,
        spec: {
          command: s.command,
          ...(args.length ? { args } : {}),
          ...(Object.keys(env).length ? { env } : {}),
          languages,
          ...(s.initializationOptions !== undefined ? { initializationOptions: s.initializationOptions } : {}),
          ...(isObject(s.settings) ? { settings: s.settings } : {}),
          ...(Number.isInteger(s.startupTimeout) && s.startupTimeout > 0 ? { startupTimeout: s.startupTimeout } : {}),
        },
      });
    }
  }
  return { servers, skipped };
}

/**
 * A hook as its file writes it: the event, what it matches (a tool's name, a pattern), its kind (`command`, `http`,
 * `prompt`, `agent`, `mcp_tool`), what it runs and how long it may take.
 * @typedef {{ event: string, matcher: string, type: string, command: string, timeout: number | null }} HookEntry
 */

/**
 * The hooks a `hooks.json` (or the manifest's object) holds, each by its event, as written.
 * @param {unknown} doc @returns {HookEntry[]}
 */
export function hooksOf(doc) {
  const map = isObject(doc) && isObject(doc.hooks) ? doc.hooks : isObject(doc) ? doc : {};
  /** @type {HookEntry[]} */
  const out = [];
  for (const [event, groups] of Object.entries(map)) {
    if (!Array.isArray(groups) || !/^[A-Za-z]+$/.test(event)) continue;
    for (const g of groups) {
      if (!isObject(g) || !Array.isArray(g.hooks)) continue;
      for (const hk of g.hooks) {
        if (!isObject(hk) || out.length >= PART_LIMITS.hooks) continue;
        const type = typeof hk.type === "string" ? hk.type : "command";
        const what = typeof hk.command === "string" ? hk.command : typeof hk.url === "string" ? hk.url : typeof hk.prompt === "string" ? hk.prompt : typeof hk.tool === "string" ? hk.tool : "";
        out.push({ event, matcher: typeof g.matcher === "string" ? g.matcher : "", type, command: what, timeout: Number.isFinite(hk.timeout) ? Number(hk.timeout) : null });
      }
    }
  }
  return out;
}

/**
 * A value a plugin asks for (`userConfig`): its key, kind, title, words, its default, the choices where it has some,
 * whether it is a secret (`sensitive`: sealed, never shown again) and whether the plugin needs it. `env`: a name its
 * servers read as Claude Code reads its environment (`envAsksOf`), not its manifest's.
 * @typedef {{ key: string, type: "string" | "number" | "boolean" | "directory" | "file", title: string, description: string,
 *   default: string | number | boolean | null, options: string[], sensitive: boolean, required: boolean, env?: boolean }} UserValue
 */

/** The names `fillPaths` fills itself: a plugin's folders and the project's. */
const OWN_NAMES = new Set(["CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "PLUGIN_ROOT", "PLUGIN_DATA", "CLAUDE_PROJECT_DIR"]);
/** `${NAME}`, or `${NAME:-its default}`, as Claude Code reads it in a server's spec. */
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})(?::-([^}]*))?\}/g;
/** A name that holds a secret, by its words. */
const SECRET_NAME = /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIALS?|AUTH|PAT)(_|$)/i;
/** The words a title keeps in capitals. */
const ACRONYMS = new Map([["api", "API"], ["url", "URL"], ["uri", "URI"], ["id", "ID"], ["pat", "PAT"], ["mcp", "MCP"], ["oauth", "OAuth"], ["ssh", "SSH"], ["jwt", "JWT"], ["sql", "SQL"], ["aws", "AWS"], ["gcp", "GCP"], ["dsn", "DSN"], ["http", "HTTP"]]);

/**
 * A name's title in words, its service's prefix dropped: GITHUB_PERSONAL_ACCESS_TOKEN of github, "Personal access
 * token"; LINEAR_API_KEY of linear, "API key".
 * @param {string} name @param {string} plugin
 */
export function envTitle(name, plugin) {
  const prefix = `${String(plugin || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;
  const rest = prefix.length > 1 && name.toUpperCase().startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
  const words = rest.toLowerCase().split("_").filter(Boolean).map((w) => ACRONYMS.get(w) || w);
  const said = words.join(" ");
  return said ? said.charAt(0).toUpperCase() + said.slice(1) : name;
}

/**
 * The values a plugin's servers name and nothing of Filament's fills — `${GITHUB_PERSONAL_ACCESS_TOKEN}` in a header,
 * `${API_KEY}` in an environment —, which Claude Code fills from its environment: each a value to set like one the
 * plugin asks for (the owner's word of 10-26: a connector from a marketplace needs no list kept by hand), titled in
 * words, a secret where its name says so, needed unless it names a default. `fillPaths` fills it from the value set,
 * else Filament's environment, else that default.
 * @param {readonly { spec: Record<string, any> }[]} servers @param {string} plugin  its name, a title's prefix dropped
 * @param {readonly UserValue[]} [asked]  the plugin's own asks: a name they hold is theirs
 * @returns {UserValue[]}
 */
export function envAsksOf(servers, plugin, asked = []) {
  /** @type {Map<string, string | null>} */
  const seen = new Map();
  const walk = (/** @type {unknown} */ x) => {
    if (typeof x === "string") {
      for (const m of x.matchAll(ENV_REF)) if (!OWN_NAMES.has(m[1]) && !seen.has(m[1]) && !asked.some((a) => a.key === m[1])) seen.set(m[1], m[2] ?? null);
    } else if (Array.isArray(x)) x.forEach(walk);
    else if (isObject(x)) Object.values(x).forEach(walk);
  };
  for (const s of servers) walk(s.spec);
  return [...seen].slice(0, PART_LIMITS.options).map(([key, d]) => ({
    key, type: /** @type {const} */ ("string"), title: envTitle(key, plugin), description: "", default: d, options: [], sensitive: SECRET_NAME.test(key), required: d == null, env: true,
  }));
}

/** @param {unknown} manifest @returns {UserValue[]} */
export function userConfigOf(manifest) {
  const map = isObject(manifest) && isObject(manifest.userConfig) ? manifest.userConfig : {};
  /** @type {UserValue[]} */
  const out = [];
  for (const [key, v] of Object.entries(map)) {
    if (!isObject(v) || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) continue;
    const type = ["string", "number", "boolean", "directory", "file"].includes(v.type) ? v.type : "string";
    const d = v.default;
    out.push({
      key,
      type,
      title: typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, 120) : key,
      description: typeof v.description === "string" ? v.description.trim().slice(0, 600) : "",
      default: typeof d === "string" || typeof d === "number" || typeof d === "boolean" ? d : null,
      options: Array.isArray(v.options) ? v.options.filter((o) => typeof o === "string").slice(0, PART_LIMITS.options) : [],
      sensitive: v.sensitive === true,
      required: v.required === true,
    });
  }
  return out;
}

/**
 * Values given for a plugin's asks, checked against them: each of its kind, one of its choices where it has some, a
 * secret written back as `keep` kept as it was. A key it does not ask for is refused; one it needs and lacks is named.
 * @param {readonly UserValue[]} asks @param {unknown} given @param {{ had?: Record<string, unknown>, keep?: string, need?: boolean }} [o]
 *   `had`: the values kept before; `keep`: the placeholder a secret reads as; `need`: whether a needed one may be missing
 * @returns {{ ok: true, values: Record<string, string | number | boolean> } | { ok: false, error: string }}
 */
export function checkValues(asks, given, { had = {}, keep = "", need = true } = {}) {
  if (!isObject(given)) return { ok: false, error: "values are a JSON object: { <key>: <value> }" };
  const known = new Map(asks.map((a) => [a.key, a]));
  /** @type {Record<string, string | number | boolean>} */
  const out = {};
  for (const [k, raw] of Object.entries(given)) {
    const a = known.get(k);
    if (!a) return { ok: false, error: `It asks for no value "${k}".` };
    if (raw === null || raw === "") continue;
    if (a.sensitive && keep && raw === keep) {
      const was = had[k];
      if (typeof was === "string" || typeof was === "number" || typeof was === "boolean") out[k] = was;
      continue;
    }
    if (a.type === "boolean") {
      if (typeof raw !== "boolean") return { ok: false, error: `${a.title} is yes or no.` };
      out[k] = raw;
    } else if (a.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `${a.title} is a number.` };
      out[k] = n;
    } else {
      if (typeof raw !== "string") return { ok: false, error: `${a.title} is words.` };
      if (raw.length > PART_LIMITS.value) return { ok: false, error: `${a.title} is ${PART_LIMITS.value} characters at most.` };
      if (a.options.length && !a.options.includes(raw)) return { ok: false, error: `${a.title} is one of ${a.options.join(", ")}.` };
      out[k] = raw;
    }
  }
  if (need) {
    const missing = asks.filter((a) => a.required && out[a.key] === undefined && a.default == null).map((a) => a.title);
    if (missing.length) return { ok: false, error: `It needs ${missing.join(", ")}.` };
  }
  return { ok: true, values: out };
}

/**
 * What a plugin's files say is filled in: its folder, its data folder, the project's folder, each value it asked for
 * (its default where none was given), and each name its servers read (`envAsksOf`) — the value set, else `env`'s
 * (Filament's environment), else its default. Other `${…}` stay as written.
 * @typedef {{ root: string, data: string, project?: string, values?: Record<string, string | number | boolean>, asks?: readonly UserValue[],
 *   env?: Record<string, string | undefined> }} FillVars
 */

/** The values asked for, each given or its default. @param {FillVars} v @returns {Record<string, string>} */
const valuesOf = (v) => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const a of v.asks || []) if (a.default != null) out[a.key] = String(a.default);
  for (const [k, x] of Object.entries(v.values || {})) out[k] = String(x);
  return out;
};

/**
 * A string of a plugin's with its paths and values filled in.
 * @param {string} text @param {FillVars} v
 */
export function fillPaths(text, v) {
  const values = valuesOf(v);
  const read = new Map((v.asks || []).filter((a) => a.env).map((a) => [a.key, a]));
  return String(text).replace(/\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PROJECT_DIR|user_config\.([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]{0,63})(?::-[^}]*)?)\}/g, (all, name, key, env) => {
    if (name === "CLAUDE_PLUGIN_ROOT" || name === "PLUGIN_ROOT") return v.root;
    if (name === "CLAUDE_PLUGIN_DATA" || name === "PLUGIN_DATA") return v.data;
    if (name === "CLAUDE_PROJECT_DIR") return v.project ?? all;
    if (key !== undefined) return key in values ? values[key] : all;
    const a = env !== undefined ? read.get(env) : undefined;
    if (!a) return all;
    const set = v.values?.[env];
    return set != null ? String(set) : v.env?.[env] ?? (a.default != null ? String(a.default) : all);
  });
}

/** An MCP server's spec with every string of it filled in. @param {Record<string, any>} spec @param {FillVars} v @returns {Record<string, any>} */
export function fillSpec(spec, v) {
  const fill = (/** @type {any} */ x) => (typeof x === "string" ? fillPaths(x, v) : Array.isArray(x) ? x.map(fill) : isObject(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fill(y)])) : x);
  return fill(spec);
}

/**
 * The environment a plugin's programs get: its folders under both apps' names, the project's folder, and each value as
 * `CLAUDE_PLUGIN_OPTION_<KEY>`.
 * @param {FillVars} v @returns {Record<string, string>}
 */
export function pluginEnv(v) {
  return {
    CLAUDE_PLUGIN_ROOT: v.root,
    CLAUDE_PLUGIN_DATA: v.data,
    PLUGIN_ROOT: v.root,
    PLUGIN_DATA: v.data,
    ...(v.project ? { CLAUDE_PROJECT_DIR: v.project } : {}),
    ...Object.fromEntries(Object.entries(valuesOf(v)).map(([k, x]) => [`CLAUDE_PLUGIN_OPTION_${k.toUpperCase()}`, x])),
    // A name its servers read is in their environment by that name too, as Claude Code's own environment holds it.
    ...Object.fromEntries((v.asks || []).filter((a) => a.env && v.values?.[a.key] != null).map((a) => [a.key, String(v.values?.[a.key])])),
  };
}

/**
 * What a plugin's folder holds, as app/plugins.js reads it: its MCP servers, its language servers, its hooks, its skills
 * (folders holding a SKILL.md), its commands and agents (Markdown files), and the parts Filament does not run, each in
 * words.
 * @typedef {{ servers: { name: string, spec: Record<string, any> }[], lsp: { name: string, spec: Record<string, any> }[], hooks: HookEntry[],
 *   skills: string[], commands: string[], agents: string[], asks: UserValue[], notHere: string[] }} PluginParts
 */

/**
 * The parts Filament does not run here, in words (PL-D6, PL-D7): hooks of an event it has no moment for or of a kind
 * other than a command, a language server it cannot run (`lspServersOf`'s skipped), output styles, Codex's apps,
 * programs in bin/, a settings.json, a server with nothing to start.
 * @param {{ hooks: readonly HookEntry[], lsp?: readonly { name: string, why: string }[], outputStyles: boolean, apps: boolean, bin: boolean, settings: boolean, skipped: readonly string[], monitors?: boolean, channels?: boolean }} o
 * @returns {string[]}
 */
export function notHereWords(o) {
  /** @type {string[]} */
  const out = [];
  const events = [...new Set(o.hooks.filter((x) => !(x.event in HOOK_MOMENTS)).map((x) => x.event))];
  if (events.length) out.push(`Hooks on ${events.join(", ")}: not here yet — Filament has no such moment`);
  const kinds = [...new Set(o.hooks.filter((x) => x.event in HOOK_MOMENTS && x.type !== "command").map((x) => x.type))];
  if (kinds.length) out.push(`Hooks of the kind ${kinds.join(", ")}: not here yet — Filament runs command hooks`);
  if (o.channels) out.push("Channels: later — a message that arrives will land in the Space");
  if (o.monitors) out.push("Monitors: later, as watches");
  for (const s of o.lsp || []) out.push(`The language server ${s.name}: ${s.why}`);
  if (o.outputStyles) out.push("Output styles: not supported here");
  if (o.apps) out.push("Apps: not supported — they are connections registered in ChatGPT");
  if (o.bin) out.push("Programs in bin/: not supported here");
  if (o.settings) out.push("Its settings.json: not supported here");
  for (const s of o.skipped) out.push(`The MCP server ${s}: it names nothing to start`);
  return out;
}

/**
 * What runs, as one key: each server's command, arguments, address and environment's names — its MCP servers' and its
 * language servers' —, and each hook's command. An update whose key moved waits for the person's press; one that
 * changed only words goes through (B2).
 * @param {Pick<PluginParts, "servers" | "hooks"> & { lsp?: PluginParts["lsp"] }} parts
 */
export function runKeyOf(parts) {
  return JSON.stringify({
    s: parts.servers.map((x) => [x.name, x.spec.command || "", x.spec.args || [], x.spec.url || "", Object.keys(x.spec.env || {}).sort(), Object.keys(x.spec.headers || {}).sort()]).sort(),
    l: (parts.lsp || []).map((x) => [x.name, x.spec.command || "", x.spec.args || [], Object.keys(x.spec.env || {}).sort()]).sort(),
    h: parts.hooks.map((x) => [x.event, x.matcher, x.type, x.command]).sort(),
  });
}

/**
 * What changed in what runs between two versions, in words for the update's row: "its MCP server discord runs another
 * command", "a new language server, gopls", "a new hook on Stop". "" where nothing that runs moved.
 * @param {Pick<PluginParts, "servers" | "hooks"> & { lsp?: PluginParts["lsp"] }} was @param {Pick<PluginParts, "servers" | "hooks"> & { lsp?: PluginParts["lsp"] }} now
 */
export function runChangeWords(was, now) {
  const words = [];
  for (const [what, a, b] of /** @type {const} */ ([["MCP server", was.servers, now.servers], ["language server", was.lsp || [], now.lsp || []]])) {
    const before = new Map(a.map((s) => [s.name, JSON.stringify(s.spec)]));
    for (const s of b) {
      if (!before.has(s.name)) words.push(`a new ${what}, ${s.name}`);
      else if (before.get(s.name) !== JSON.stringify(s.spec)) words.push(`its ${what} ${s.name} runs another way`);
    }
    for (const name of before.keys()) if (!b.some((s) => s.name === name)) words.push(`its ${what} ${name} goes`);
  }
  const key = (/** @type {HookEntry} */ x) => `${x.event}|${x.matcher}|${x.type}|${x.command}`;
  const had = new Set(was.hooks.map(key));
  const has = new Set(now.hooks.map(key));
  const added = [...new Set(now.hooks.filter((x) => !had.has(key(x))).map((x) => x.event))];
  const gone = [...new Set(was.hooks.filter((x) => !has.has(key(x))).map((x) => x.event))];
  if (added.length) words.push(`hooks new or changed on ${added.join(", ")}`);
  if (gone.length && !added.length) words.push(`hooks gone from ${gone.join(", ")}`);
  return words.join("; ");
}
