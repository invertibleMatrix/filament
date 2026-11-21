// @ts-check
// What a Dashboard reads by itself and what it watches (HarnessV4_Space_Plan S2, SG-D6, SG-D7, SG-D9): its sources —
// each a command Filament runs in the project's folder, no shell, its JSON (or tab-separated lines) read into rows, or a
// connection's tool (S4a: an MCP server the project's chats have, a tool its server marks read-only, its answer's data
// read into rows; and, for apps (the Space Apps plan of 10-29, more reads), an address fetched with the app's secrets,
// a folder of the project listed, Filament's own rows, or a Python script run through uv) — and its watches, each a
// rule over a source's rows that writes a line in What happened. Pure: each
// part checked in words that name it, as a tile is (core/artifact-content.js); the grant a Keep promises — the exact
// commands and tool calls and how often, the watches and their rules — and whether two versions promise the same; a
// command's output read into rows by the source's paths; a watch's news between two reads, the first read only
// learning. No AI reads or writes any of it.
import { feedRows } from "./feed-xml.js";
import { grantToolOf } from "./app-tools.js";

/** The least time between two reads of a source or a watch: a minute. */
export const EVERY_MIN_MS = 60_000;
/** How often a source is read while its tab is seen, when it names none. */
export const SOURCE_EVERY_MS = 120_000;
/** How often a watch reads its source, when it names none. */
export const WATCH_EVERY_MS = 600_000;
/** How long a source's command may run, and how much it may say, before it fails (SG-D6). */
export const COMMAND_MS = 60_000;
export const COMMAND_BYTES = 1_048_576;
/**
 * @typedef {{ ok: true, out: string, more?: boolean } | { ok: false, error: string }} CommandOut  a command's stdout, or
 *   why it failed; `more`, a read that stopped at its most before it saw all there was (a folder's): its rows are of the
 *   first ones
 * @typedef {(argv: string[], cwd: string, signal?: AbortSignal, env?: Record<string, string>) => Promise<CommandOut>} RunCommand
 *   how a source's command runs; `signal` stops it (its dashboard paused, taken out or kept again meanwhile); `env`,
 *   what its environment is given beside Filament's own — an app's secrets
 * @typedef {{ ok: true, said: string, args?: Record<string, unknown> } | { ok: false, error: string, said: string, args?: Record<string, unknown>, sent?: boolean }} ActionOut
 *   a button's command's end: what it said (its last words), or why it failed too; a tool's, the args it was sent (S4a)
 *   — and, stopped, whether the call had gone out (`sent`: its server was told to cancel it) or never did
 * @typedef {(argv: string[], cwd: string, signal?: AbortSignal, onData?: (chunk: string) => void, env?: Record<string, string>) => Promise<ActionOut>} RunAction
 *   how a button's command runs: until it ends, or `signal` stops it; `onData`, told what it says as it comes; `env`,
 *   as a source's
 */
/** The most rows a source keeps of one read, and the most items of a command's argv. */
export const SOURCE_ROWS_MAX = 500;
export const ARGV_MAX = 40;
/** The most a tool's args may weigh, as JSON (S4a). */
export const TOOL_ARGS_BYTES = 10_000;
/**
 * @typedef {{ connection: string, name: string, args: Record<string, unknown> }} Tool  a connection's tool as a source
 *   reads it or a button calls it (S4a): the MCP server by its name, its tool, the args it is called with
 * @typedef {{ url: string, headers: Record<string, string>, as: "json" | "text" | "rss" }} Fetch  an address a source
 *   reads (the Space Apps plan of 10-29, more reads): HTTPS — HTTP to this computer alone —, its headers, and how its
 *   answer reads: JSON, text (tab-separated lines by `fields`, else a row per line) or an RSS or Atom feed; each
 *   `{secret.NAME}` in its address or a header filled by Filament with the app's secret, never kept or shown
 * @typedef {{ path: string, match: string, depth: number }} FolderRead  a folder of the project a source lists, read
 *   only: its files and folders `depth` deep, those whose name matches `match` ("*.exe"; "" all)
 * @typedef {{ script: string, args: string[], with: string[] }} PythonRead  a Python script of the project a source runs
 *   through uv, with no project of its own: its arguments, and the packages it is run with
 */
/** How an address's answer reads, JSON where a source says none. */
export const FETCH_AS = Object.freeze(/** @type {const} */ (["json", "text", "rss"]));
/** The most headers a fetch sends, and how long its address may be. */
export const FETCH_HEADERS_MAX = 20;
export const FETCH_URL_MAX = 2000;
/** How deep a folder read looks at most, and how many packages a Python read is run with. */
export const FOLDER_DEPTH_MAX = 4;
export const PYTHON_WITH_MAX = 20;
/**
 * Filament's own numbers a source reads (`{"filament": "board"}`), each in words: what its rows are. The project's
 * alone — a Space of your own reads its own folder's.
 */
export const FILAMENT_READS = Object.freeze({
  board: "this Space's board: a row per task — id, title, line, column (planned, doing, waits, done), parked, chat, by, moved, done",
  chats: "this project's chats: a row per chat, the newest first — id, title, model, working (at work now), turns, started, last",
  usage: "what this project's chats spent: a row per chat — chat, title, requests, input, output, cacheRead (tokens), cost (USD), last",
  places: "this project's folders and worktrees: a row each — path, name, main, branch, base, ahead, behind, uncommitted (files), added, removed, missing",
});
/** A secret a fetch's address or header names: `{secret.GITHUB_TOKEN}`. */
export const SECRET_REF = /\{secret\.([A-Za-z0-9_]+)\}/g;
/** The kinds a source reads, one each. */
const KINDS = /** @type {const} */ (["command", "tool", "fetch", "folder", "filament", "python"]);
/** After this many failures in a row a source stops until it is read again by hand (screen 9). */
export const FAILS_TO_STOP = 3;
/** The most lines one read of a watch writes; the rest are counted. */
export const WATCH_LINES = 5;
/** The most row keys a watch keeps as seen. */
export const SEEN_KEYS_MAX = 1000;
/** Where a watch's lines go: What happened, or a row each in the project's Needs you (S5a, S5-D1). */
export const WATCH_TO = Object.freeze(["what-happened", "needs-you"]);
/** A source's or a column's name: letters, digits, - and _. */
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
/** An MCP server's name, as Library › Plugins & Connectors takes one (services/session-settings.js `mcpServerProblem`). */
const MCP_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** Whether a value is a JSON object. @param {unknown} x @returns {x is Record<string, any>} */
const isObject = (x) => Object.prototype.toString.call(x) === "[object Object]";
/** A value a row may hold and a match may name. @param {unknown} x */
const isScalar = (x) => x === null || ["string", "number", "boolean"].includes(typeof x);

/**
 * How often, in ms, from words: "90s", "2m", "1h" — or null where they do not read.
 * @param {unknown} words
 */
export function everyMs(words) {
  const m = /^(\d{1,5})\s*(s|m|h)$/.exec(String(words ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[/** @type {"s" | "m" | "h"} */ (m[2])];
}
/** A span in words: "2 min", "1 h", "90 s". @param {number} ms */
export const everyWords = (ms) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);

/**
 * @typedef {{ command: string[], tool: Tool | null, fetch: Fetch | null, folder: FolderRead | null, filament: string | null,
 *   python: PythonRead | null, rows: string, key: string, order: string, columns: Record<string, string> | null,
 *   fields: string[] | null, every: number }} Source  a source as kept: its argv — or its tool, its fetch, its folder,
 *   Filament's own rows or its Python script (`command` empty then) —, where its list is, what names a row, how its rows
 *   are ordered ("-when": newest first), each column's path, the columns of a tab-separated line, how often
 * @typedef {{ command?: string[], tool?: Tool, fetch?: Fetch, folder?: FolderRead, filament?: string, python?: PythonRead,
 *   every: number }} GrantSource  what a Keep lets a source read: one of them, and how often
 * @typedef {{ from: string, rule: "new" | "changes", column: string, match: Record<string, unknown>, says: string,
 *   to: string, every: number }} Watch  a watch as kept: its source, its rule — rows not seen before, or the first row's
 *   column moved —, which rows count, its words, where they go, how often
 * @typedef {{ on: string, only: Record<string, unknown> | null, except: Record<string, unknown> | null, command?: string[],
 *   tool?: Tool, check: Record<string, string>, ask: { name: string, choices: string[] | null, from: { source: string, column: string } | null }[],
 *   secondLook: boolean, effect?: "keeps" | "sends" }} GrantAction  what a Keep lets a button do: its command or its tool,
 *   on which rows, its checks, its fields' bounds, and its effect where it is not `writes` (so a grant kept before effects
 *   reads the same) — its label and sentence are words, not in it
 * @typedef {{ sources: Record<string, GrantSource>, watch: { from: string, rule: string,
 *   column: string, match: Record<string, unknown>, to: string, every: number }[],
 *   actions: Record<string, GrantAction>, secrets?: string[], hooks?: string[],
 *   tools?: Record<string, import("./app-tools.js").GrantTool> }} Grant  what a Keep lets a dashboard do
 *   (SG-D7): each command or tool call and how often, each watch's rule, each button's command or tool — and an app's
 *   secrets, by name, which its commands are handed (the Space Apps plan of 10-29), the collections a POST from this
 *   computer lands in (core/app-hooks.js), and the tools it offers its Space's agents (core/app-tools.js), where it has
 *   any, so a grant kept before them reads the same
 */

/**
 * What is wrong with a connection's tool, as the words after its owner's name; "" where nothing is (S4a).
 * @param {unknown} t
 */
function toolFault(t) {
  if (!isObject(t)) return 'has a tool that is no object: {"connection":"github","name":"list_workflow_runs","args":{"owner":"o","repo":"app"}}';
  if (typeof t.connection !== "string" || !NAME.test(t.connection)) return "has a tool with no connection: the name of an MCP server the project's chats have (Library › Plugins & Connectors)";
  // An MCP server's name is a-z, 0-9 and - (session-settings' `mcpServerProblem`): "GitHub" would name none, ever.
  if (!MCP_NAME.test(t.connection)) return `has a tool whose connection ${JSON.stringify(t.connection)} can be no MCP server's name: a-z, 0-9 and -, as Library › Plugins & Connectors names it ("github")`;
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 128 || /[\0-\x1f]/.test(t.name)) return "has a tool with no name: the server's own name for it, 128 characters at most";
  if (t.args != null && !isObject(t.args)) return 'has a tool whose args are no object: {"owner":"o","repo":"app"}';
  if (JSON.stringify(t.args ?? {}).length > TOOL_ARGS_BYTES) return `has a tool whose args weigh more than ${TOOL_ARGS_BYTES / 1000} KB`;
  return "";
}

/** A path inside the project's folder, as a folder read or a Python read names one: relative, and never above it. @param {string} p */
const insidePath = (p) => !!p && p.length <= 300 && !/[\0\r\n]/.test(p) && !/^([A-Za-z]:|[\\/])/.test(p) && !p.split(/[\\/]/).includes("..");
/** This computer's names, as an address's hostname reads once parsed (127.1 and [0::1] read as these). */
export const FETCH_LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
/** An address's host, where it may be read from: HTTPS anywhere, HTTP on this computer alone. @param {URL} u */
const fetchable = (u) => u.protocol === "https:" || (u.protocol === "http:" && FETCH_LOOPBACK.includes(u.hostname));
/**
 * The headers a fetch may not send, case aside: its connection's own, which Node sets, and those Filament's guards
 * read to tell who asks (a Host of one of its own names, an Origin, a cookie).
 */
const FETCH_HEADERS_BARRED = new Set(["host", "connection", "keep-alive", "content-length", "transfer-encoding", "te", "trailer", "upgrade", "expect", "cookie", "origin"]);
/** Whether a fetch may not send a header. @param {string} name */
export const headerBarred = (name) => FETCH_HEADERS_BARRED.has(name.toLowerCase());

/** Why an address whose host names a secret is not read, after "its" or "a fetch whose". */
export const HOST_SECRET = "host names a secret: the host is what you keep; a secret goes in its path, query or a header";
/**
 * Whether an address's host names a secret: its host as the address is parsed — every slash and backslash after
 * `https:` skipped, as no text before its first slash shows (found reviewing the Space work, 10-29) — read with two
 * values in its secrets' place, or no host read at all where it names one. @param {string} url
 */
export function hostNamesSecret(url) {
  if (!/\{secret\./.test(url)) return false;
  try {
    return new URL(url.replace(SECRET_REF, "a1")).host !== new URL(url.replace(SECRET_REF, "b2")).host;
  } catch {
    return true;
  }
}

/** What is wrong with a fetch, as the words after its source's name; "" where nothing is. @param {unknown} f */
function fetchFault(f) {
  if (!isObject(f)) return 'has a fetch that is no object: {"url":"https://api.github.com/repos/o/app/pulls","headers":{"authorization":"Bearer {secret.GITHUB_TOKEN}"}}';
  if (typeof f.url !== "string" || !f.url.trim() || f.url.length > FETCH_URL_MAX || /[\0\r\n\s]/.test(f.url)) return `has a fetch with no address: its url, ${FETCH_URL_MAX} characters at most`;
  /** @type {URL} */
  let u;
  try {
    u = new URL(f.url.replace(SECRET_REF, "x"));
  } catch {
    return `has a fetch whose url ${JSON.stringify(f.url.slice(0, 80))} is no address`;
  }
  if (!fetchable(u)) return `fetches ${u.protocol}//${u.host}: an address is HTTPS, or HTTP on this computer (localhost)`;
  // Its host is what a Keep shows: a secret may sit in its path or its query, never name where it goes.
  if (hostNamesSecret(f.url)) return `has a fetch whose ${HOST_SECRET}`;
  if (u.username || u.password) return "has a fetch with a sign-in in its address: send it in a header, with {secret.NAME}";
  if (f.headers != null) {
    if (!isObject(f.headers) || Object.keys(f.headers).length > FETCH_HEADERS_MAX) return `has headers that are no object of each header's name and value, ${FETCH_HEADERS_MAX} at most: {"accept":"application/json"}`;
    for (const [k, v] of Object.entries(f.headers)) {
      if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(k)) return `has the header ${JSON.stringify(k.slice(0, 64))}, which is no header's name`;
      if (headerBarred(k)) return `has the header ${k}, which a fetch may not send`;
      if (typeof v !== "string" || v.length > 2000 || /[\0\r\n]/.test(v)) return `has the header ${k} with no one-line value (2000 characters at most)`;
    }
  }
  if (f.as != null && !FETCH_AS.includes(f.as)) return `reads its answer as ${JSON.stringify(f.as)}: as json, text or rss`;
  return "";
}
/** What is wrong with a folder read, as the words after its source's name; "" where nothing is. @param {unknown} f */
function folderFault(f) {
  if (!isObject(f)) return 'has a folder that is no object: {"path":"dist","match":"*.exe"}';
  if (typeof f.path !== "string" || !insidePath(f.path.trim())) return 'lists a folder that is not inside the project\'s: its path from the project\'s folder, as "dist" ("." for the folder itself), never above it';
  if (f.match != null && (typeof f.match !== "string" || !f.match.trim() || f.match.length > 100 || /[\\/\0]/.test(f.match))) return 'has a match that is no file name\'s pattern: "*.exe", "report-??.csv"';
  if (f.depth != null && (!Number.isInteger(f.depth) || f.depth < 1 || f.depth > FOLDER_DEPTH_MAX)) return `looks ${JSON.stringify(f.depth)} deep: 1 (its own files) to ${FOLDER_DEPTH_MAX}`;
  return "";
}
/** A package a Python read is run with, as pip names one: "pandas", "pandas==2.2.3", "requests[socks]>=2". */
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,-]+\])?(\s*(==|>=|<=|~=|!=|<|>)\s*[A-Za-z0-9.*+!_-]+)?$/;
/** What is wrong with a Python read, as the words after its source's name; "" where nothing is. @param {unknown} p */
function pythonFault(p) {
  if (!isObject(p)) return 'has a python that is no object: {"script":"reads/report.py","with":["pandas"]}';
  if (typeof p.script !== "string" || !/\.py$/i.test(p.script.trim()) || !insidePath(p.script.trim())) return 'runs a script that is no .py file inside the project\'s folder: its path from there, as "reads/report.py"';
  if (p.args != null) {
    if (!Array.isArray(p.args) || p.args.length > ARGV_MAX) return `has args that are no list of words, ${ARGV_MAX} at most`;
    const bad = p.args.findIndex((a) => typeof a !== "string" || a.length > 1000 || /[\0\r\n]/.test(a));
    if (bad >= 0) return `has an arg ${bad + 1} that is no line of text (1000 characters at most)`;
  }
  if (p.with != null) {
    if (!Array.isArray(p.with) || p.with.length > PYTHON_WITH_MAX) return `has with that is no list of packages, ${PYTHON_WITH_MAX} at most: ["pandas"]`;
    const odd = p.with.find((x) => typeof x !== "string" || !PACKAGE.test(x.trim()));
    if (odd !== undefined) return `is run with ${JSON.stringify(String(odd).slice(0, 60))}, which is no package as pip names one ("pandas", "pandas==2.2.3")`;
  }
  return "";
}

/**
 * What is wrong with one source, as the words after its name; "" where nothing is.
 * @param {unknown} s
 */
function sourceFault(s) {
  if (!isObject(s)) return 'is no object: a source is {"command":["npx","wrangler","deployments","list","--json"],"every":"2m"}';
  const given = KINDS.filter((k) => s[k] != null);
  if (given.length > 1) return `has a ${given[0]} and a ${given[1]}: a source reads one of them`;
  if (s.fetch != null) {
    const fault = fetchFault(s.fetch);
    if (fault) return fault;
    const as = s.fetch.as || "json";
    if (as === "text" && (s.rows != null || s.columns != null)) return "reads text: give fields for its tab-separated lines, or none for a row per line ({line}) — rows and columns read JSON";
    if (as !== "text" && s.fields != null) return `reads ${as === "rss" ? "a feed" : "JSON"}: give rows and columns, not fields`;
  } else if (s.folder != null) {
    const fault = folderFault(s.folder);
    if (fault) return fault;
    if (s.fields != null || s.rows != null) return "lists a folder, a row per file: give columns of its path, name, kind, size and modified, not fields or rows";
  } else if (s.filament != null) {
    if (typeof s.filament !== "string" || !Object.prototype.hasOwnProperty.call(FILAMENT_READS, s.filament)) return `reads Filament's ${JSON.stringify(s.filament)}: one of ${Object.keys(FILAMENT_READS).join(", ")}`;
    if (s.fields != null || s.rows != null) return "reads Filament's own rows: give columns of them, not fields or rows";
  } else if (s.python != null) {
    const fault = pythonFault(s.python);
    if (fault) return fault;
  } else if (s.tool != null) {
    const fault = toolFault(s.tool);
    if (fault) return fault;
    if (s.fields != null) return "reads a tool, whose answer is data: give rows and columns, not fields";
  } else {
    const argv = s.command;
    if (!Array.isArray(argv) || !argv.length) return 'has no command: a list of the program and its arguments, ["gh","pr","list","--json","number,title"] — no shell runs it — or a tool of a connection, a fetch, a folder, filament or python';
    if (argv.length > ARGV_MAX) return `has ${argv.length} parts to its command: ${ARGV_MAX} at most`;
    const bad = argv.findIndex((a) => typeof a !== "string" || a.length > 1000 || /[\0\r\n]/.test(a));
    if (bad >= 0) return `has a command whose part ${bad + 1} is no line of text (1000 characters at most)`;
    if (!argv[0].trim()) return "has a command with no program first";
  }
  for (const k of ["rows", "key", "order"]) if (s[k] != null && typeof s[k] !== "string") return `has ${k} that is no text`;
  if (s.columns != null) {
    if (!isObject(s.columns) || !Object.keys(s.columns).length) return 'has columns that are no object of each column\'s path: {"when":"created_on","version":"versions.0.version_id"}';
    const odd = Object.entries(s.columns).find(([c, p]) => !NAME.test(c) || typeof p !== "string" || !p.trim());
    if (odd) return `has the column ${JSON.stringify(odd[0])}, which needs a name of letters, digits, - and _ and a path in its rows`;
  }
  if (s.fields != null) {
    if (!Array.isArray(s.fields) || !s.fields.length || s.fields.some((f) => typeof f !== "string" || !NAME.test(f))) return "has fields that are no list of column names (letters, digits, - and _)";
    if (s.columns != null || s.rows != null) return "has fields — tab-separated lines — and columns or rows, which read JSON: give one or the other";
    if (typeof s.key === "string" && s.key && !s.fields.includes(s.key)) return `is keyed by ${s.key}, which is none of its fields (${s.fields.join(", ")}): a line's key is one of its fields`;
  }
  const order = typeof s.order === "string" ? s.order.replace(/^-/, "") : "";
  const cols = columnsOf(s);
  if (order && cols && !cols.includes(order)) return `is ordered by ${order}, which is none of its columns (${cols.join(", ")})`;
  if (s.every != null) {
    const ms = everyMs(s.every);
    if (ms == null) return `has every ${JSON.stringify(s.every)}: give it as "90s", "2m" or "1h"`;
    if (ms < EVERY_MIN_MS) return `reads every ${everyWords(ms)}: a minute at least`;
  }
  return "";
}

/** A source's columns, by its columns or its fields; null where its rows give their own. @param {any} s @returns {string[] | null} */
export function columnsOf(s) {
  if (isObject(s?.columns)) return Object.keys(s.columns);
  if (Array.isArray(s?.fields)) return s.fields.map(String);
  return null;
}

/**
 * What is wrong with one watch, as the words after its place; "" where nothing is.
 * @param {unknown} w @param {Record<string, any>} sources
 */
function watchFault(w, sources) {
  if (!isObject(w)) return 'is no object: a watch is {"from":"runs","new":true,"match":{"status":"failure"},"says":"CI failed: run {row.run}"}';
  const names = Object.keys(sources);
  if (typeof w.from !== "string" || !Object.prototype.hasOwnProperty.call(sources, w.from))
    return `${w.from == null ? "has no from" : `reads ${w.from}`}: it watches one of the sources${names.length ? ` (${names.join(", ")})` : ", and there are none"}`;
  const cols = columnsOf(sources[w.from]);
  const isNew = w.new === true;
  const changes = typeof w.changes === "string" ? w.changes : null;
  if (isNew === !!changes) return 'has no rule, or two: give "new": true (rows not seen before) or "changes": a column of its first row';
  if (changes && cols && !cols.includes(changes)) return `watches ${changes}, which ${w.from} does not have (${cols.join(", ")})`;
  if (w.match != null) {
    if (!isObject(w.match) || Object.values(w.match).some((v) => !isScalar(v))) return 'has a match that is no object of a column and its value: {"status":"failure"}';
    const gone = cols ? Object.keys(w.match).find((c) => !cols.includes(c)) : undefined;
    if (gone) return `matches ${gone}, which ${w.from} does not have (${/** @type {string[]} */ (cols).join(", ")})`;
  }
  if (typeof w.says !== "string" || !w.says.trim() || w.says.length > 200) return 'has no says: the line it writes, 200 characters at most, with {row.<column>} for a value ("CI failed on main: run {row.run}")';
  if (w.to != null && !WATCH_TO.includes(w.to)) return `goes to ${JSON.stringify(w.to)}: a watch writes in what-happened, or a row in needs-you`;
  if (w.every != null) {
    const ms = everyMs(w.every);
    if (ms == null) return `has every ${JSON.stringify(w.every)}: give it as "10m" or "1h"`;
    if (ms < EVERY_MIN_MS) return `looks every ${everyWords(ms)}: a minute at least`;
  }
  return "";
}

/**
 * A Dashboard's sources, watches and buttons from a publish (SG-D6, SG-D9, SG-D11), as given, or what is wrong, in
 * words that name the part. A table of the same name as a source holds its sample rows: what the agent read, which a
 * draft shows.
 * @param {any} input  the publish's `sources`, `watch` and `actions`
 * @returns {{ ok: true, sources: Record<string, any> | null, watch: any[] | null, actions: Record<string, any> | null } | { ok: false, error: string }}
 */
export function sourcesOf(input) {
  const sources = input?.sources ?? null;
  const watch = input?.watch ?? null;
  const actions = input?.actions ?? null;
  if (sources != null) {
    if (!isObject(sources)) return { ok: false, error: 'sources is an object of named sources: {"deploys":{"command":["npx","wrangler","deployments","list","--json"]}}' };
    for (const [name, s] of Object.entries(sources)) {
      if (!NAME.test(name)) return { ok: false, error: `the source "${name}" needs a name of letters, digits, - and _ (40 at most)` };
      const fault = sourceFault(s);
      if (fault) return { ok: false, error: `the source ${name} ${fault}` };
    }
  }
  if (watch != null) {
    if (!Array.isArray(watch)) return { ok: false, error: "watch is a list of watches, each over one source" };
    /** @type {Map<string, number>} */
    const keys = new Map();
    for (let i = 0; i < watch.length; i++) {
      const fault = watchFault(watch[i], sources || {});
      if (fault) return { ok: false, error: `watch ${i + 1} ${fault}` };
      // What a watch saw is kept under its source, rule and match: two of the same would share it, and one would never
      // write (found by the Hunter on S2).
      const key = watchKeyOf(watchKept(watch[i]));
      const same = keys.get(key);
      if (same != null) return { ok: false, error: `watch ${i + 1} is watch ${same + 1} again — the same source, rule and match —: make them one watch, or tell them apart by match` };
      keys.set(key, i);
    }
  }
  if (actions != null) {
    if (!isObject(actions)) return { ok: false, error: 'actions is an object of named buttons: {"rollback":{"label":"Roll back to this…","on":"deploys","command":["npx","wrangler","rollback","{row.version}"],"says":"Roll back to {row.version}?"}}' };
    for (const [name, a] of Object.entries(actions)) {
      if (!NAME.test(name)) return { ok: false, error: `the button "${name}" needs a name of letters, digits, - and _ (40 at most)` };
      const fault = actionFault(a, sources || {});
      if (fault) return { ok: false, error: `the button ${name} ${fault}` };
    }
  }
  return {
    ok: true,
    sources: sources && Object.keys(sources).length ? sources : null,
    watch: watch && watch.length ? watch : null,
    actions: actions && Object.keys(actions).length ? actions : null,
  };
}

/** A tool as kept: its connection, its name and its args. @param {any} t @returns {Tool} */
const toolKept = (t) => ({ connection: String(t.connection), name: String(t.name), args: isObject(t.args) ? JSON.parse(JSON.stringify(t.args)) : {} });

/** A fetch as kept: its address, its headers, how its answer reads. @param {any} f @returns {Fetch} */
const fetchKept = (f) => ({
  url: String(f.url).trim(),
  headers: isObject(f.headers) ? Object.fromEntries(Object.entries(f.headers).map(([k, v]) => [k, String(v)])) : {},
  as: FETCH_AS.includes(f.as) ? f.as : "json",
});
/** A folder read as kept. @param {any} f @returns {FolderRead} */
const folderKept = (f) => ({ path: String(f.path).trim().replace(/\\/g, "/") || ".", match: typeof f.match === "string" ? f.match.trim() : "", depth: Number.isInteger(f.depth) ? f.depth : 1 });
/** A Python read as kept. @param {any} p @returns {PythonRead} */
const pythonKept = (p) => ({
  script: String(p.script).trim().replace(/\\/g, "/"),
  args: Array.isArray(p.args) ? p.args.map(String) : [],
  with: Array.isArray(p.with) ? p.with.map((x) => String(x).trim()) : [],
});

/** A source as kept, its defaults filled. @param {any} s @returns {Source} */
export function sourceKept(s) {
  return {
    command: Array.isArray(s.command) ? s.command.map(String) : [],
    tool: s.tool != null ? toolKept(s.tool) : null,
    fetch: s.fetch != null ? fetchKept(s.fetch) : null,
    folder: s.folder != null ? folderKept(s.folder) : null,
    filament: typeof s.filament === "string" ? s.filament : null,
    python: s.python != null ? pythonKept(s.python) : null,
    rows: typeof s.rows === "string" ? s.rows : "",
    key: typeof s.key === "string" ? s.key : "",
    order: typeof s.order === "string" ? s.order : "",
    columns: isObject(s.columns) ? { ...s.columns } : null,
    fields: Array.isArray(s.fields) ? s.fields.map(String) : null,
    every: everyMs(s.every) ?? SOURCE_EVERY_MS,
  };
}

/** A watch as kept, its defaults filled. @param {any} w @returns {Watch} */
export function watchKept(w) {
  return {
    from: String(w.from),
    rule: w.new === true ? "new" : "changes",
    column: w.new === true ? "" : String(w.changes),
    match: isObject(w.match) ? { ...w.match } : {},
    says: String(w.says),
    to: typeof w.to === "string" ? w.to : WATCH_TO[0],
    every: everyMs(w.every) ?? WATCH_EVERY_MS,
  };
}

/**
 * What a Keep lets one source read: its one call and how often. A command's and a tool's read as they did before the
 * other kinds, so what was kept stays kept.
 * @param {Source} k @returns {GrantSource}
 */
export function grantSource(k) {
  if (k.tool) return { tool: k.tool, every: k.every };
  if (k.fetch) return { fetch: k.fetch, every: k.every };
  if (k.folder) return { folder: k.folder, every: k.every };
  if (k.filament) return { filament: k.filament, every: k.every };
  if (k.python) return { python: k.python, every: k.every };
  return { command: k.command, every: k.every };
}

/** The secrets a fetch names in its address and headers, each once. @param {Fetch | null | undefined} f @returns {string[]} */
export function fetchSecrets(f) {
  if (!f) return [];
  const texts = [f.url, ...Object.values(f.headers || {})];
  return [...new Set(texts.flatMap((t) => [...String(t).matchAll(SECRET_REF)].map((m) => m[1])))];
}

/**
 * The argv a Python read runs: uv, with no project of its own and only the packages it names, running the script with
 * its arguments. @param {PythonRead} p @param {string} uv  uv's path
 */
export const pythonArgv = (p, uv) => [uv, "run", "--no-project", "--quiet", ...p.with.flatMap((w) => ["--with", w]), "python", p.script, ...p.args];

/** A file whose name says it is code a command runs: a script, as against the data it reads. */
export const SCRIPT_FILE = /\.(c?js|mjs|[cm]?ts|[jt]sx|pyw?|sh|bash|zsh|ps1|psm1|cmd|bat|rb|pl|php|lua|r|jl)$/i;
/** A part a row's value, an answer or a tool's argument fills. */
const FILLED = /\{(row|ask|args)\.[A-Za-z0-9_-]+\}/;
/**
 * The parts of a command that may name a script of the project, whose bytes a Keep pins (services/dashboard-runner.js):
 * its program, and each argument named as code (.js, .py, .sh, …); a Python read's script. A data file it reads is not
 * one, nor a part a row's value fills, which no Keep sees.
 * @param {{ command?: string[], python?: PythonRead | null }} x  a source or a button, as kept or granted
 * @returns {string[]}
 */
export function scriptParts(x) {
  if (x.python) return [x.python.script];
  return (x.command || []).filter((part, i) => !!part && !FILLED.test(part) && (i === 0 || SCRIPT_FILE.test(part)));
}
/** Each part of a grant's commands that may name a script: its sources', its buttons', its tools'. @param {Grant} g @returns {string[]} */
export const grantScriptParts = (g) => [...new Set([...Object.values(g.sources), ...Object.values(g.actions), ...Object.values(g.tools || {})].flatMap(scriptParts))];

/**
 * What a source reads, in words, as a Keep, an agent and a failure name it: its command, its tool call, "GET <url>",
 * a folder's files, Filament's rows or its script.
 * @param {Partial<Source> | GrantSource} s
 */
export function sourceWords(s) {
  if (s.tool) return toolWords(s.tool);
  if (s.fetch) {
    const h = Object.keys(s.fetch.headers || {});
    return `GET ${s.fetch.url}${h.length ? ` with ${h.join(", ")}` : ""}${s.fetch.as === "rss" ? ", a feed" : s.fetch.as === "text" ? ", as text" : ""}`;
  }
  if (s.folder) return `the files in ${s.folder.path}${s.folder.match ? ` named ${s.folder.match}` : ""}${s.folder.depth > 1 ? `, ${s.folder.depth} deep` : ""}`;
  if (s.filament) return `Filament's ${s.filament}`;
  if (s.python) return `python ${argvWords([s.python.script, ...s.python.args])}${s.python.with.length ? ` with ${s.python.with.join(", ")}` : ""}, through uv`;
  return argvWords(s.command || []);
}

/**
 * What a Keep lets a dashboard's content do (SG-D7, SG-D11): each source's exact command and how often, each watch's
 * source, rule and how often, each button's command, rows, checks and fields' bounds. Its tiles, words and paths are
 * not in it: a version that changes only those goes live at once.
 * @param {unknown} content  a Dashboard's content, as kept
 * @returns {Grant}
 */
export function grantOf(content) {
  const c = /** @type {any} */ (content);
  /** @type {Grant} */
  const g = { sources: {}, watch: [], actions: {} };
  if (isObject(c?.sources))
    for (const [name, s] of Object.entries(c.sources)) g.sources[name] = grantSource(sourceKept(s));
  if (Array.isArray(c?.watch))
    for (const w of c.watch) {
      const k = watchKept(w);
      g.watch.push({ from: k.from, rule: k.rule, column: k.column, match: k.match, to: k.to, every: k.every });
    }
  if (isObject(c?.actions))
    for (const [name, a] of Object.entries(c.actions)) {
      const k = actionKept(a);
      g.actions[name] = {
        on: k.on, only: k.only, except: k.except, ...(k.tool ? { tool: k.tool } : { command: k.command }), check: k.check, ask: k.ask.map((f) => ({ name: f.name, choices: f.choices, from: f.from })), secondLook: k.secondLook,
        // What it does is kept too (10-29): a later version that says it otherwise is a draft until kept again.
        ...(k.effect !== "writes" ? { effect: k.effect } : {}),
      };
    }
  // An app's secrets (10-29): a version that asks for another is a draft until kept again.
  if (isObject(c?.secrets) && Object.keys(c.secrets).length) g.secrets = Object.keys(c.secrets).sort();
  // Its hooks (phase 4): a version that takes POSTs into another collection is a draft until kept again.
  if (isObject(c?.hooks) && Object.keys(c.hooks).length) g.hooks = Object.keys(c.hooks).sort();
  // Its tools (the owner's of 11-05): a version whose tool runs another command, takes other arguments or does more is a
  // draft until kept again; a description changed alone is words.
  if (isObject(c?.tools) && Object.keys(c.tools).length) g.tools = Object.fromEntries(Object.keys(c.tools).sort().map((n) => [n, grantToolOf(c.tools[n])]));
  return g;
}
/**
 * A watch's own name across versions: its source, its rule and its match — what it saw is kept under it.
 * @param {{ from: string, rule: string, column: string, match: Record<string, unknown> }} w
 */
export const watchKeyOf = (w) => `${w.from}|${w.rule}|${w.column}|${JSON.stringify(w.match)}`;
/** Whether a dashboard reads or watches anything by itself — or, an app, takes POSTs (phase 4). @param {Grant} g */
export const grantsAny = (g) => Object.keys(g.sources).length > 0 || !!g.hooks?.length;
/** Whether two grants promise the same. @param {Grant | null | undefined} a @param {Grant | null | undefined} b */
export const sameGrant = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/**
 * A value at a dotted path: "versions.0.version_id"; "" is the value itself.
 * @param {unknown} v @param {string} path
 */
export function at(v, path) {
  if (!path) return v;
  let cur = /** @type {any} */ (v);
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : undefined;
  }
  return cur;
}
/**
 * A row's value as a table shows it: a scalar as it is, anything else as JSON, hidden by `hide` before it is cut.
 * @param {unknown} v @param {(t: string) => string} hide
 */
const cellOf = (v, hide) => (v === undefined ? null : isScalar(v) ? v : hide(JSON.stringify(v)).slice(0, 500));

/** The key that names a row. */
export const ROW_KEY = "__key";

/** No secret to hide: `rowsFrom`'s own, so it knows to read JSON's numbers as they are. @param {string} t */
const same = (t) => t;
/** A JSON number as it is written. */
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
/**
 * JSON text with each number that holds a secret, as the answer wrote it, made the hidden words in a string — read, a
 * number is no longer its digits past 2^53 or below 1e-6 (found by the review of 10-29) —; strings are left for `hide`
 * after they are read, escapes undone. One pass, an unclosed string read to the end.
 * @param {string} text @param {(t: string) => string} hide
 */
function numbersHidden(text, hide) {
  /** @type {string[]} */
  const parts = [];
  let from = 0;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // A string: past its closing quote, each escape stepped over.
      for (i++; i < text.length && text.charCodeAt(i) !== 34; i++) if (text.charCodeAt(i) === 92) i++;
      i++;
    } else if (c === 45 || (c >= 48 && c <= 57)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      if (!m) {
        i++;
        continue;
      }
      const hid = hide(m[0]);
      if (hid !== m[0]) {
        parts.push(text.slice(from, i), JSON.stringify(hid));
        from = i + m[0].length;
      }
      i += m[0].length;
    } else i++;
  }
  return parts.length ? parts.join("") + text.slice(from) : text;
}

/**
 * A command's output read into rows by its source (SG-D6): tab-separated lines by `fields`, else JSON — its list at
 * `rows`, each item's columns at their paths (or its own fields), named by `key`, ordered by `order`, the first
 * `SOURCE_ROWS_MAX` kept. Or what is wrong, in words.
 * @param {string} out  what the command wrote on stdout @param {Source} s
 * @param {(t: string) => string} [hide]  an app's secrets hidden in a text before it is cut: a feed's as it is made plain,
 *   a value of JSON's as it is written for its cell (found reviewing the Space work, 10-29)
 * @returns {{ ok: true, rows: Record<string, unknown>[] } | { ok: false, error: string }}
 */
export function rowsFrom(out, s, hide = same) {
  /** @type {Record<string, unknown>[]} */
  let rows;
  if (s.fields) {
    const fields = s.fields;
    rows = out
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        // Hidden before it is cut at its tabs: a secret holding one would stand in two cells, neither it.
        const parts = hide(l).split("\t");
        /** @type {Record<string, unknown>} */
        const r = Object.fromEntries(fields.map((f, i) => [f, parts[i] ?? null]));
        // Its key is one of its fields: a button's press and a watch name the row by it, as a JSON row's.
        if (s.key) r[ROW_KEY] = String(r[s.key] ?? "");
        return r;
      });
  } else {
    /** @type {unknown[]} */
    let list;
    if (s.fetch?.as === "rss") {
      // A feed's items, each its id, feed, title, link, date and text (more reads, 10-29).
      const feed = feedRows(out, s.fetch.url, hide);
      if (!feed.ok) return feed;
      list = feed.rows;
    } else if (s.fetch?.as === "text") list = out.split(/\r?\n/).filter((l) => l.trim()).map((line) => ({ line }));
    else {
      let json;
      try {
        json = JSON.parse(hide === same ? out : numbersHidden(out, hide));
      } catch {
        // Hidden before it is cut, as every text here is.
        const said = hide(out.trim());
        const head = said.slice(0, 120);
        return { ok: false, error: head ? `it said words, not JSON: “${head}${said.length > 120 ? "…" : ""}”` : "it said nothing" };
      }
      const found = at(json, s.rows);
      if (!Array.isArray(found)) return { ok: false, error: s.rows ? `its rows (${s.rows}) are no list` : "it said no list: name where the list is by rows" };
      list = found;
    }
    rows = list.map((item) => {
      /** @type {Record<string, unknown>} */
      const r = {};
      if (s.columns) for (const [c, p] of Object.entries(s.columns)) r[c] = cellOf(at(item, p), hide);
      else if (isObject(item)) for (const [c, v] of Object.entries(item)) r[c] = cellOf(v, hide);
      else r.value = cellOf(item, hide);
      if (s.key) r[ROW_KEY] = String(at(item, s.key) ?? "");
      return r;
    });
  }
  if (s.order) {
    const desc = s.order.startsWith("-");
    const col = s.order.replace(/^-/, "");
    const num = (/** @type {unknown} */ v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : null);
    rows.sort((a, b) => {
      const x = a[col];
      const y = b[col];
      const nx = num(x);
      const ny = num(y);
      const c = nx != null && ny != null ? nx - ny : String(x ?? "").localeCompare(String(y ?? ""));
      return desc ? -c : c;
    });
  }
  return { ok: true, rows: rows.slice(0, SOURCE_ROWS_MAX) };
}

/** A row's own name: its key, else its columns. @param {Record<string, unknown>} r */
export const rowKey = (r) => (typeof r[ROW_KEY] === "string" && r[ROW_KEY] ? String(r[ROW_KEY]) : JSON.stringify(Object.entries(r).filter(([c]) => c !== ROW_KEY)));

/**
 * Words with a row's values in them: {row.<column>}, and {row.key} for its key; a value cut at 80 characters.
 * @param {string} words @param {Record<string, unknown>} row
 */
export function filled(words, row) {
  return words.replace(/\{row\.([A-Za-z0-9_-]+)\}/g, (_, c) => {
    const v = c === "key" ? row[ROW_KEY] ?? row.key : row[c];
    const s = v == null ? "—" : String(v);
    return s.length > 80 ? `${s.slice(0, 79)}…` : s;
  });
}

/** Whether a row is one a watch counts: each column of its match equal. @param {Record<string, unknown>} row @param {Record<string, unknown>} match */
const matches = (row, match) => Object.entries(match).every(([c, v]) => row[c] === v || (row[c] != null && v != null && String(row[c]) === String(v)));
/** The same, for a Space's lanes fed by a source (space-feeds.js, S4c): a line's red and green. */
export const matchesRow = matches;

/**
 * @typedef {{ keys?: string[], value?: string, at: number }} WatchSeen  what a watch last saw: the rows' keys, or the
 *   column's value
 */

/**
 * A watch's news between what it saw and the rows now (SG-D9): `new`, a line for each row that matches and was not
 * seen (`WATCH_LINES` at most, then how many more); `changes`, a line when the first row's column moved. With nothing
 * seen yet it only learns: no line. `more`: how many it counted past its lines, which a row in Needs you says on its
 * last (S5a).
 * @param {WatchSeen | null | undefined} seen @param {Record<string, unknown>[]} rows @param {Watch} w @param {number} now
 * @returns {{ lines: string[], seen: WatchSeen, more: number }}
 */
export function watchNews(seen, rows, w, now) {
  if (w.rule === "changes") {
    const first = rows[0];
    const value = first ? JSON.stringify(first[w.column] ?? null) : "";
    const moved = !!seen && seen.value !== undefined && first && value !== seen.value && matches(first, w.match);
    return { lines: moved ? [filled(w.says, first)] : [], seen: { value, at: now }, more: 0 };
  }
  const keys = rows.map(rowKey);
  const known = new Set(seen?.keys || []);
  const fresh = seen ? rows.filter((r, i) => !known.has(keys[i]) && matches(r, w.match)) : [];
  const lines = fresh.slice(0, WATCH_LINES).map((r) => filled(w.says, r));
  const more = Math.max(0, fresh.length - WATCH_LINES);
  if (more) lines.push(`… and ${more} more like it`);
  return { lines, seen: { keys: [...new Set([...keys, ...(seen?.keys || [])])].slice(0, SEEN_KEYS_MAX), at: now }, more };
}

/**
 * A watch's rule in words, as a row it brings to Needs you says why (S5a; the page's `ruleWords`, lower case): "a new
 * row of runs where status is failure", "the first row's version of deploys changes".
 * @param {Watch} w
 */
export function watchRuleWords(w) {
  const where = Object.entries(w.match || {}).map(([c, v]) => `${c} is ${v === null ? "empty" : String(v)}`);
  const m = where.length ? ` where ${where.join(" and ")}` : "";
  return w.rule === "new" ? `a new row of ${w.from}${m}` : `the first row's ${w.column} of ${w.from} changes${m}`;
}

/** The most fields a button's form asks, and the most choices one field offers. */
export const ASK_MAX = 6;
export const CHOICES_MAX = 30;
/** A placeholder in a button's command or words: a row's column, its key, or a field of its form. */
const PLACEHOLDER = /\{(row|ask)\.([A-Za-z0-9_-]+)\}/g;

/**
 * @typedef {{ name: string, label: string, required: boolean, choices: string[] | null,
 *   from: { source: string, column: string } | null }} AskField  a field of a button's form: words, one of its choices,
 *   or one of another source's column's values
 * @typedef {{ label: string, on: string, only: Record<string, unknown> | null, except: Record<string, unknown> | null,
 *   command: string[], tool: Tool | null, check: Record<string, string>, ask: AskField[], says: string,
 *   secondLook: boolean, verify: string, effect: Effect }} Action  a button on a source's rows as kept (SG-D11): its label,
 *   the source it acts on, which rows get it, its command with its placeholders — or its tool, whose args' values hold
 *   them (S4a) —, a pattern per placeholder, its form, its sentence, whether its sheet takes a second look; `verify`,
 *   what an agent looks for once it ran (S5d: its sheet's check ticked; "" none) — words for a read-only agent, so no
 *   part of a Keep —; `effect`, what it does (the Space Apps plan of 10-29)
 * @typedef {"keeps" | "writes" | "sends"} Effect  what a button does: `keeps` changes the app's own data alone, and runs
 *   as you press it, with no sheet; `writes` changes files or programs on this machine (every button before effects);
 *   `sends` leaves this machine — an agent's press of it always asks you, unless you let agents press it
 */
/** How long a button's `verify` may be. */
export const VERIFY_MAX = 300;
/** What a button may do, `writes` where it says nothing. */
export const EFFECTS = Object.freeze(/** @type {const} */ (["keeps", "writes", "sends"]));

/** The placeholders in a list of words, each once: "row.version", "ask.why". @param {string[]} parts */
const placeholdersIn = (parts) => [...new Set(parts.flatMap((p) => [...p.matchAll(PLACEHOLDER)].map((m) => `${m[1]}.${m[2]}`)))];
/** A value that is one placeholder whole: "{row.key}". */
const WHOLE_PLACEHOLDER = /^\{(row|ask)\.([A-Za-z0-9_-]+)\}$/;
/** Every text of a JSON value, however deep. @param {unknown} v @returns {string[]} */
const textsIn = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(textsIn) : isObject(v) ? Object.values(v).flatMap(textsIn) : []);
/**
 * A JSON value with each text that is one placeholder whole put through `fill`; the rest as it is.
 * @param {unknown} v @param {(kind: string, name: string, whole: string) => unknown} fill @returns {unknown}
 */
const filledIn = (v, fill) => {
  if (typeof v === "string") {
    const m = WHOLE_PLACEHOLDER.exec(v);
    return m ? fill(m[1], m[2], v) : v;
  }
  if (Array.isArray(v)) return v.map((x) => filledIn(x, fill));
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, filledIn(x, fill)]));
  return v;
};

/**
 * What is wrong with one button, as the words after its name; "" where nothing is.
 * @param {unknown} a @param {Record<string, any>} sources
 */
function actionFault(a, sources) {
  if (!isObject(a)) return 'is no object: a button is {"label":"Roll back to this…","on":"deploys","command":["npx","wrangler","rollback","{row.version}"]}';
  if (typeof a.label !== "string" || !a.label.trim() || a.label.length > 60) return "has no label: the button's words, 60 characters at most";
  const names = Object.keys(sources);
  if (typeof a.on !== "string" || !Object.prototype.hasOwnProperty.call(sources, a.on))
    return `${a.on == null ? "has no on" : `acts on ${a.on}`}: it acts on the rows of one of the sources${names.length ? ` (${names.join(", ")})` : ", and there are none"}`;
  const source = sources[a.on];
  if (typeof source.key !== "string" || !source.key) return `acts on ${a.on}, whose rows have no key: give ${a.on} a key — the path that names a row — so a press names its row`;
  /** The words its placeholders stand in: its command's parts, or its tool's args' texts. @type {string[]} */
  let parts;
  if (a.tool != null) {
    if (a.command != null) return "has a command and a tool: a button runs one of them";
    const fault = toolFault(a.tool);
    if (fault) return fault;
    parts = textsIn(a.tool.args ?? {});
    const split = parts.find((t) => /\{(row|ask)\./.test(t) && !WHOLE_PLACEHOLDER.test(t));
    if (split) return `has ${JSON.stringify(split.slice(0, 60))} in its tool's args: a placeholder fills a whole value, {row.<column>}, {row.key} or {ask.<field>} alone`;
  } else {
    const argv = a.command;
    if (!Array.isArray(argv) || !argv.length) return 'has no command: a list of the program and its arguments, ["npx","wrangler","rollback","{row.version}"] — no shell runs it — or a tool of a connection';
    if (argv.length > ARGV_MAX) return `has ${argv.length} parts to its command: ${ARGV_MAX} at most`;
    const bad = argv.findIndex((x) => typeof x !== "string" || x.length > 1000 || /[\0\r\n]/.test(x));
    if (bad >= 0) return `has a command whose part ${bad + 1} is no line of text (1000 characters at most)`;
    if (!argv[0].trim() || /\{(row|ask)\./.test(argv[0])) return "has a command with no program first: the program is written out, never a placeholder";
    parts = argv;
  }
  const cols = columnsOf(source);
  for (const k of ["only", "except"]) {
    const m = a[k];
    if (m == null) continue;
    if (!isObject(m) || !Object.keys(m).length || Object.values(m).some((v) => !isScalar(v))) return `has ${k} that is no object of a column and its value: {"status":"failure"}`;
    const gone = cols ? Object.keys(m).find((c) => !cols.includes(c)) : undefined;
    if (gone) return `has ${k} on ${gone}, which ${a.on} does not have (${/** @type {string[]} */ (cols).join(", ")})`;
  }
  const ask = a.ask ?? [];
  if (!Array.isArray(ask) || ask.length > ASK_MAX) return `has ask that is no list of fields (${ASK_MAX} at most)`;
  /** @type {string[]} */
  const fields = [];
  for (let i = 0; i < ask.length; i++) {
    const f = ask[i];
    const at = `has field ${i + 1}`;
    if (!isObject(f) || typeof f.name !== "string" || !NAME.test(f.name)) return `${at} with no name of letters, digits, - and _: {"name":"why","label":"Why"}`;
    if (fields.includes(f.name)) return `has two fields named ${f.name}`;
    fields.push(f.name);
    if (typeof f.label !== "string" || !f.label.trim() || f.label.length > 120) return `${at} (${f.name}) with no label: the words over it, 120 characters at most`;
    if (f.required != null && typeof f.required !== "boolean") return `${at} (${f.name}) whose required is neither true nor false`;
    if (f.choices != null && f.from != null) return `${at} (${f.name}) with choices and from: give one or the other`;
    if (f.choices != null && (!Array.isArray(f.choices) || !f.choices.length || f.choices.length > CHOICES_MAX || f.choices.some((c) => typeof c !== "string" || !c || c.length > 200)))
      return `${at} (${f.name}) whose choices are no list of words (${CHOICES_MAX} at most)`;
    if (f.from != null) {
      const fs = f.from;
      if (!isObject(fs) || typeof fs.source !== "string" || !Object.prototype.hasOwnProperty.call(sources, fs.source) || typeof fs.column !== "string")
        return `${at} (${f.name}) whose from is no source and column of this dashboard: {"source":"branches","column":"name"}`;
      const fc = columnsOf(sources[fs.source]);
      if (fc && !fc.includes(fs.column)) return `${at} (${f.name}) whose from reads ${fs.column}, which ${fs.source} does not have (${fc.join(", ")})`;
    }
  }
  if (typeof a.says !== "string" || !a.says.trim() || a.says.length > 300) return 'has no says: the sheet\'s sentence, 300 characters at most, with {row.<column>} for a value ("Roll back to {row.version}?")';
  for (const p of placeholdersIn([...parts, a.says])) {
    const [kind, name] = p.split(".");
    if (kind === "ask" && !fields.includes(name)) return `has {${p}}, a field its ask does not have${fields.length ? ` (${fields.join(", ")})` : ""}`;
    if (kind === "row" && name !== "key" && cols && !cols.includes(name)) return `has {${p}}, a column ${a.on} does not have (${cols.join(", ")})`;
  }
  if (a.check != null) {
    if (!isObject(a.check)) return 'has check that is no object of a placeholder and its pattern: {"row.version":"^[0-9a-f-]{36}$"}';
    const used = placeholdersIn(parts);
    for (const [p, pattern] of Object.entries(a.check)) {
      if (!used.includes(p)) return `checks ${p}, which its ${a.tool != null ? "tool's args do" : "command does"} not use${used.length ? ` (${used.join(", ")})` : ""}`;
      if (typeof pattern !== "string" || !pattern || pattern.length > 200) return `checks ${p} with no pattern (200 characters at most)`;
      try {
        new RegExp(pattern);
      } catch {
        return `checks ${p} with ${JSON.stringify(pattern)}, which is no pattern`;
      }
    }
  }
  if (a.secondLook != null && typeof a.secondLook !== "boolean") return "has secondLook that is neither true nor false";
  if (a.effect != null && !EFFECTS.includes(a.effect))
    return `has the effect ${JSON.stringify(a.effect)}: give "keeps" (it changes the app's own data alone), "writes" (files or programs on this machine) or "sends" (it leaves this machine)`;
  // A keeps button runs as it is pressed: no sheet opens, so nothing it asks, looks at again or checks after.
  if (a.effect === "keeps") {
    const sheetOnly = ["ask", "secondLook", "verify"].find((k) => (k === "ask" ? Array.isArray(a.ask) && a.ask.length > 0 : k === "secondLook" ? a.secondLook === true : a.verify != null));
    if (sheetOnly) return `keeps and has ${sheetOnly}: a keeps button runs as it is pressed, with no sheet — give it "writes" to ask, look again or check`;
  }
  if (a.verify != null && (typeof a.verify !== "string" || !a.verify.trim() || a.verify.length > VERIFY_MAX))
    return `has verify that is no line of words: what an agent looks for once it ran, ${VERIFY_MAX} characters at most`;
  if (typeof a.verify === "string")
    for (const p of placeholdersIn([a.verify])) {
      const [kind, name] = p.split(".");
      if (kind !== "row") return `has {${p}} in verify: it takes {row.<column>} alone`;
      if (name !== "key" && cols && !cols.includes(name)) return `has {${p}} in verify, a column ${a.on} does not have (${cols.join(", ")})`;
    }
  return "";
}

/** A button as kept, its defaults filled. @param {any} a @returns {Action} */
export function actionKept(a) {
  return {
    label: String(a.label),
    on: String(a.on),
    only: isObject(a.only) ? { ...a.only } : null,
    except: isObject(a.except) ? { ...a.except } : null,
    command: a.tool != null ? [] : a.command.map(String),
    tool: a.tool != null ? toolKept(a.tool) : null,
    check: isObject(a.check) ? Object.fromEntries(Object.entries(a.check).map(([k, v]) => [k, String(v)])) : {},
    ask: (Array.isArray(a.ask) ? a.ask : []).map((/** @type {any} */ f) => ({
      name: String(f.name),
      label: String(f.label),
      required: f.required === true,
      choices: Array.isArray(f.choices) ? f.choices.map(String) : null,
      from: isObject(f.from) ? { source: String(f.from.source), column: String(f.from.column) } : null,
    })),
    says: String(a.says),
    secondLook: a.secondLook === true,
    verify: typeof a.verify === "string" ? a.verify.trim() : "",
    effect: EFFECTS.includes(a.effect) ? a.effect : "writes",
  };
}

/** Whether a button shows on a row: each of `only` equal, not all of `except`. @param {Action | GrantAction} a @param {Record<string, unknown>} row */
export const actionOnRow = (a, row) => (!a.only || matches(row, a.only)) && (!a.except || !matches(row, a.except));

/**
 * A button's command filled for one row and the form's answers (SG-D11): each placeholder fills its own part, from the
 * row as Filament read it — never the page's words —, each value checked against its pattern; a value that starts with
 * "-", a required field left empty, an answer that is none of its choices: refused in words. A tool's button (S4a) has
 * its args filled instead (`args`): each placeholder a whole value, a row's number kept a number; no command line reads
 * a value there, so one may start with "-".
 * @param {Action} a @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} answers  the form's fields by name
 * @param {(f: { source: string, column: string }) => string[]} [choicesFrom]  another source's column's values now
 * @param {{ rowOnly?: boolean }} [o]  `rowOnly`: the row's values alone, as a sheet opens — each field stays as its
 *   placeholder, unchecked
 * @returns {{ ok: true, argv: string[], args?: Record<string, unknown> } | { ok: false, error: string }}
 */
export function fillAction(a, row, answers, choicesFrom = () => [], o = {}) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const f of o.rowOnly ? [] : a.ask) {
    const v = answers[f.name] == null ? "" : String(answers[f.name]);
    if (f.required && !v.trim()) return { ok: false, error: `${f.label} is empty: it is needed` };
    if (v && f.choices && !f.choices.includes(v)) return { ok: false, error: `“${v}” is none of ${f.name}'s choices` };
    if (v && f.from && !choicesFrom(f.from).includes(v)) return { ok: false, error: `“${v}” is no ${f.from.column} of ${f.from.source} now` };
    values[`ask.${f.name}`] = v;
  }
  /** @type {string | null} */
  let fault = null;
  if (a.tool) {
    const args = /** @type {Record<string, unknown>} */ (
      filledIn(a.tool.args, (kind, name, whole) => {
        const key = `${kind}.${name}`;
        if (kind === "ask" && o.rowOnly) return whole;
        /** @type {unknown} */
        let v = values[key] ?? "";
        if (kind === "row") {
          v = name === "key" ? row[ROW_KEY] : row[name];
          if (v == null || !isScalar(v)) {
            fault ||= `the row has no ${name === "key" ? "key" : name}`;
            return null;
          }
        }
        const s = String(v);
        if (s.length > 1000) fault ||= `{${key}} is longer than 1000 characters`;
        else if (a.check[key] && !new RegExp(a.check[key]).test(s)) fault ||= `{${key}} is “${s.slice(0, 60)}”, which does not match its check ${a.check[key]}`;
        return v;
      })
    );
    return fault ? { ok: false, error: fault } : { ok: true, argv: [], args };
  }
  const argv = a.command.map((part) =>
    part.replace(PLACEHOLDER, (whole, kind, name) => {
      const key = `${kind}.${name}`;
      let v;
      if (kind === "ask" && o.rowOnly) return whole;
      if (kind === "ask") v = values[key] ?? "";
      else {
        const raw = name === "key" ? row[ROW_KEY] : row[name];
        if (raw == null || !isScalar(raw)) {
          fault ||= `the row has no ${name === "key" ? "key" : name}`;
          return "";
        }
        v = String(raw);
      }
      if (v.startsWith("-")) fault ||= `{${key}} is “${v.slice(0, 40)}”: a value may not start with “-”`;
      else if (/[\0\r\n]/.test(v) || v.length > 1000) fault ||= `{${key}} is no line of text (1000 characters at most)`;
      else if (a.check[key] && !new RegExp(a.check[key]).test(v)) fault ||= `{${key}} is “${v.slice(0, 60)}”, which does not match its check ${a.check[key]}`;
      return v;
    }),
  );
  return fault ? { ok: false, error: fault } : { ok: true, argv };
}

/**
 * A tool call as words (S4a): "github › list_workflow_runs {"owner":"o"}" — what Keep lists, a sheet shows and a line of
 * What happened says ran.
 * @param {Tool} t @param {unknown} [args]  its args filled, where they are
 */
export const toolWords = (t, args = t.args) => `${t.connection} › ${t.name}${args && isObject(args) && Object.keys(args).length ? ` ${JSON.stringify(args)}` : ""}`;

/** The JSON types a schema names, as a list. @param {any} s @returns {string[]} */
const typesOf = (s) => (Array.isArray(s?.type) ? s.type.map(String) : typeof s?.type === "string" ? [s.type] : []);

/**
 * A text as a schema that takes no text takes it (S4a): "8812" an integer or a number, "true" a boolean; else the
 * text as it is — the server says what it refuses. The page's sheet does the same as it shows the call (ui's answerAs).
 * @param {string} s @param {string[]} types  the JSON types the schema takes
 * @returns {unknown}
 */
export function textAs(s, types) {
  if (!types.length || types.includes("string")) return s;
  const t = s.trim();
  if (types.includes("integer") && /^-?\d+$/.test(t) && Number.isSafeInteger(Number(t))) return Number(t);
  if (types.includes("number") && /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (types.includes("boolean") && (t === "true" || t === "false")) return t === "true";
  return s;
}

/**
 * A button's filled args as its tool's input schema takes them (S4a): a row's key and a field's answer are filled as
 * text, so a text where the schema takes no text goes as `textAs` reads it; a number or a boolean where it takes only
 * text goes as its text; an empty answer is left out where the schema takes no text there and does not need it. What
 * the schema does not describe goes as it is.
 * @param {unknown} v @param {any} schema
 * @returns {unknown}
 */
export function argsAsSchema(v, schema) {
  if (!isObject(schema)) return v;
  if (isObject(v)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    const needed = Array.isArray(schema.required) ? schema.required : [];
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const types = typesOf(props[k]);
      if (x === "" && types.length && !types.includes("string") && !needed.includes(k)) continue;
      out[k] = argsAsSchema(x, props[k]);
    }
    return out;
  }
  if (Array.isArray(v)) return isObject(schema.items) ? v.map((x) => argsAsSchema(x, schema.items)) : v;
  const types = typesOf(schema);
  if (typeof v === "string") return textAs(v, types);
  if (typeof v === "number" && types.includes("string") && !types.includes("number") && !(types.includes("integer") && Number.isInteger(v))) return String(v);
  if (typeof v === "boolean" && types.includes("string") && !types.includes("boolean")) return String(v);
  return v;
}

/**
 * The fields whose answer goes where the tool's schema takes no text (S4a): each {ask.<field>} that is a whole value of
 * the args, by its name, with the types it takes there — what a sheet needs to show the call as it will go.
 * @param {unknown} args @param {any} schema
 * @returns {Record<string, string[]>}
 */
export function answerTypes(args, schema) {
  /** @type {Record<string, string[]>} */
  const out = {};
  /** @param {unknown} v @param {any} s */
  const walk = (v, s) => {
    if (typeof v === "string") {
      const m = WHOLE_PLACEHOLDER.exec(v);
      const types = typesOf(s);
      if (m && m[1] === "ask" && types.length && !types.includes("string")) out[m[2]] = types;
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, isObject(s) ? s.items : null));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, isObject(s) && isObject(s.properties) ? s.properties[k] : null);
  };
  walk(args, schema);
  return out;
}

/** How a tool's answer is weighed: in UTF-8 bytes. */
const UTF8 = new TextEncoder();

/**
 * Whether a text weighs more than a source may say (`COMMAND_BYTES`), in UTF-8 bytes: one longer in characters is over
 * at once, and only one that may be is measured. @param {string} text
 */
export const overBytes = (text) => text.length > COMMAND_BYTES || (text.length * 3 > COMMAND_BYTES && UTF8.encode(text).length > COMMAND_BYTES);
/** What is said of a tool's answer that weighs more. */
export const TOO_MUCH = `the tool said more than ${COMMAND_BYTES / 1_048_576} MB`;

/**
 * A tool's answer as a source reads it (S4a, the mock's "How Filament runs it"): its `structuredContent`, else its first
 * text part read as JSON — the data, as JSON text for `rowsFrom` —, or why not, in words: the tool's own error, words
 * that are no data, more than a source may say.
 * @param {any} result  the tools/call result, as the server sent it
 * @returns {CommandOut}
 */
export function toolData(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const text = parts.find((/** @type {any} */ c) => c?.type === "text")?.text;
  if (result?.isError) {
    const said = parts.filter((/** @type {any} */ c) => c?.type === "text").map((/** @type {any} */ c) => String(c.text ?? "")).join(" ").trim();
    return { ok: false, error: `the tool said it failed${said ? `: ${said.slice(0, 300)}` : ""}` };
  }
  let out;
  if (result?.structuredContent !== undefined) out = JSON.stringify(result.structuredContent);
  else if (typeof text === "string") {
    try {
      JSON.parse(text);
      out = text;
    } catch {
      const head = text.trim().slice(0, 120);
      return { ok: false, error: head ? `the tool answered words, not data: “${head}${text.trim().length > 120 ? "…" : ""}”` : "the tool answered nothing" };
    }
  } else return { ok: false, error: "the tool answered no data" };
  // Counted in UTF-8 bytes, as a command's output is (found by the Hunter on S4a: counted in characters, a megabyte of
  // non-ASCII text weighed up to four); a text longer in characters is over at once, and only one that may be is
  // measured.
  if (overBytes(out)) return { ok: false, error: TOO_MUCH };
  return { ok: true, out };
}

/** A command as words, a part with a space or a quote in quotes: what a line of What happened says ran. @param {string[]} argv */
export const argvWords = (argv) => argv.map((x) => (!x || /[\s"]/.test(x) ? JSON.stringify(x) : x)).join(" ");
