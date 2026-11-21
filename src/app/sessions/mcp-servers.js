// @ts-check
// Settings › MCP servers, the server half (HarnessV4_Settings_Plan HS-1): your servers in one place, for all chats, a
// project or one chat (HS-D6). Each answer is the list as that place resolves it — the layers beneath added up by
// name (HS-D7), each server with the layer it comes from, whether it is on, and its last test — with every credential
// as the placeholder (HS-D8). Each write changes one entry of one layer against the layer as stored at that moment,
// through that layer's one writer, so two windows never lose each other's servers (HC-25). Test connects, lists the
// tools and closes (HS-D9); its answer is kept in memory for the page's dot until Filament stops. Import from other
// apps (HS-6, HS-D75) reads Claude Desktop's, Cursor's and Codex's files when asked, and again on Save: what it found
// reaches the page masked, and the picks are written from the files themselves.
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { connectMcp, specKey } from "../../adapters/tools/mcp-client.js";
import { ACCOUNT_RE, MAIN_ACCOUNT, accountOf, accountWords, addressOf } from "../../core/oauth.js";
import { flatten, mcpEntryProblem, mcpServerProblem, validateLayer } from "../../services/session-settings.js";
import { LOADS, MCP_KNOB, NOTE_MAX, isPick, isSwitch, loadOf, maskEntry, mergeServers, noteOf, restoreList, specOf, withAccount, withNote } from "../../services/mcp-servers.js";
import { foundIn, foundSources, nameFrom, sameKey } from "./mcp-found.js";
import { refusal } from "./service.js";

/** @typedef {import("../../services/mcp-servers.js").Layer} Layer */
/** @typedef {import("../../services/mcp-servers.js").MergedServer} MergedServer */
/**
 * Where a list is read or written: your defaults (`all`), a project's layer, or a chat's own, with the folder a test
 * starts a server in and the words the page says it in (`label`; `name`, a project by its name alone).
 * @typedef {{ scope: string, at: Layer, projectId: string | null, chainId: string | null, cwd: string, label: string, name: string }} Place
 */
/**
 * A test's answer: the tools (`readOnly` where the server vouches it only reads), or what failed in words, with what
 * the program wrote before it ended. `signIn`: the server asks for a sign-in Filament does not hold (HC-142).
 * @typedef {{ ok: boolean, at: number, words: string, tools?: { name: string, readOnly: boolean }[], output?: string, signIn?: boolean }} TestResult
 */

/** The stored list of one layer, nested or dotted; [] when it holds none. @param {any} layer @returns {any[]} */
const listIn = (layer) => {
  const v = flatten(layer && typeof layer === "object" ? layer : {})[MCP_KNOB];
  return Array.isArray(v) ? v : [];
};

/** The last lines of a program's output, as a test shows them. @param {string} text */
const lastLines = (text) => String(text || "").trim().split(/\r?\n/).slice(-12).join("\n");

/**
 * A failed test in words (HC-7 to HC-10): what the person can act on, from the client's own error.
 * @param {any} e  the client's error @param {Record<string, any>} spec
 * @returns {{ words: string, output?: string, signIn?: boolean }}
 */
export function testWords(e, spec) {
  const msg = String(e?.message || e || "");
  const output = typeof e?.data?.output === "string" && e.data.output.trim() ? lastLines(e.data.output) : "";
  const withOutput = (/** @type {string} */ words) => (output ? { words, output } : { words });
  const old = spec?.type === "sse" ? " It is written as an old SSE server: Filament speaks Streamable HTTP, which it may not answer." : "";
  if (/could not start \(spawn .*ENOENT/.test(msg))
    return { words: /[\\/]/.test(String(spec?.command || "")) ? `${spec.command} was not found: no program is there` : `${spec?.command} was not found on this computer's PATH` };
  if (/could not start \(/.test(msg)) return { words: `${spec?.command} could not start: ${msg.replace(/^.*could not start \((.*)\)$/s, "$1")}` };
  const exit = /exited \(([^)]*)\)/.exec(msg);
  if (exit) return withOutput(`It started and ended (${exit[1]}) before it answered${output ? ". Its last lines:" : ", writing nothing"}`);
  // A server that asks for a sign-in Filament does not hold, or whose sign-in could not be renewed (HC-142, HC-148).
  if (e?.data?.signIn) {
    const why = String(e.data.words || "");
    return { words: why ? `${why[0].toUpperCase()}${why.slice(1)}` : "It needs you to sign in", signIn: true };
  }
  const http = /HTTP (\d{3})/.exec(msg);
  if (http && (http[1] === "401" || http[1] === "403"))
    return { words: `The server refused: ${http[1]}. Check the Authorization header.${old}` };
  if (http) return { words: `The server answered HTTP ${http[1]}${msg.includes(" — ") ? `: ${msg.slice(msg.indexOf(" — ") + 3)}` : ""}.${old}` };
  const late = /did not answer within (\d+) s/.exec(msg);
  if (late) return withOutput(`No answer in ${late[1]} s${spec?.url ? "" : "; the program was stopped"}.${old}`);
  const unreached = /(\S+ could not be reached.*)$/s.exec(msg);
  if (unreached) return { words: `${unreached[1]}.${old}` };
  const named = typeof spec?.name === "string" ? spec.name : "";
  return withOutput((named ? msg.replace(new RegExp(`^(MCP server )?${named}:? `), "") : msg) || "the test failed, and the client said nothing of why");
}

/** A file's text, or null when nothing is there. @param {string} path @returns {Promise<string | null>} */
async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (/** @type {any} */ (e)?.code === "ENOENT" || /** @type {any} */ (e)?.code === "ENOTDIR") return null;
    throw e;
  }
}

/** The word a found server's name takes after it when another app's server of that name came first. */
const SOURCE_WORD = Object.freeze({ "claude-desktop": "claude", cursor: "cursor", codex: "codex" });

/**
 * @param {{ sessions: any, memory: any, config: { get: () => any }, tests?: Map<string, TestResult>, connect?: typeof connectMcp,
 *   now?: () => number, home?: string, appData?: string, codexHome?: string, platform?: string, read?: (path: string) => Promise<string | null>,
 *   signIns?: ReturnType<typeof import("./mcp-sign-in.js").createMcpSignIns> | null, ownName?: (projectId: string) => string | null,
 *   pluginServers?: (p: Place) => import("../plugins.js").PluginServer[] }} deps
 *   `sessions`: the sessions service — each layer's one writer (`patchDefaults`, `patchProjectSettings`,
 *   `patchSettings`) and a chat's folder (`launchInfo`)
 *   `tests`: each server's last test by `specKey`, shared with the New Task board (HarnessV4_Settings_Plan HC-26)
 *   `home`, `appData`, `codexHome`, `platform`: where the other apps keep their files; `read`: a file's text, null when
 *   none is there
 *   `signIns`: the sign-ins to remote servers (HS-7): each HTTP row's state, a test's token, Sign in and Sign out
 *   `ownName`: a Space of the person's own's name where the project is one (E50): its list says "Work", not "project Work"
 *   `pluginServers`: the servers the plugins on at a place bring (app/plugins.js `serversAt`): the broadest layer of
 *   its list, each a row marked with its plugin, which the place may test, sign in to, load and switch, never edit
 */
export function createMcpServers({ sessions, memory, config, tests = new Map(), connect = connectMcp, now = Date.now, home = homedir(), appData = "", codexHome = "", platform = process.platform, read = readText, signIns = null, ownName = () => null, pluginServers = () => [] }) {
  const archive = () => {
    const a = memory?.archive;
    if (!a) throw refusal(503, "no archive: a project's and a chat's servers are kept in it");
    return a;
  };

  /**
   * The place a scope names: `all`, `project:<id>` or `chat:<id>`.
   * @param {unknown} scope @returns {Place}
   */
  function placeOf(scope) {
    const s = String(scope ?? "").trim();
    if (s === "all" || s === "") return { scope: "all", at: "global", projectId: null, chainId: null, cwd: home, label: "all chats", name: "all chats" };
    const m = /^(project|chat):(.+)$/.exec(s);
    if (!m) throw refusal(400, `scope must be all, project:<id> or chat:<id>, not "${s}"`);
    if (m[1] === "project") {
      const p = archive().getProject(m[2]);
      if (!p) throw refusal(404, "no such project");
      const own = ownName(p.id);
      return { scope: `project:${p.id}`, at: "project", projectId: p.id, chainId: null, cwd: String(p.cwd || "") || home, label: own || `project ${p.name || p.cwd || p.id}`, name: own || String(p.name || p.cwd || p.id) };
    }
    const info = sessions.launchInfo(m[2]);
    if (!info) throw refusal(404, "no such session");
    return { scope: `chat:${m[2]}`, at: "session", projectId: info.projectId, chainId: m[2], cwd: String(info.cwd || "") || home, label: "this chat", name: "this chat" };
  }

  /**
   * The layers a place keeps, broadest first, each with its stored list. A layer whose list the resolver does not read
   * (an entry it refuses, written by hand) says why, and adds nothing: the chats run as if it held none.
   * @param {Place} p
   */
  function storedOf(p) {
    const cfg = config.get();
    /** @type {{ at: Layer, list: any[], unread: string[] }[]} */
    const out = [];
    const put = (/** @type {"global" | "space" | "project" | "session"} */ at, /** @type {any[]} */ list) => {
      const { errors } = validateLayer({ [MCP_KNOB]: list }, { at: at === "space" ? "project" : at });
      out.push({ at, list, unread: errors });
    };
    put("global", listIn(cfg?.sessions?.defaults));
    const project = p.projectId && archive().getProject(p.projectId) ? p.projectId : null;
    // The Space of your own that shows the project: its connectors reach the project's chats (the owner's word of 10-26).
    const space = spaceAbove(p);
    if (space) put("space", listIn(archive().projectSettings(space)));
    if (project) put("project", listIn(archive().projectSettings(project)));
    if (p.at === "session" && p.chainId) put("session", listIn(archive().chainSettings(p.chainId)));
    return out;
  }

  /** The Space of your own above a place's project, or null — a Space's own place has none. @param {Place} p */
  const spaceAbove = (p) => {
    if (!p.projectId || !archive().getProject(p.projectId)) return null;
    const space = archive().spaceOf?.(p.projectId) || null;
    return space && space !== p.projectId ? space : null;
  };

  /**
   * The servers the plugins on at a place bring; none where they cannot be read (said in the log by app/plugins.js).
   * @param {Place} p @returns {import("../plugins.js").PluginServer[]}
   */
  function pluginsAt(p) {
    try {
      return pluginServers(p);
    } catch {
      return [];
    }
  }

  /**
   * The layers a place reads, broadest first: its plugins' servers that are filled in, then the layers it keeps.
   * @param {Place} p @param {import("../plugins.js").PluginServer[]} [ps]  its plugins' servers, where read already
   */
  function layersOf(p, ps = pluginsAt(p)) {
    /** @type {{ at: Layer, list: any[], unread: string[] }} */
    const theirs = { at: "plugin", list: ps.flatMap((s) => (s.spec ? [s.spec] : [])), unread: [] };
    return [theirs, ...storedOf(p)];
  }

  /** The place's own layer's stored list. @param {Place} p */
  const ownList = (p) => layersOf(p).find((l) => l.at === p.at)?.list || [];

  /**
   * One server as the page shows it: its spec with credentials as the placeholder, where it comes from, and its test.
   * A plugin's shows the spec its plugin writes — no value of yours in it — with its plugin; one of yours that takes a
   * plugin's server's name says which plugin's it keeps out (`hides`).
   * @param {MergedServer} s @param {Place} p @param {import("../plugins.js").PluginServer} [theirs]  a plugin's server of its name
   */
  function rowOf(s, p, theirs) {
    const fromPlugin = s.from === "plugin" && !!theirs;
    const spec = fromPlugin ? /** @type {Record<string, any>} */ (maskEntry(theirs.shown)) : s.spec ? /** @type {Record<string, any>} */ (maskEntry(s.spec)) : null;
    return {
      name: s.name,
      kind: spec ? (spec.url ? "http" : "stdio") : null,
      ...(spec ? { spec } : {}),
      ...(fromPlugin ? { plugin: theirs.plugin, pluginTitle: theirs.title, pluginOnly: theirs.only, pluginPlace: theirs.onPlace ?? null } : theirs && !s.orphan ? { hides: { plugin: theirs.plugin, title: theirs.title } } : {}),
      sse: spec?.type === "sse",
      from: s.from,
      on: s.on,
      switchedAt: s.switchedAt,
      replaces: s.replaces,
      orphan: s.orphan,
      // This place holds the server's spec (Edit and Remove act on it) or its switch (Clear puts the inherited back).
      own: s.from === p.at && !s.orphan,
      switchedHere: s.switchedAt === p.at && s.from !== p.at,
      // The account it signs in with here, and whether this place picked it over the layers beneath (S4b).
      account: accountWords(s.spec?.account),
      pickedHere: s.pickedAt === p.at,
      // How its tools reach Filament's own agent here, and whether this place set it over the layers beneath (E49).
      load: loadOf(s.spec),
      loadHere: s.loadAt === p.at,
      // What of it the place uses, said to every agent beside its tools, and the layer that said it last.
      note: noteOf(s.spec),
      noteAt: s.noteAt ?? (noteOf(s.spec) ? s.from : null),
      test: s.spec ? tests.get(specKey(/** @type {any} */ (s.spec))) || null : null,
      // Its sign-in, of the account it uses, for a server reached over HTTP that carries no Authorization of its own
      // (HS-D83, HS-D91, S4b).
      ...(s.spec?.url ? { signIn: signIns?.stateOf(String(s.spec.url), /** @type {any} */ (s.spec.headers), s.spec.account, p.scope) || null } : {}),
    };
  }

  /**
   * A plugin's server that waits for a value its plugin needs at the place: its row, off, with what it waits for.
   * @param {import("../plugins.js").PluginServer} s
   */
  function waitingRow(s) {
    const spec = /** @type {Record<string, any>} */ (maskEntry(s.shown));
    return {
      name: s.name, kind: spec.url ? "http" : "stdio", spec, plugin: s.plugin, pluginTitle: s.title, pluginOnly: s.only, pluginPlace: s.onPlace ?? null, waits: s.waits,
      sse: spec.type === "sse", from: "plugin", on: false, switchedAt: null, replaces: null, orphan: false, own: false, switchedHere: false,
      account: "", pickedHere: false, load: loadOf(null), loadHere: false, note: "", noteAt: null, test: null,
    };
  }

  /**
   * The list a place resolves, as Settings › MCP servers draws it.
   * @param {unknown} scope
   */
  function list(scope) {
    const p = placeOf(scope);
    const ps = pluginsAt(p);
    const theirs = new Map(ps.map((s) => [s.name, s]));
    const layers = layersOf(p, ps);
    // A plugin's server still waiting for a value has no spec yet: a pick for its name is no orphan, it waits with it.
    const merged = mergeServers(layers.filter((l) => !l.unread.length)).filter((s) => !(s.orphan && theirs.has(s.name)));
    const space = spaceAbove(p);
    // A row that names the Space above (from it, switched or picked there) says it by its name.
    const named = space ? { spaceId: space, spaceName: ownName(space) || "its Space" } : {};
    // Yours first, then the plugins', then those that wait for a value on their plugin's sheet.
    const rows = [...merged.filter((s) => s.from !== "plugin"), ...merged.filter((s) => s.from === "plugin")].map((s) => ({ ...rowOf(s, p, theirs.get(s.name)), ...named }));
    const waiting = ps.filter((s) => !s.spec && !merged.some((m) => m.name === s.name)).map((s) => ({ ...waitingRow(s), ...named }));
    return {
      scope: p.scope,
      at: p.at,
      label: p.label,
      name: p.name,
      projectId: p.projectId,
      // A Space of your own's list: its rows say "this Space" where a project's say "this project".
      ...(p.at === "project" && p.projectId && ownName(p.projectId) ? { ownSpace: true } : {}),
      // The Space of your own whose connectors this project's chats get: a row from it says its name.
      ...(space ? { space: { id: space, name: ownName(space) || "its Space" } } : {}),
      servers: [...rows, ...waiting],
      // A layer the chats do not read, and why: the page offers to clear it.
      unread: layers.filter((l) => l.unread.length).map((l) => ({ at: l.at, errors: l.unread })),
      held: ownList(p).length > 0,
    };
  }

  /**
   * The place's layer written whole through its one writer: the list, or nothing when it is empty (the layer
   * inherits again).
   * @param {Place} p @param {any[]} next
   */
  function write(p, next) {
    const change = next.length ? { patch: { [MCP_KNOB]: next } } : { unset: [MCP_KNOB] };
    if (p.at === "global") sessions.patchDefaults(change);
    else if (p.at === "project") sessions.patchProjectSettings(p.projectId, change);
    else sessions.patchSettings(p.chainId, change, { via: "MCP servers" });
  }

  /**
   * Whether the layers beneath the place have the server on: what a switch here would put back.
   * @param {Place} p @param {string} name
   */
  function onBeneath(p, name) {
    const s = beneath(p, name);
    return s ? s.on : null;
  }

  /**
   * The server of a name as the layers beneath the place merge it, or null.
   * @param {Place} p @param {string} name
   */
  function beneath(p, name) {
    const below = layersOf(p).filter((l) => l.at !== p.at && !l.unread.length);
    const s = mergeServers(below).find((x) => x.name === name);
    return s && !s.orphan ? s : null;
  }

  /**
   * The place's list with the account a server signs in with picked (HarnessV4_Space_Plan S4b): on a server the place
   * holds, its entry's `account`; on an inherited one, the place's own `{ name, account }` beside its switch — taken
   * away where it picks what the layers beneath pick.
   * @param {Place} p @param {string} key @param {unknown} account
   */
  function picked(p, key, account) {
    const want = accountOf(account);
    if (want && !ACCOUNT_RE.test(want)) throw refusal(400, `An account's name is letters, digits, space, . _ -, 32 at most ("${MAIN_ACCOUNT}" is the first's), not "${want.slice(0, 40)}"`);
    const cur = ownList(p);
    const at = cur.findIndex((e) => e && e.name === key);
    const mine = at >= 0 ? cur[at] : null;
    if (mine && !isSwitch(mine) && !isPick(mine)) {
      if (typeof mine.url !== "string") throw refusal(400, `${key} runs on this computer: it signs in its own way, with no account of Filament's`);
      return cur.with(at, withAccount(mine, want));
    }
    const below = beneath(p, key);
    if (!below?.spec) throw refusal(404, `no server named ${key} reaches ${p.label}`);
    if (typeof below.spec.url !== "string") throw refusal(400, `${key} runs on this computer: it signs in its own way, with no account of Filament's`);
    const { account: _was, ...rest } = mine || { name: key };
    const entry = accountOf(below.spec.account) === want ? rest : { ...rest, account: want || MAIN_ACCOUNT };
    const empty = Object.keys(entry).every((k) => k === "name");
    return empty ? cur.filter((_, i) => i !== at) : at >= 0 ? cur.with(at, entry) : [...cur, entry];
  }

  /**
   * The place's list with how a server's tools reach Filament's own agent set (E49): on a server the place holds, its
   * entry's `load` — none for on demand, the default —; on an inherited one, the place's own `{ name, load }` beside its
   * switch and its account — taken away where it says what the layers beneath say.
   * @param {Place} p @param {string} key @param {unknown} load
   */
  function loaded(p, key, load) {
    if (!LOADS.includes(/** @type {any} */ (load))) throw refusal(400, `A server's load is ${LOADS.map((l) => `"${l}"`).join(" or ")}, not "${String(load).slice(0, 40)}"`);
    const cur = ownList(p);
    const at = cur.findIndex((e) => e && e.name === key);
    const mine = at >= 0 ? cur[at] : null;
    if (mine && !isSwitch(mine) && !isPick(mine)) {
      const { load: _was, ...rest } = mine;
      return cur.with(at, load === "core" ? { ...rest, load } : rest);
    }
    const below = beneath(p, key);
    if (!below?.spec) throw refusal(404, `no server named ${key} reaches ${p.label}`);
    const { load: _was, ...rest } = mine || { name: key };
    const entry = loadOf(below.spec) === load ? rest : { ...rest, load };
    const empty = Object.keys(entry).every((k) => k === "name");
    return empty ? cur.filter((_, i) => i !== at) : at >= 0 ? cur.with(at, entry) : [...cur, entry];
  }

  /**
   * The place's list with what of a server it uses said (the owner's word of 10-26: Slack's channels for this project):
   * on a server the place holds, its entry's `note`; on an inherited one, the place's own `{ name, note }` beside its
   * switch and its other picks — taken away where it says what the layers beneath say. An empty note takes the place's
   * own away: what the layers beneath say stands again.
   * @param {Place} p @param {string} key @param {unknown} note
   */
  function noted(p, key, note) {
    if (typeof note !== "string" || note.length > NOTE_MAX) throw refusal(400, `What ${p.label} uses of ${key} is words, ${NOTE_MAX} characters at most`);
    const said = noteOf({ note });
    const cur = ownList(p);
    const at = cur.findIndex((e) => e && e.name === key);
    const mine = at >= 0 ? cur[at] : null;
    if (mine && !isSwitch(mine) && !isPick(mine)) return cur.with(at, withNote(mine, said));
    const below = beneath(p, key);
    if (!below?.spec) throw refusal(404, `no server named ${key} reaches ${p.label}`);
    const { note: _was, ...rest } = mine || { name: key };
    const entry = !said || noteOf(below.spec) === said ? rest : { ...rest, note: said };
    const empty = Object.keys(entry).every((k) => k === "name");
    return empty ? cur.filter((_, i) => i !== at) : at >= 0 ? cur.with(at, entry) : [...cur, entry];
  }

  /**
   * The account a server of a name signs in with at a place now — its own entry's, the place's pick, or the one beneath
   * it —; "" for main.
   * @param {Place} p @param {string} name
   */
  function accountHere(p, name) {
    const s = mergeServers(layersOf(p).filter((l) => !l.unread.length)).find((x) => x.name === name && x.spec && !x.orphan);
    return accountOf(s?.spec?.account);
  }
  /**
   * A server as the editor sends it — which says no account: the ⋯ picks one — with the account it signs in with here
   * kept (found by the Hunter on S4b: Edit and Save, or Test, signed a project picking "work" in as main).
   * @param {Place} p @param {string} key @param {Record<string, any>} entry
   */
  const keepAccount = (p, key, entry) => ("account" in entry ? entry : withAccount(entry, accountHere(p, key)));
  /**
   * A server as an editor sends it with its load kept where it names none (E49): the place's own entry's — an editor
   * that knows no load changes none —; on demand, the default, said by no field.
   * @param {Record<string, any> | null} mine @param {Record<string, any>} entry
   */
  const keepLoad = (mine, entry) => {
    const load = "load" in entry ? entry.load : mine && !isSwitch(mine) && !isPick(mine) ? mine.load : undefined;
    const { load: _was, ...rest } = entry;
    return load === undefined || load === "on-demand" ? rest : { ...rest, load };
  };
  /**
   * A server as an editor sends it with its note kept where it names none: the place's own entry's — the editor knows
   * no note; the ⋯ says it. @param {Record<string, any> | null} mine @param {Record<string, any>} entry
   */
  const keepNote = (mine, entry) => ("note" in entry || !mine || isSwitch(mine) || isPick(mine) || !noteOf(mine) ? entry : { ...entry, note: noteOf(mine) });

  /**
   * Add, change or switch one server in a place. `entry` is a server (`{ command … }` or `{ url … }`, credentials the
   * page did not change as the placeholder, the account it signs in with here kept where it names none), only
   * `{ enabled }`: a switch, which on a server this place holds is kept on it and on an inherited one is this place's
   * own `{ name, enabled }` — beside its pick, where it has one; dropped when it says what the layers beneath already
   * say —, only `{ account }`: the account it signs in with here (S4b, `picked`), only `{ load }`: how its tools
   * reach Filament's own agent here (E49, `loaded`), or only `{ note }`: what of it the place uses (`noted`). A changed
   * name renames the place's own server.
   * @param {unknown} scope @param {string} name @param {any} entry
   */
  function put(scope, name, entry) {
    const p = placeOf(scope);
    const key = String(name || "");
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw refusal(400, "a JSON object is required: a server ({ command, args?, env?, cwd? } or { url, headers? }), { enabled }, { account }, { load } or { note }");
    const only = !("command" in entry) && !("url" in entry) && entry.enabled === undefined;
    if (typeof entry.account === "string" && only) {
      write(p, picked(p, key, entry.account));
      return list(p.scope);
    }
    if ("load" in entry && only && entry.account === undefined) {
      write(p, loaded(p, key, entry.load));
      return list(p.scope);
    }
    if ("note" in entry && only && entry.account === undefined && entry.load === undefined) {
      write(p, noted(p, key, entry.note));
      return list(p.scope);
    }
    const cur = ownList(p);
    const at = cur.findIndex((e) => e && e.name === key);
    const mine = at >= 0 ? cur[at] : null;
    const switchOnly = typeof entry.enabled === "boolean" && !("command" in entry) && !("url" in entry);
    /** @type {any[]} */
    let next;
    if (switchOnly) {
      if (mine && isPick(mine)) {
        // An inherited server this place picks an account for: the switch rides on the pick, which carries it only where
        // it says other than the layers beneath (found by the Hunter on S4b: switched on over an "off" beneath, the pick
        // kept no `enabled`, and the server stayed off).
        const beneath = onBeneath(p, key);
        if (beneath === null) throw refusal(404, `no server named ${key} reaches ${p.label}`);
        const { enabled: _was, ...pick } = mine;
        next = cur.with(at, beneath === entry.enabled ? pick : { ...pick, enabled: entry.enabled });
      } else if (mine && !isSwitch(mine)) {
        const { enabled: _was, ...spec } = mine;
        next = cur.with(at, entry.enabled ? spec : { ...spec, enabled: false });
      } else {
        const beneath = onBeneath(p, key);
        if (beneath === null) throw refusal(404, `no server named ${key} reaches ${p.label}`);
        next = beneath === entry.enabled ? cur.filter((_, i) => i !== at) : at >= 0 ? cur.with(at, { name: key, enabled: entry.enabled }) : [...cur, { name: key, enabled: entry.enabled }];
      }
    } else {
      const newName = typeof entry.name === "string" && entry.name ? entry.name : key;
      if (newName !== key && cur.some((e) => e && e.name === newName)) throw refusal(409, `${p.label} already has a server named ${newName}`);
      // The credentials kept for the server by its name before any rename: this place's own, then the nearest beneath.
      const sources = [mine, ...layersOf(p).filter((l) => l.at !== p.at).reverse().map((l) => l.list.find((e) => e && e.name === key))].map((e) => (e ? [e] : null));
      const r = restoreList([keepNote(mine, keepLoad(mine, keepAccount(p, key, { ...entry, name: key })))], sources);
      if (r.errors.length) throw refusal(400, r.errors.join("; "), { errors: r.errors });
      const server = { ...r.list[0], name: newName };
      // A switch the place held stays the server's state, unless the entry says its own.
      if (typeof entry.enabled !== "boolean" && mine && mine.enabled === false) server.enabled = false;
      if (server.enabled === true) delete server.enabled;
      const problem = mcpEntryProblem(server);
      if (problem) throw refusal(400, `server ${newName} ${problem}`);
      next = at >= 0 ? cur.with(at, server) : [...cur, server];
    }
    write(p, next);
    return list(p.scope);
  }

  /**
   * Take one entry out of a place: its own server, or its switch for an inherited one. A server the place does not
   * hold is refused in words: it comes from beneath, where it is removed, or it is switched off here.
   * @param {unknown} scope @param {string} name
   */
  function remove(scope, name) {
    const p = placeOf(scope);
    const cur = ownList(p);
    const key = String(name || "");
    const gone = cur.find((e) => e && e.name === key);
    if (!gone) throw refusal(404, `${p.label} holds no server named ${key}: switch it off here, or remove it where it comes from`);
    write(p, cur.filter((e) => !(e && e.name === key)));
    // Its sign-ins go with it — every account at its address —, unless your list for all chats, a project's or a chat's
    // still names the address (HS-D90, HC-152, S4b).
    const signedOut = typeof gone.url === "string" && signIns && signIns.stateOf(gone.url, gone.headers) && !addressNamed(gone.url) ? signIns.signOutEvery(gone.url).signedOut : false;
    return { ...list(p.scope), ...(signedOut ? { signedOut: true } : {}) };
  }

  /**
   * Whether your list for all chats, any project's or any chat's names a server at an address (HC-152) — a chat's too
   * since a chat's server picks an account (found by the Hunter on S4b: removed from all chats, a chat's own server
   * there lost its sign-in).
   * @param {string} url
   */
  function addressNamed(url) {
    const want = addressOf(url);
    const same = (/** @type {any} */ e) => {
      try {
        return !!e && typeof e.url === "string" && addressOf(e.url) === want;
      } catch {
        return false;
      }
    };
    const a = memory?.archive;
    const lists = [
      listIn(config.get()?.sessions?.defaults),
      ...(a ? a.projects().map((/** @type {any} */ pr) => listIn(a.projectSettings(pr.id))) : []),
      ...(a?.chainLayers ? a.chainLayers().map((/** @type {any} */ c) => listIn(c.settings)) : []),
    ];
    return lists.some((l) => l.some(same));
  }

  /**
   * The server of a name as a place resolves it, its credentials open: what a sign-in starts from.
   * @param {Place} p @param {string} name
   */
  function serverIn(p, name) {
    const s = mergeServers(layersOf(p).filter((l) => !l.unread.length)).find((x) => x.name === name && x.spec && !x.orphan);
    if (!s?.spec) throw refusal(404, `no server named ${name} reaches ${p.label}`);
    if (typeof s.spec.url !== "string" || !s.spec.url) throw refusal(400, `${name} runs on this computer: only a server reached over HTTP signs in`);
    return /** @type {{ url: string, headers?: Record<string, string>, account?: string }} */ (s.spec);
  }

  /**
   * A server a project's chats have, by its name, its credentials open — what a dashboard of the project's Space reads
   * or calls (HarnessV4_Space_Plan S4a) —, with the folder it starts in; or why there is none, in words.
   * @param {string} projectId @param {string} name
   * @returns {{ ok: true, spec: Record<string, any>, cwd: string } | { ok: false, error: string }}
   */
  function serverFor(projectId, name) {
    /** @type {Place} */
    let p;
    try {
      p = placeOf(`project:${projectId}`);
    } catch {
      return { ok: false, error: "its project is no longer kept" };
    }
    const s = mergeServers(layersOf(p).filter((l) => !l.unread.length)).find((x) => x.name === name);
    // A Space of the person's own is said as a Space: its Connectors add its servers (E50).
    const own = ownName(projectId);
    if (!s || s.orphan || !s.spec)
      return { ok: false, error: own ? `${name} is no MCP server of this Space's chats (its Connectors, or Library › Plugins & Connectors for all chats)` : `${name} is no MCP server of this project's chats (Library › Plugins & Connectors, for all chats or this project)` };
    if (!s.on) return { ok: false, error: `${name} is switched off for this ${own ? "Space (its Connectors)" : "project (Library › Plugins & Connectors)"}` };
    return { ok: true, spec: s.spec, cwd: p.cwd };
  }

  /** @returns {NonNullable<typeof signIns>} */
  const wired = () => {
    if (!signIns) throw refusal(503, "sign-ins to MCP servers are not wired in this Filament");
    return signIns;
  };

  /**
   * Start signing in to a place's server (HS-7, HC-143): the address of its page to open, and the id to ask after. As
   * the account the place picks; with `account`, as that one (S4b: Sign in with another account…), which the place
   * picks once the sign-in is done.
   * @param {unknown} scope @param {string} name
   * @param {{ clientId?: string, clientSecret?: string, remote?: boolean, account?: string }} [o]  `clientId`,
   *   `clientSecret`: the client a person made, for a server that lets no app register (HS-D86); `remote`: the page is
   *   on another computer
   */
  async function signIn(scope, name, o = {}) {
    const s = wired();
    const p = placeOf(scope);
    const key = String(name || "");
    const spec = serverIn(p, key);
    const { account: other, ...rest } = o;
    const named = typeof other === "string" && other.trim() !== "";
    const account = named ? accountOf(other) : accountOf(spec.account);
    const onDone = named && account !== accountOf(spec.account) ? () => write(p, picked(p, key, account)) : undefined;
    // `from`: the place that asked, whose rows alone show a wait for an account they do not use (Hunter on S4b).
    return s.start({ name: key, url: spec.url, headers: spec.headers || {}, ...rest, account, from: String(p.scope), ...(onDone ? { onDone } : {}) });
  }

  /**
   * Sign out of the account a place's server uses at its address (HS-D90, HC-151, S4b): for every place that uses it;
   * the address's other accounts stay.
   * @param {unknown} scope @param {string} name
   */
  function signOut(scope, name) {
    const p = placeOf(scope);
    const spec = serverIn(p, String(name || ""));
    const r = wired().signOut(spec.url, spec.account);
    return { ...list(p.scope), signedOut: r.signedOut, told: r.told };
  }

  /** A place back to what it inherits: its own list gone. @param {unknown} scope */
  function reset(scope) {
    const p = placeOf(scope);
    if (ownList(p).length) write(p, []);
    return list(p.scope);
  }

  /**
   * Test a server as written (HS-D9): connect in the folder the place's chats would start it in, list the tools, close.
   * A credential the page sends as the placeholder is the one kept for the server of that name in the place or
   * beneath it. The answer is kept by the spec, for the list's dot; a remote server that answers with no sign-in held
   * no longer asks for one.
   * @param {unknown} scope @param {any} entry
   * @returns {Promise<TestResult>}
   */
  async function test(scope, entry) {
    const p = placeOf(scope);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw refusal(400, "a JSON object is required: the server to test");
    /** @type {Record<string, any>} */
    let spec;
    if (entry.plugin === true) {
      // A plugin's server, by its name: as the place starts it, its values and picks in — the page never holds them.
      const s = mergeServers(layersOf(p).filter((l) => !l.unread.length)).find((x) => x.name === entry.name && x.from === "plugin" && x.spec);
      if (!s?.spec) throw refusal(404, `no plugin's connector named ${String(entry.name ?? "")} reaches ${p.label}`);
      spec = s.spec;
    } else {
      const sources = layersOf(p).reverse().map((l) => [l.list.find((e) => e && e.name === entry.name)].filter(Boolean));
      // Tested as the account it signs in with here, where the editor's entry names none.
      const r = restoreList([typeof entry.name === "string" ? keepAccount(p, entry.name, entry) : entry], sources);
      if (r.errors.length) throw refusal(400, r.errors.join("; "), { errors: r.errors });
      spec = specOf(r.list[0]);
    }
    const problem = mcpServerProblem(spec);
    if (problem) throw refusal(400, `server ${spec.name ?? ""} ${problem}`.replace(/\s+/g, " "));
    /** @type {TestResult} */
    let result;
    try {
      const conn = await connect(/** @type {any} */ (spec), { cwd: p.cwd, auth: signIns?.auth || null });
      try {
        const tools = conn.tools.map((t) => ({ name: t.tool, readOnly: t.readOnly }));
        const reading = tools.filter((t) => t.readOnly).length;
        result = { ok: true, at: now(), tools, words: `${tools.length} tool${tools.length === 1 ? "" : "s"}${tools.length ? `: ${reading} only read` : ""}` };
        if (typeof spec.url === "string") signIns?.answered(spec.url, spec.account);
      } finally {
        await conn.close();
      }
    } catch (e) {
      result = { ok: false, at: now(), ...testWords(e, spec) };
    }
    tests.set(specKey(/** @type {any} */ (spec)), result);
    return result;
  }

  /**
   * The list again once each remote server it has on, untested and with no sign-in held, was asked whether it wants
   * one (the sign-ins' `look`, once each since Filament started): a row that asks now says so before anyone presses
   * anything. `changed` where one asks now. Waits `wait` at most; a slow server is left to its test.
   * @param {unknown} scope @param {number} [wait]
   */
  async function look(scope, wait = 8000) {
    const p = placeOf(scope);
    const s = signIns;
    const specs = s
      ? mergeServers(layersOf(p).filter((l) => !l.unread.length))
          .filter((x) => x.on && !x.orphan && typeof x.spec?.url === "string" && !tests.get(specKey(/** @type {any} */ (x.spec))) && !s.stateOf(String(x.spec.url), /** @type {any} */ (x.spec.headers), x.spec.account, p.scope))
          .map((x) => /** @type {Record<string, any>} */ (x.spec))
      : [];
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const late = new Promise((done) => {
      timer = setTimeout(() => done([]), wait);
    });
    const asks = /** @type {boolean[]} */ (await Promise.race([Promise.all(specs.map((spec) => /** @type {NonNullable<typeof s>} */ (s).look(spec.url, spec.headers, spec.account))), late]));
    clearTimeout(timer);
    return { ...list(p.scope), changed: asks.some(Boolean) };
  }

  /**
   * The other apps' files, read now: each file's state, and its servers with the name each comes in under (HS-D77). A
   * name another app's server took first takes the app's word after it; the same server twice is offered once; one
   * named Filament is Filament's own server, which every chat has.
   */
  async function readFound() {
    const sources = foundSources({ home, appData, codexHome, platform });
    /** @type {Map<string, { key: string, label: string }>} the offered names so far: each spec's content and its app */
    const offered = new Map();
    const out = [];
    for (const source of sources) {
      /** @type {{ state: "found" | "missing" | "unreadable", why?: string, servers: any[] }} */
      let got;
      try {
        const text = await read(source.path);
        got = text === null ? { state: "missing", servers: [] } : { state: "found", servers: foundIn(source, text) };
      } catch (e) {
        got = { state: "unreadable", why: String(/** @type {any} */ (e)?.message || e), servers: [] };
      }
      const servers = got.servers.map((f) => {
        const key = sameKey(f.spec);
        let name = nameFrom(f.from);
        if (name === "filament") return { ...f, name, mark: "own" };
        const earlier = [...offered].find(([, o]) => o.key === key);
        if (earlier) return { ...f, name: earlier[0], mark: "repeat", sameIn: earlier[1].label };
        if (offered.has(name)) {
          const word = SOURCE_WORD[source.id];
          const base = `${name.slice(0, 31 - word.length)}-${word}`;
          name = base;
          for (let n = 2; offered.has(name); n++) name = `${base.slice(0, 31 - String(n).length)}-${n}`;
        }
        offered.set(name, { key, label: source.label });
        return { ...f, name, mark: "new" };
      });
      out.push({ source, ...got, servers });
    }
    return out;
  }

  /**
   * What Import from other apps offers a place (HS-D75, HC-79, HC-127 to HC-133): each file — found, not there, or not
   * read and why — and its servers, each new, the same as one the place has, under a name of the place's it would
   * replace, or Filament's own; credentials as the placeholder. The files are read now, and only now.
   * @param {unknown} scope
   */
  async function scan(scope) {
    const p = placeOf(scope);
    // Your own lists only: what Import brings is yours, beside any plugin's.
    const mine = mergeServers(storedOf(p).filter((l) => !l.unread.length)).filter((s) => s.spec && !s.orphan);
    const sameAs = new Map(mine.map((s) => [sameKey(/** @type {Record<string, any>} */ (s.spec)), s.name]));
    const names = new Set(mine.map((s) => s.name));
    const found = await readFound();
    return {
      scope: p.scope,
      label: p.label,
      sources: found.map(({ source, state, why, servers }) => ({
        id: source.id,
        label: source.label,
        path: source.path,
        state,
        ...(why ? { why } : {}),
        servers: servers.map((f) => {
          const yours = f.mark === "new" ? sameAs.get(sameKey(f.spec)) : undefined;
          const mark = yours ? "same" : f.mark === "new" && names.has(f.name) ? "taken" : f.mark;
          return {
            from: f.from,
            name: f.name,
            kind: f.spec.url ? "http" : "stdio",
            spec: maskEntry({ name: f.name, ...f.spec }),
            mark,
            ...(yours ? { yours } : mark === "taken" ? { yours: f.name } : {}),
            ...(f.sameIn ? { sameIn: f.sameIn } : {}),
            notes: f.notes,
          };
        }),
      })),
    };
  }

  /**
   * The picked servers written into a place (HC-132, HC-134): the files are read again, so a credential never comes
   * from the page; a pick whose server left its file is named in `gone`, and the rest are added.
   * @param {unknown} scope @param {unknown} picks  `[{ source, name }]`, the names the scan offered
   */
  async function bring(scope, picks) {
    const p = placeOf(scope);
    if (!Array.isArray(picks) || !picks.length || picks.some((x) => !x || typeof x.source !== "string" || typeof x.name !== "string"))
      throw refusal(400, "picks must be a list of { source, name }, the servers to add");
    const found = await readFound();
    /** @type {string[]} */
    const added = [];
    /** @type {string[]} */
    const gone = [];
    /** @type {{ name: string, error: string }[]} */
    const failed = [];
    for (const pick of picks) {
      const at = found.find((f) => f.source.id === pick.source);
      const f = at?.servers.find((s) => s.name === pick.name && s.mark === "new");
      if (!at || !f) {
        gone.push(`${at?.source.label || pick.source}'s ${pick.name}`);
        continue;
      }
      try {
        put(p.scope, f.name, { name: f.name, ...f.spec });
        added.push(f.name);
      } catch (e) {
        failed.push({ name: f.name, error: String(/** @type {any} */ (e)?.message || e) });
      }
    }
    return { ...list(p.scope), added, gone, failed };
  }

  /**
   * The lists a chat's place keeps, broadest first, the unread ones left out: what a turn takes a plugin's server's
   * switch, account and load from (app/plugins.js `into`). A chat not made yet reads its project's.
   * @param {{ project: string | null, chat: string | null }} where
   * @returns {{ at: Layer, list: any[] }[]}
   */
  function layersAt({ project, chat }) {
    /** @type {Place | null} */
    let p = null;
    if (chat) {
      try {
        p = placeOf(`chat:${chat}`);
      } catch {
        p = null;
      }
    }
    if (!p && project && memory?.archive?.getProject(project)) p = placeOf(`project:${project}`);
    return storedOf(p || placeOf("all")).filter((l) => !l.unread.length).map(({ at, list }) => ({ at, list }));
  }

  return { list, put, remove, reset, test, look, placeOf, scan, bring, signIn, signOut, serverFor, layersAt };
}
