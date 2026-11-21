// @ts-check
// The connectors' picker (the owner's word of 10-26: "some well know connectors like github, linear … should be easy
// like Claude code to add … maybe sync with claude code or codex"; the Designer's of 10-26): the plugins the
// marketplaces Filament already reads list (app/plugin-sources.js) — Claude Code's first, then Codex's, then those added —
// that bring an MCP server, one row per service, found by name. Nothing here is kept by hand: what a plugin brings is
// read in its marketplace's folder where it stands there, or looked at in its repository in the background — its JSON
// files alone (app/plugins.js `look`) — and kept in `plugins/looks.json` by its source and commit, or until its
// marketplace moves where it names no commit. Add installs it as the Plugins page does and turns it on at the place,
// its hooks off; what it still needs there — a token, a sign-in — is the sheet's next step.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { sourceKey } from "../core/plugins.js";

/** How many looks run at once; how long a look without a commit, or one that failed, is trusted; the most kept. */
const LOOKS_AT_ONCE = 4;
const HEAD_LOOK_MS = 7 * 24 * 3600_000;
const FAILED_LOOK_MS = 3600_000;
const LOOKS_KEPT = 3000;
/** How long a look in a folder of this computer is trusted before it is read again. */
const FOLDER_LOOK_MS = 60_000;
/** How many plugins a search names that are not read yet the picker shows. */
const PENDING_SHOWN = 12;

/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);
/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * One connector the picker offers: its marketplace (`from` its id, `market` its name in words, `marketFrom` whose it
 * is), its plugin's name and words, the apps here that have it, the plugin installed in Filament that is it (null for
 * none), where that is on for the place (`here`, `all` from your defaults, null), its servers — where each connects or
 * what it runs, and the values it needs —, and what else the plugin brings.
 * @typedef {{ from: string, market: string, marketFrom: "claude" | "codex" | "added", name: string, title: string, line: string,
 *   installedIn: string[], plugin: string | null, on: "here" | "all" | null, onIn?: string,
 *   servers: { name: string, remote: boolean, host: string, runs: string, program: string, missing: boolean }[], needs: string[],
 *   more: { skills: number, hooks: number, commands: number, agents: number } }} ConnectorRow
 */

/**
 * A plugin a search names whose connectors are not known yet: its marketplace's words, and whether it is still read
 * (`reading`) or could not be (`failed`, `why`).
 * @typedef {{ from: string, market: string, marketFrom: "claude" | "codex" | "added", name: string, title: string, line: string,
 *   state: "reading" | "failed", why?: string }} PendingRow
 */

/** @typedef {import("./plugins.js").PluginLook} PluginLook */

/**
 * A server's address's host: a `${NAME:-default}` in it read as its default; "" where a value you give makes the host
 * (`${SOURCEGRAPH_ENDPOINT}/.api/mcp`).
 * @param {string} url
 */
export function hostOf(url) {
  try {
    const host = new URL(String(url).replace(/\$\{[A-Za-z_][\w.]*:-([^}]*)\}/g, "$1").replace(/\$\{[^}]*\}/g, "value.invalid")).host;
    return host.includes("value.invalid") ? "" : host;
  } catch {
    return "";
  }
}

/** What a look's server runs or connects to, in a line, 200 characters at most. @param {Record<string, any>} spec */
const runsOf = (spec) => {
  const line = spec.url ? String(spec.url) : [spec.command, ...(Array.isArray(spec.args) ? spec.args : [])].filter(Boolean).join(" ");
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/** A program by the name a person knows it, where that is not its own (the Designer's of 10-26). @type {Record<string, string>} */
const PROGRAM_NAMES = { npx: "Node.js", node: "Node.js", uvx: "uv", uv: "uv", bun: "Bun", bunx: "Bun", docker: "Docker", php: "PHP", python: "Python", python3: "Python", py: "Python" };

/**
 * The program a server that runs here starts, by the name a person knows it, and whether this computer lacks it: a
 * plain name is looked up as the server would be started; a path or a `${…}` in it is not checked.
 * @param {Record<string, any>} spec @param {(name: string) => boolean} onPath
 */
export function programOf(spec, onPath) {
  const cmd = String(spec.command || "").trim();
  if (!cmd || spec.url) return { program: "", missing: false };
  const base = (cmd.split(/[\\/]/).pop() || cmd).replace(/\.(exe|cmd|bat|com)$/i, "");
  return { program: PROGRAM_NAMES[base.toLowerCase()] || base, missing: !/[\\/$]/.test(cmd) && !onPath(cmd) };
}

/**
 * The picker's list and its Add.
 * @param {{ dataDir: string,
 *   sources: { allEntries: () => { markets: import("./plugin-sources.js").MarketView[], entries: { market: import("./plugin-sources.js").MarketView, entry: import("../core/plugins.js").MarketEntry, installedIn: string[] }[] },
 *     entry: (id: string, name: string) => { market: { id: string, name: string, title: string }, entry: import("../core/plugins.js").MarketEntry }, add: (input: unknown) => Promise<any> },
 *   plugins: { look: (entry: import("../core/plugins.js").MarketEntry, kind: "claude" | "codex") => Promise<PluginLook>, list: () => any[], get: (id: string) => any,
 *     install: (o: { from: string, name: string }) => Promise<any>, needsAt: (id: string, place: unknown, project?: string | null) => import("../core/plugin-parts.js").UserValue[] },
 *   places: { turn: (id: string, o: { place: unknown, on: unknown, hooks?: unknown }) => any,
 *     at: (id: string, place: unknown) => { place: string, label: string, on: boolean, here: boolean }, projectOf?: (place: unknown) => string | null,
 *     placeOn?: (id: string, place: unknown) => string | null },
 *   env?: Record<string, string | undefined>, now?: () => number, log?: (level: string, msg: string) => void, atOnce?: number }} o
 */
export function createConnectorCatalogue({ dataDir, sources, plugins, places, env = process.env, now = Date.now, log = () => {}, atOnce = LOOKS_AT_ONCE }) {
  const file = join(dataDir, "plugins", "looks.json");
  /** @type {Record<string, { at: number, look?: PluginLook, error?: string }>} */
  let kept = {};
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (doc && typeof doc.looks === "object" && !Array.isArray(doc.looks)) kept = doc.looks;
  } catch {
    // None kept yet, or a file that is not JSON: looked at again.
  }
  /** Looks in folders of this computer, read again after a minute. @type {Map<string, { at: number, look: PluginLook | null, error: string }>} */
  const folders = new Map();
  /** Whether a program is found on Filament's PATH, as a server it starts would find it; asked again after a minute. @type {Map<string, { at: number, found: boolean }>} */
  const programs = new Map();
  /** @param {string} name */
  const onPath = (name) => {
    const had = programs.get(name);
    if (had && now() - had.at < FOLDER_LOOK_MS) return had.found;
    const dirs = String(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
    const exts = process.platform === "win32" ? ["", ...String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
    const found = dirs.some((d) => exts.some((x) => {
      try {
        return statSync(join(d, name + x)).isFile();
      } catch {
        return false;
      }
    }));
    programs.set(name, { at: now(), found });
    return found;
  };
  /** Looks waiting or under way, by key. @type {Map<string, () => Promise<void>>} */
  const waiting = new Map();
  const running = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let writeSoon = null;

  function write() {
    writeSoon = null;
    const keys = Object.keys(kept);
    if (keys.length > LOOKS_KEPT) for (const k of keys.sort((a, b) => kept[a].at - kept[b].at).slice(0, keys.length - LOOKS_KEPT)) delete kept[k];
    try {
      mkdirSync(join(dataDir, "plugins"), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, looks: kept }));
      renameSync(`${file}.tmp`, file);
    } catch (e) {
      log("warn", `connectors: the looks at plugins were not kept (${said(e).slice(0, 160)})`);
    }
  }
  const keepSoon = () => {
    if (writeSoon) return;
    writeSoon = setTimeout(write, 500);
    writeSoon.unref?.();
  };

  /** A repository's plugin's key: its source and folder, at its commit — or at its branch as its marketplace stands. @param {import("./plugin-sources.js").MarketView} market @param {import("../core/plugins.js").PluginSource} s */
  const keyOf = (market, s) => {
    const g = /** @type {any} */ (s);
    return `${sourceKey(s)}#${g.path || ""}@${g.sha || `${g.ref || "HEAD"}~${market.updated}`}`;
  };

  /** Whether a kept look still holds. @param {{ at: number, look?: PluginLook, error?: string }} k @param {import("../core/plugins.js").PluginSource} s */
  const fresh = (k, s) => (k.error ? now() - k.at < FAILED_LOOK_MS : /** @type {any} */ (s).sha ? true : now() - k.at < HEAD_LOOK_MS);

  function pump() {
    while (running.size < atOnce && waiting.size) {
      const [key, job] = /** @type {[string, () => Promise<void>]} */ (waiting.entries().next().value);
      waiting.delete(key);
      running.add(key);
      void job().finally(() => {
        running.delete(key);
        pump();
      });
    }
  }

  /**
   * A repository's plugin's look: kept, or queued — null while it is read, or the one kept before while an old one
   * is read again.
   * @param {{ market: import("./plugin-sources.js").MarketView, entry: import("../core/plugins.js").MarketEntry }} e
   * @returns {{ look: PluginLook | null, error: string, reading: boolean }}
   */
  function lookOf({ market, entry }) {
    const kind = market.id.startsWith("codex/") ? "codex" : "claude";
    const s = entry.source;
    if (s.kind !== "github" && s.kind !== "git") return { look: null, error: "Filament does not fetch it", reading: false };
    const key = keyOf(market, s);
    const k = kept[key];
    if (k && fresh(k, s)) return { look: k.look || null, error: k.error || "", reading: false };
    if (!waiting.has(key) && !running.has(key))
      waiting.set(key, async () => {
        try {
          kept[key] = { at: now(), look: await plugins.look(entry, kind) };
        } catch (e) {
          kept[key] = { at: now(), error: said(e).slice(0, 240) };
        }
        keepSoon();
      });
    return { look: k?.look || null, error: "", reading: true };
  }

  /** The looks in folders read first, so one list has them all. @param {{ market: import("./plugin-sources.js").MarketView, entry: import("../core/plugins.js").MarketEntry }[]} entries */
  async function readFolders(entries) {
    await Promise.all(entries.filter((e) => e.entry.source.kind === "path").map(async ({ market, entry }) => {
      const s = /** @type {{ kind: "path", path: string }} */ (entry.source);
      const key = `${s.path}@${market.updated}`;
      const had = folders.get(key);
      if (had && now() - had.at < FOLDER_LOOK_MS && (had.look || had.error)) return;
      try {
        folders.set(key, { at: now(), look: await plugins.look(entry, market.id.startsWith("codex/") ? "codex" : "claude"), error: "" });
      } catch (e) {
        folders.set(key, { at: now(), look: null, error: said(e).slice(0, 240) });
      }
    }));
  }

  /** The plugins installed in Filament, by id, and by name for one installed from another source. */
  function installedNow() {
    /** @type {any[]} */
    let list = [];
    try {
      list = plugins.list();
    } catch (e) {
      log("warn", `connectors: the plugins installed could not be read (${said(e).slice(0, 160)})`);
    }
    const ids = new Set(list.map((p) => String(p.id)));
    /** @type {Map<string, string>} */
    const byName = new Map();
    for (const p of list) if (p.parts?.servers?.length && !byName.has(p.name)) byName.set(String(p.name), String(p.id));
    return { ids, byName };
  }

  /**
   * Where a plugin is on for the place: `here`, `all` (beneath it, seen from a project), or null; `onIn`, the Space of
   * your own above the project, by its name, where it is on from there.
   * @param {string} id @param {string} place @returns {{ on: "here" | "all" | null, onIn?: string }}
   */
  function onFor(id, place) {
    try {
      const at = places.at(id, place);
      if (!at.on) return { on: null };
      if (at.here || place === "all") return { on: "here" };
      const from = places.placeOn?.(id, place) || "all";
      return from === "all" ? { on: "all" } : { on: "all", onIn: places.at(id, from).label };
    } catch {
      return { on: null };
    }
  }

  const api = {
    /**
     * The connectors the marketplaces list, for the picker, found by `q`: each with where it is on for the place; how
     * many each marketplace's owner offers; how many plugins are still being read of those read from a repository
     * (`reading` of `readable`); the plugins `q` names that are not read yet or could not be (`pending`); and whether
     * there is any marketplace at all.
     * @param {{ q?: string, place?: string }} [o]
     */
    async list({ q = "", place = "all" } = {}) {
      const { markets, entries } = sources.allEntries();
      await readFolders(entries);
      const inst = installedNow();
      const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
      /** @type {ConnectorRow[]} */
      const rows = [];
      /** The plugins the search names whose connectors are not known yet — still read, or not readable (the owner's of
       *  10-31: "users might end up mistaking that connector doesn't exist"): a plugin's name and words are its
       *  marketplace's, known before its repository is read. @type {PendingRow[]} */
      const later = [];
      /** The queued looks of those still read, each by its row: read before the rest, as the rows are ranked. @type {Map<string, PendingRow>} */
      const wanted = new Map();
      const seen = new Set();
      let reading = 0;
      let readable = 0;
      let failed = 0;
      for (const e of entries) {
        const s = e.entry.source;
        let look = null;
        /** @type {"reading" | "failed" | ""} */
        let state = "";
        let why = "";
        if (s.kind === "path") {
          const had = folders.get(`${s.path}@${e.market.updated}`);
          look = had?.look || null;
          if (!look && had?.error) {
            failed++;
            state = "failed";
            why = had.error;
          }
        } else {
          if (s.kind === "github" || s.kind === "git") readable++;
          const got = lookOf(e);
          look = got.look;
          if (!look && got.reading) {
            reading++;
            state = "reading";
          }
          if (!look && got.error && s.kind !== "unknown") {
            failed++;
            state = "failed";
            why = got.error;
          }
        }
        if (!look && state && words.length && words.every((w) => `${e.entry.name} ${e.entry.title} ${e.entry.description}`.toLowerCase().includes(w))) {
          /** @type {PendingRow} */
          const row = { from: e.market.id, market: e.market.title || e.market.name, marketFrom: e.market.from, name: e.entry.name, title: e.entry.title || e.entry.name, line: e.entry.description, state, ...(why ? { why } : {}) };
          later.push(row);
          if (state === "reading") wanted.set(keyOf(e.market, s), row);
        }
        if (!look || !look.servers.length) continue;
        // Its name to show: the manifest's own where it gives one, else its marketplace's ("GitHub").
        const title = look.title && look.title.toLowerCase() !== e.entry.name.toLowerCase() ? look.title : e.entry.title || e.entry.name;
        // One row per service: a second plugin of the same name, or of the same name to show, is left out.
        if (seen.has(e.entry.name) || seen.has(`title:${title.toLowerCase()}`)) continue;
        seen.add(e.entry.name);
        seen.add(`title:${title.toLowerCase()}`);
        const id = `${e.entry.name}@${e.market.name}`;
        const plugin = inst.ids.has(id) ? id : inst.byName.get(e.entry.name) || null;
        let needs = look.asks.filter((a) => a.required && a.default == null && !(a.env && env[a.key]));
        if (plugin) {
          try {
            needs = plugins.needsAt(plugin, place);
          } catch {
            // Its record is gone between two reads: what its look says.
          }
        }
        rows.push({
          from: e.market.id,
          market: e.market.title || e.market.name,
          marketFrom: e.market.from,
          name: e.entry.name,
          title,
          line: e.entry.description || look.description,
          installedIn: e.installedIn,
          plugin,
          ...(plugin ? onFor(plugin, place) : { on: null }),
          servers: look.servers.map((x) => ({ name: x.name, remote: !!x.spec.url, host: x.spec.url ? hostOf(String(x.spec.url)) : "", runs: runsOf(x.spec), ...programOf(x.spec, onPath) })),
          needs: needs.map((a) => a.title),
          more: { skills: look.skills, hooks: look.hooks, commands: look.commands, agents: look.agents },
        });
      }
      const first = words[0] || "";
      const rank = (/** @type {{ name: string, title: string }} */ r) => (first && (r.name.toLowerCase().startsWith(first) || r.title.toLowerCase().startsWith(first)) ? 0 : 1);
      const byRank = (/** @type {{ name: string, title: string }} */ a, /** @type {{ name: string, title: string }} */ b) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      // One row a name, none for a service a row has; the first few. Those still read go to the head of the queue in the
      // order their rows stand, so the plugin you look for is read in seconds, not after the hundreds before it.
      const pending = later.filter((p, i) => !seen.has(p.name) && later.findIndex((x) => x.name === p.name) === i).sort(byRank).slice(0, PENDING_SHOWN);
      const ahead = [...waiting].filter(([k]) => wanted.has(k)).sort(([a], [b]) => byRank(/** @type {PendingRow} */ (wanted.get(a)), /** @type {PendingRow} */ (wanted.get(b))));
      if (ahead.length && String(q).trim().length >= 2) {
        const rest = [...waiting].filter(([k]) => !wanted.has(k));
        waiting.clear();
        for (const [k, job] of [...ahead, ...rest]) waiting.set(k, job);
      }
      pump();
      const counts = { claude: 0, codex: 0, added: 0 };
      for (const r of rows) counts[r.marketFrom]++;
      const hay = (/** @type {ConnectorRow} */ r) => `${r.name} ${r.title} ${r.line} ${r.servers.map((x) => x.host).join(" ")}`.toLowerCase();
      const found = rows.filter((r) => words.every((w) => hay(r).includes(w)));
      found.sort(byRank);
      return { none: !markets.length, markets: markets.map((m) => ({ id: m.id, from: m.from, title: m.title || m.name })), counts, reading, readable, failed, total: rows.length, connectors: found, pending };
    },

    /**
     * A connector added at a place: its plugin installed where it is not yet — as the Plugins page installs it, at its
     * commit — and turned on there, its hooks off. → the setup step: its servers and what they still need there.
     * @param {{ from: string, name: string, place: string }} o
     */
    async add({ from, name, place }) {
      const { market, entry } = sources.entry(String(from || ""), String(name || ""));
      const inst = installedNow();
      const own = `${entry.name}@${market.name}`;
      let id = inst.ids.has(own) ? own : inst.byName.get(entry.name) || "";
      if (!id) id = String((await plugins.install({ from: String(from), name: String(name) })).id);
      places.turn(id, { place, on: true, hooks: false });
      log("info", `connectors: ${id} turned on for ${place}`);
      return api.setup(id, place);
    },

    /**
     * What a connector's plugin needs at a place before it works: its servers — the name each has in Filament, where it
     * connects or what it runs — and the values none of the places sets.
     * @param {string} id @param {string} place
     */
    setup(id, place) {
      const p = plugins.get(id);
      const at = places.at(id, place);
      return {
        plugin: id,
        title: p.title,
        place: at.place,
        label: at.label,
        on: at.on,
        servers: (p.parts?.servers || []).map((/** @type {any} */ s) => ({ name: s.as, remote: !!s.remote, host: s.remote ? hostOf(s.runs) : "", runs: s.runs, program: "", missing: false })),
        needs: plugins.needsAt(id, place, at.place.startsWith("chat:") ? places.projectOf?.(place) || null : null),
      };
    },

    /** With no marketplace on this computer: Anthropic's, the one Claude Code uses, added from its GitHub repository. */
    async fetchAnthropic() {
      return sources.add("anthropics/claude-plugins-official");
    },

    /** The looks waiting and under way (for tests). */
    busy() {
      return waiting.size + running.size;
    },
  };
  return api;
}
