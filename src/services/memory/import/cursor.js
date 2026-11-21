// @ts-check
// Cursor's chats: ~/.cursor/projects/<folder name>/agent-transcripts/<chat id>/<chat id>.jsonl, one file per chat →
// one chain per chat. The IDE's own database is not read (the plan's IM-9).
//
// Format observed on disk (keys and shapes only). Three kinds of line, none with an id or a time:
//   { role: "user", message: { content: [{ type: "text", text }] } }
//   { role: "assistant", message: { content: [text | tool_use { name, input }] } }    one line a step of the model
//   { type: "turn_ended", status: "success" | "error" | "aborted", error?: string }    (newer versions)
// A message the person sent is wrapped: `<timestamp>Tuesday, Oct 14, 2026, 6:17 AM (UTC+5)</timestamp>` and
// `<user_query>…</user_query>`, with what Cursor added beside them in tags of its own (`<image_files>`, a numbered
// list of the pictures it saved under the project's folder; `<uploaded_documents>`, `<manually_attached_skills>`,
// `<cursor_commands>`). The other user lines are Cursor's own, each a block in a tag (`<system-reminder>`,
// `<dynamic_tools>`, `<task-notification>`, a timestamp alone). The same message is written again, stamp and all,
// as its turn goes on. No tool result is kept, no model's name, no reasoning. One file seen is of another make: no
// tags and no calls, a user line a message as it stands and a model's line its words, and between the messages a
// todo reminder its harness wrote to the model. A project's folder name is its path with every run of other
// characters as one "-" (`h-filament`); a window with no folder has a number for a name. A chat's folder can hold
// `subagents/` (its sub-agents' transcripts). An agent made through Cursor's SDK is in a folder named `agent-<id>`.
// A chat that went on in another window of Cursor's has a transcript under each project: the same beginning, and the
// one written last the fuller.
//
// A chat is translated, not copied (the plan's §7; `cursorReader` says each rule).
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { ownTurnText } from "../../../core/messages.js";
import { Sink, breather, expandHome, noop, parseJson, pct, previewOf, readLines, scrub, shapeTurn, summary, throwIfStopped, turnFacts, unansweredLine } from "./sink.js";

export const CURSOR_ROOT = join(homedir(), ".cursor", "projects");
/** The agent, as Filament names it on a turn it began by itself and in a fork's title (IM-61). */
const AGENT = "Cursor";
/** The agent's id where a turn was stopped in it (`stopped.by`); the chat and its turns are the harness's (IM-58). */
const CLIENT = "cursor";
/** The folder of an agent made through Cursor's SDK: a program's run, no chat the person had in Cursor. */
const SDK_AGENT = /^agent-/;
/** Filament's own blocks in a message: Filament composed it, so the chat is one of its sessions already. */
const OWN_BLOCK = /<filament-(?:memory|context)[\s>]/;
/** Each of those blocks, whole: what a row's label leaves out. */
const OWN_BLOCKS = /<(filament-[a-z-]+)\b[^>]*>[\s\S]*?<\/\1>\s*/g;

/**
 * Chat files under the root: `<folder name>/agent-transcripts/<id>/<id>.jsonl`. A chat's `subagents/` are its
 * sub-agents' transcripts, and an `agent-<id>` folder is an agent a program made through Cursor's SDK (on a machine
 * with Filament, Filament itself): neither is a chat the person had in Cursor, and neither is listed. A chat with a
 * transcript under more than one project is listed once, by the one written last (the bigger of two written
 * together): where the chat went on.
 * @param {string} root
 */
export function listCursorFiles(root) {
  /** @type {Map<string, { path: string, name: string, id: string, slug: string, mtime: number, size: number }>} */
  const byId = new Map();
  /** @param {string} dir */
  const dirsIn = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      return [];
    }
  };
  for (const p of dirsIn(root))
    for (const d of dirsIn(join(root, p.name, "agent-transcripts"))) {
      if (SDK_AGENT.test(d.name)) continue;
      const path = join(root, p.name, "agent-transcripts", d.name, `${d.name}.jsonl`);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      // To the millisecond: a turn the file stamps no time for, and the chat's last activity, are told by it.
      if (!st.isFile()) continue;
      const file = { path, name: `${d.name}.jsonl`, id: d.name, slug: p.name, mtime: Math.floor(st.mtimeMs), size: st.size };
      const other = byId.get(file.id);
      if (!other || file.mtime > other.mtime || (file.mtime === other.mtime && file.size > other.size)) byId.set(file.id, file);
    }
  return [...byId.values()];
}

/** A folder's name as Cursor writes it into a project's: every run of characters that is no letter or digit one "-". @param {string} s */
const dashed = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
/** How many folders a search for a project's folder may list: a name that fits nothing stops there. */
const FOLDER_LISTS = 2000;
/**
 * The folders projects' names stand for, found on disk in one walk for them all, its folders listed without holding
 * the server: a name says a path with its separators, spaces and dots all as "-", so each folder on the way is tried
 * by its own dashed name, the longest first, and a name goes no deeper once its folder is found. A folder on the way of
 * several names is listed once. Null for a name no folder fits (it was moved or deleted, or the window had none), or
 * that listed `FOLDER_LISTS` folders and found none.
 * @param {readonly string[]} names
 * @param {{ platform?: string }} [o]
 * @returns {Promise<Map<string, string | null>>}
 */
export async function foldersOfNames(names, { platform = process.platform } = {}) {
  /** A name's search: what is left of it where it stands, how many folders it listed, and the folder it found. @typedef {{ name: string, left: string, lists: number, at: string | null }} Search */
  /** @type {Map<string, Search[]>} each drive's searches, or the root's */
  const starts = new Map();
  /** @type {Search[]} */
  const all = [];
  for (const name of new Set(names)) {
    const want = String(name || "").toLowerCase();
    const m = platform === "win32" ? /^([a-z])-(.+)$/.exec(want) : null;
    const [start, rest] = platform === "win32" ? (m ? [`${m[1].toUpperCase()}:\\`, m[2]] : ["", ""]) : ["/", want];
    /** @type {Search} */
    const s = { name, left: rest, lists: 0, at: null };
    all.push(s);
    if (rest) starts.set(start, [...(starts.get(start) || []), s]);
  }
  /** @type {Map<string, Promise<string[] | null>>} each folder's folders, null for one that could not be read */
  const listed = new Map();
  /** @param {string} dir */
  const list = (dir) => {
    let got = listed.get(dir);
    if (!got) {
      got = readdir(dir, { withFileTypes: true }).then(
        (es) => es.filter((e) => e.isDirectory()).map((e) => e.name),
        () => null,
      );
      listed.set(dir, got);
    }
    return got;
  };
  /**
   * The searches standing in `dir`, each its next folder taken in turn, the longest name first: a name that is the
   * folder's whole is found there; a longer one goes into it with what is left, and comes back with its words when
   * nothing there fits.
   * @param {string} dir @param {Search[]} here
   */
  const walk = async (dir, here) => {
    const going = here.filter((s) => ++s.lists <= FOLDER_LISTS);
    if (!going.length) return;
    const folders = await list(dir);
    if (!folders) return;
    const fits = folders
      .map((n) => ({ n, k: dashed(n) }))
      .filter(({ k }) => k)
      .sort((a, b) => b.k.length - a.k.length);
    for (const { n, k } of fits) {
      const into = going.filter((s) => s.at == null && (s.left === k || s.left.startsWith(`${k}-`)));
      for (const s of into) if (s.left === k) s.at = join(dir, n);
      const deeper = into.filter((s) => s.at == null);
      if (!deeper.length) continue;
      const left = deeper.map((s) => s.left);
      for (const s of deeper) s.left = s.left.slice(k.length + 1);
      await walk(join(dir, n), deeper);
      deeper.forEach((s, i) => (s.left = left[i]));
    }
  };
  for (const [start, here] of starts) await walk(start, here);
  return new Map(all.map((s) => [s.name, s.at]));
}

const MONTHS = /** @type {Record<string, number>} */ ({ jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 });
/**
 * The time Cursor stamps a message with ("Tuesday, Oct 14, 2026, 6:17 AM (UTC+5)") in ms: to the minute, in the zone
 * it names; in this computer's where it names none. Null for words that are no such stamp.
 * @param {unknown} stamp
 */
export function stampMs(stamp) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\s*(\((?:UTC|GMT)\s*(?:([+-])(\d{1,2})(?::?(\d{2}))?)?\))?/i.exec(String(stamp ?? ""));
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  if (!m || month == null) return null;
  const hour = m[7] ? (Number(m[4]) % 12) + (/^p/i.test(m[7]) ? 12 : 0) : Number(m[4]);
  const [year, day, minute, second] = [Number(m[3]), Number(m[2]), Number(m[5]), Number(m[6] || 0)];
  if (!m[8]) return new Date(year, month, day, hour, minute, second).getTime();
  const ahead = (Number(m[10] || 0) * 60 + Number(m[11] || 0)) * (m[9] === "-" ? -1 : 1);
  return Date.UTC(year, month, day, hour, minute, second) - ahead * 60_000;
}

/** What stands between a tag's two ends, or null. @param {string} text @param {string} tag */
const inTag = (text, tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? null;
/** A user line's words: its text parts. @param {any} o */
const textOf = (o) =>
  (Array.isArray(o?.message?.content) ? o.message.content : [])
    .map((/** @type {any} */ b) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
/** A reminder a harness writes to its model as a user line, the todo list it keeps after it: no words of the person's. */
const HARNESS_LINE = /The TodoWrite tool hasn't been used recently\./;
/**
 * What a user line is: a message of the person's — its words (between the query's tags, whole, so a message that
 * quotes the tag keeps it), the stamp beside them, the pictures Cursor lists — or null for a line of Cursor's own.
 * A line with no tag at all is a message as it stands, less a harness's reminder from where that begins.
 * @param {string} text
 * @returns {{ words: string, stamp: string | null, pictures: string[] } | null}
 */
function messageOf(text) {
  const q = /<user_query>([\s\S]*)<\/user_query>/.exec(text);
  if (!q) {
    const own = HARNESS_LINE.exec(text);
    const words = (own ? text.slice(0, own.index) : text).trim();
    return !words || /^<[A-Za-z_]/.test(words) ? null : { words, stamp: null, pictures: [] };
  }
  const list = inTag(text.slice(0, q.index), "image_files") ?? "";
  const pictures = list.split("\n").map((l) => /^\s*\d+\.\s+(\S.*?)\s*$/.exec(l)?.[1] ?? "").filter(Boolean);
  return { words: q[1].trim(), stamp: inTag(text.slice(0, q.index), "timestamp")?.trim() ?? null, pictures };
}

const PICTURE_TYPES = /** @type {Record<string, string>} */ ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" });
/** A picture bigger than this is left out of the message it came with. */
const PICTURE_BYTES = 8 << 20;
/**
 * Reads a picture a message names, as the block Filament keeps: only a picture file, and only one under the root —
 * Cursor's own saved copy; a path that leads anywhere else is not followed. Null where there is none to read.
 * @param {string} root @returns {(path: string) => any}
 */
export function pictureUnder(root) {
  const fold = (/** @type {string} */ p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const base = fold(resolve(root)) + sep;
  return (path) => {
    const full = resolve(String(path || ""));
    const type = PICTURE_TYPES[extname(full).toLowerCase()];
    if (!type || !fold(full).startsWith(base)) return null;
    try {
      const st = statSync(full);
      return st.isFile() && st.size <= PICTURE_BYTES ? { type: "image", source: { type: "base64", media_type: type, data: readFileSync(full).toString("base64") } } : null;
    } catch {
      return null;
    }
  };
}

/** The first file a patch names. */
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m;
/** A tool's arguments as an object, whatever Cursor kept them as. @param {unknown} a */
const argsOf = (a) => {
  const o = typeof a === "string" ? parseJson(a) : a;
  return o && typeof o === "object" && !Array.isArray(o) ? o : a != null && a !== "" ? { input: String(a) } : {};
};
/**
 * A call of Cursor's as the call Filament's cards read. Most keep their own name and fields: Filament's vocabulary
 * knows them (Read, Shell, Grep, TodoWrite, Task…). The few it does not read are written as the call Filament uses
 * for the same thing: a replacement is an edit, a patch names its first file, a written file says its content, a
 * file search its pattern and place, a web search its query, and a tool reached through a server (MCP's, or one of
 * Cursor's own tool sets; an older file names one `mcp_<server>_<tool>`) is that server's tool, as Filament names one.
 * @param {string} name @param {unknown} input @returns {{ name: string, input: any }}
 */
function callOf(name, input) {
  const o = input && typeof input === "object" && !Array.isArray(input) ? /** @type {Record<string, any>} */ (input) : null;
  if (name === "StrReplace" && o)
    return { name: "edit", input: { path: String(o.path ?? ""), old_string: String(o.old_string ?? ""), new_string: String(o.new_string ?? ""), ...(o.replace_all ? { replace_all: true } : {}) } };
  if (name === "ApplyPatch") {
    const patch = typeof input === "string" ? input : String(o?.patch ?? o?.input ?? "");
    return { name: "apply_patch", input: { path: PATCH_FILE.exec(patch)?.[1]?.trim() ?? "", patch } };
  }
  if (name === "Write" && o && o.content == null && o.contents != null) {
    const { contents, ...rest } = o;
    return { name, input: { ...rest, content: contents } };
  }
  if (name === "Glob" && o) return { name, input: { pattern: String(o.glob_pattern ?? o.pattern ?? ""), ...(o.target_directory ? { path: String(o.target_directory) } : {}) } };
  if (name === "rg" && o) return { name: "grep", input: o };
  if (name === "WebSearch" && o && o.query == null && o.search_term != null) {
    const { search_term, ...rest } = o;
    return { name, input: { query: search_term, ...rest } };
  }
  if ((name === "CallMcpTool" || name === "CallDynamicTool") && o) {
    const server = String(o.server ?? o.namespace ?? "");
    const tool = String(o.toolName ?? "");
    if (server && tool) return { name: `mcp__${server}__${tool}`, input: argsOf(o.arguments) };
  }
  const mcp = /^mcp_([A-Za-z0-9-]+)_(.+)$/.exec(name);
  return { name: mcp ? `mcp__${mcp[1]}__${mcp[2]}` : name || "tool", input: o ?? (input != null && input !== "" ? { input: String(input) } : {}) };
}

/**
 * Reads a chat's lines into turns, as Filament keeps a chat of its own. `push(line)` gives the turns that line
 * closed; `end()` the one still open. `s` is what the file told of the chat so far.
 *
 * The rules, each a thing Cursor keeps → what Filament keeps for the same thing:
 *   A message of the person's opens a turn: the words between the query's tags, the pictures Cursor lists beside
 *   them (`picture` reads one), the time its stamp says. What Cursor put around them is no message. The same message
 *   again with the same stamp is its turn going on, as Cursor writes it. A line with no tag is a message as it
 *   stands (`messageOf`); a block in a tag of Cursor's own is passed.
 *   Each line of the model is a step of the turn: its words, and its calls as Filament's cards read them (`callOf`),
 *   each with an id of its place in the file (the file has none). No result is kept, so none is written: the turn
 *   reads whole on the page, and a later request carries it as words (app/sessions/shapes.js `trajectoryProblem`).
 *   The model's last words are the answer. A turn's end line ends it: stopped by the person (`meta.stopped`), or
 *   failed with the service's words (`meta.failed`, and `meta.facts.error`, where Filament keeps a turn's failure:
 *   the only number of a turn Cursor's file tells is how many steps its model took). A turn that is over and never answered keeps all it did as work
 *   and answers with Filament's line of how it ended (sink.js `shapeTurn`). Lines of the model where no turn is open
 *   are the agent's own turn (`meta.own`).
 * @param {{ at?: number | null, picture?: ((path: string) => any) | null }} [o]  `at`: the time of a turn the file
 *   stamps none for, until a stamp is read (the file's own time)
 */
export function cursorReader({ at: fileAt = null, picture = null } = {}) {
  /** @type {{ firstAt: number | null, lastAt: number | null, turns: number, lines: number, skipped: number }} */
  const s = { firstAt: null, lastAt: null, turns: 0, lines: 0, skipped: 0 };
  /** @type {any[]} the turns closed since the caller last took them */
  const closed = [];
  /** @type {any} the open turn */
  let cur = null;
  const open = (/** @type {any} */ user, /** @type {number | null} */ at, extra = {}) => {
    cur = { user, at, items: [], stopped: null, failed: null, own: null, said: null, stamp: null, ...extra };
    return cur;
  };
  /** `over`: no more of the turn will come (its end line, or a next message closed it); false where the file simply ends. */
  const close = (over = true) => {
    if (!cur) return;
    const t = cur;
    cur = null;
    s.turns++;
    const meta = {
      format: "anthropic",
      ...(t.own ? { own: t.own } : {}),
      ...(t.stopped ? { stopped: t.stopped } : {}),
      ...(t.failed
        ? { failed: { cause: t.failed }, facts: turnFacts({ calls: t.items.length, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, startedAt: t.at, error: t.failed }) }
        : {}),
    };
    // A failed turn has no answer: what it did is its work, whole.
    const shaped = t.failed
      ? { user: t.user, at: t.at, model: null, work: t.items.map((/** @type {any} */ i) => i.msg), workAt: t.at, final: undefined, endAt: t.at }
      : shapeTurn({ user: t.user, at: t.at, model: null, items: t.items, closing: over || t.stopped ? unansweredLine(AGENT, !!t.stopped) : null });
    closed.push({ ...shaped, meta });
  };
  const take = (/** @type {string} */ raw) => {
    if (!raw.trim()) return;
    s.lines++;
    const o = parseJson(raw);
    if (!o || typeof o !== "object") {
      s.skipped++;
      return;
    }
    if (o.type === "turn_ended") {
      if (!cur) return;
      const error = typeof o.error === "string" ? o.error.trim() : "";
      if (o.status === "aborted" || /^User aborted/i.test(error)) cur.stopped = { by: CLIENT, at: cur.at };
      else if (o.status === "error") cur.failed = error.slice(0, 500) || "the service failed the request";
      close();
      return;
    }
    if (o.role === "user") {
      const said = messageOf(textOf(o));
      if (!said) return;
      if (cur && !cur.own && cur.said === said.words && cur.stamp === said.stamp && said.stamp != null) return;
      close();
      const at = stampMs(said.stamp) ?? s.lastAt ?? fileAt;
      if (at != null) {
        s.firstAt ??= at;
        s.lastAt = at;
      }
      const pictures = picture ? said.pictures.map(picture).filter(Boolean) : [];
      const content = pictures.length ? [...(said.words ? [{ type: "text", text: said.words }] : []), ...pictures] : said.words;
      open({ role: "user", content }, at, { said: said.words, stamp: said.stamp });
      return;
    }
    if (o.role !== "assistant") return;
    /** @type {any[]} */
    const content = [];
    (Array.isArray(o.message?.content) ? o.message.content : []).forEach((/** @type {any} */ b, /** @type {number} */ j) => {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) content.push({ type: "text", text: b.text });
      else if (b?.type === "tool_use") content.push({ type: "tool_use", id: `cu_${s.lines}_${j}`, ...callOf(String(b.name || ""), b.input) });
    });
    if (!content.length) return;
    // The model's lines after nobody's message: the agent went on by itself.
    if (!cur) open({ role: "user", content: [{ type: "text", text: ownTurnText(AGENT, []) }] }, s.lastAt ?? fileAt, { own: { agent: AGENT } });
    cur.items.push({ msg: { role: "assistant", content }, at: cur.at });
  };
  return {
    s,
    /** @param {string} line @returns {any[]} */
    push(line) {
      take(line);
      return closed.splice(0);
    },
    /** @returns {any[]} */
    end() {
      close(false);
      return closed.splice(0);
    },
  };
}
/**
 * A whole chat file's text at once → what the reader tells, with `turns` as the list of them.
 * @param {string} text @param {Parameters<typeof cursorReader>[0]} [o]
 */
export function parseCursorSession(text, o) {
  const r = cursorReader(o);
  const turns = [];
  for (const raw of String(text).split("\n")) turns.push(...r.push(raw));
  turns.push(...r.end());
  return { ...r.s, turns };
}

/** How much of a chat file's head a list reads at most, looking for its first message. */
const PEEK_BYTES = 2 << 20;
/**
 * A chat file's head: when it began, the first words of the person's, and whether Filament wrote its first message
 * (`own`) — enough to list it without reading it. @param {string} file
 */
export function peekCursor(file) {
  /** @type {{ firstAt: number | null, preview: string | null, own: boolean }} */
  const out = { firstAt: null, preview: null, own: false };
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return out;
  }
  try {
    const block = Buffer.alloc(1 << 18);
    const words = new StringDecoder("utf8");
    let text = "";
    for (let pos = 0; pos < PEEK_BYTES; ) {
      const n = readSync(fd, block, 0, block.length, pos);
      if (!n) break;
      pos += n;
      text += words.write(block.subarray(0, n));
      const lines = text.split("\n");
      // The last piece may be half a line: it waits for the next block, unless the file ends there.
      text = n < block.length ? "" : /** @type {string} */ (lines.pop());
      for (const line of lines) {
        const o = parseJson(line);
        const raw = o?.role === "user" ? textOf(o) : "";
        const said = raw ? messageOf(raw) : null;
        if (!said) continue;
        out.firstAt = stampMs(said.stamp);
        out.preview = String(scrub(previewOf(said.words.replace(OWN_BLOCKS, "")), true)) || null;
        out.own = OWN_BLOCK.test(raw);
        return out;
      }
    }
  } catch {
  } finally {
    closeSync(fd);
  }
  return out;
}

/** A chat's id on the lists: its project's folder name and its own. @param {{ slug: string, id: string }} f */
const chatIdOf = (f) => `${f.slug}/${f.id}`;
/**
 * Where each project is, found in one walk for them all (`foldersOfNames`): its folder on this computer (`cwd`), or
 * the name Cursor gave it where no folder fits (`project`), or neither for a window that had no folder (a number for a
 * name).
 * @param {readonly string[]} slugs
 * @returns {Promise<(slug: string) => { cwd: string | null, project: string | null }>}
 */
async function placesOf(slugs) {
  const folders = await foldersOfNames(slugs.filter((slug) => !/^\d+$/.test(slug)));
  return (slug) => {
    const cwd = folders.get(slug) ?? null;
    return { cwd, project: cwd || /^\d+$/.test(slug) ? null : slug };
  };
}

/**
 * Every chat under the root, for a list: no file is read past its first message. `mark` is the file's size, the
 * number that grows when the chat does. A chat whose project's folder is not on this computer says the project's
 * name in its place (`project`). One whose first message Filament wrote is `own`.
 * @param {string} root
 */
export async function cursorChats(root) {
  const files = listCursorFiles(expandHome(root));
  const placeOf = await placesOf(files.map((f) => f.slug));
  return files.map((f) => {
    const p = peekCursor(f.path);
    const { cwd, project } = placeOf(f.slug);
    return {
      id: chatIdOf(f),
      key: `cu:${f.id}`,
      agentSession: f.id,
      file: f.name,
      cwd,
      ...(project ? { project } : {}),
      preview: p.preview,
      startedAt: p.firstAt ?? f.mtime,
      lastAt: f.mtime,
      bytes: f.size,
      mark: f.size,
      ...(p.own ? { own: true } : {}),
    };
  });
}

// `only` (a set of chat ids, `<folder name>/<chat id>`) keeps only those. A missing root is simply nothing to import.
// A file is read a line at a time and written a turn at a time, the server answering other requests in between;
// `signal` stops it after the turn in hand. A chat whose first message Filament wrote is passed over and counted.
/** @param {{ archive?: any, root?: string, onProgress?: (p: any) => void, only?: Set<string> | null, signal?: AbortSignal | null, dryRun?: boolean, redact?: boolean }} [o] */
export async function importCursor({ archive, root = CURSOR_ROOT, onProgress = noop, only = null, signal = null, dryRun = false, redact = true } = {}) {
  if (!archive && !dryRun) throw new Error("importCursor: an archive is required");
  root = expandHome(root);
  const files = listCursorFiles(root)
    .filter((f) => !only || only.has(chatIdOf(f)))
    .map((f) => ({ ...f, ...peekCursor(f.path) }));
  files.sort((a, b) => (a.firstAt ?? a.mtime) - (b.firstAt ?? b.mtime) || a.name.localeCompare(b.name));
  const sink = new Sink(archive, { dryRun, redact, agent: AGENT });
  const out = summary({ source: "cursor", root, files: files.length, passed: 0, dryRun });
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  onProgress({ step: "cursor", message: `${files.length} chat file(s)`, percent: 0, done: 0, total: files.length });
  const placeOf = await placesOf(files.filter((f) => !f.own).map((f) => f.slug));
  const picture = pictureUnder(root);
  const breathe = breather();
  let done = 0,
    bytesDone = 0;
  for (const f of files) {
    throwIfStopped(signal);
    try {
      if (f.own) out.passed++;
      else {
        const r = cursorReader({ at: f.mtime, picture });
        const s = r.s;
        const key = `cu:${f.id}`;
        /** @type {any} */
        let chain = null;
        /** @type {ReturnType<Sink["writer"]> | null} */
        let writer = null;
        const write = (/** @type {any[]} */ turns) => {
          for (const t of turns) {
            if (!writer) {
              // A project whose folder is not on this computer is named as Cursor names it, with no folder.
              chain = sink.chain(key, { ...placeOf(f.slug), meta: { import: "cursor", sessionId: f.id, file: f.name, slug: f.slug }, startedAt: s.firstAt ?? f.mtime });
              writer = sink.writer(chain);
            }
            writer.put(t);
          }
        };
        let read = 0,
          said = 0;
        for await (const { line, pos, long } of readLines(f.path)) {
          if (long) out.long.push({ file: f.name, ...long });
          if (line != null) write(r.push(line));
          read = pos;
          if (pos - said >= 8 << 20) {
            said = pos;
            onProgress({ step: "cursor", message: f.name, percent: pct(bytesDone + pos, totalBytes), done, total: files.length });
          }
          await breathe();
          throwIfStopped(signal);
        }
        write(r.end());
        out.skipped += s.skipped;
        if (chain && writer) {
          /** @type {ReturnType<Sink["writer"]>} */ (writer).end();
          // Cursor stamps a message, not its answer: the file's own time is when the chat was last active.
          sink.close(chain, { at: f.mtime, mark: read });
        } else if (!dryRun) out.empty.push({ key, mark: read });
      }
    } catch (e) {
      if (/** @type {any} */ (e)?.aborted) throw e;
      out.errors.push({ file: f.name, error: String(/** @type {any} */ (e)?.message || e) });
    }
    done++;
    bytesDone += f.size;
    onProgress({ step: "cursor", message: f.name, percent: pct(bytesDone, totalBytes), done, total: files.length });
  }
  return Object.assign(out, sink.stats);
}

/** Cursor as one of the agents chats come from (sources.js lists them). */
export const cursorSource = Object.freeze({
  id: "cursor",
  label: AGENT,
  prefix: "cu:",
  /** @param {string} home */
  where: (home) => join(home, ".cursor", "projects"),
  /** @param {string} where */
  found: (where) => {
    try {
      return statSync(where).isDirectory();
    } catch {
      return false;
    }
  },
  /** @param {string} where */
  chats: (where) => cursorChats(where),
  /** @param {{ archive: any, where: string, only: Set<string> | null, onProgress?: (p: any) => void, signal?: AbortSignal | null }} o */
  run: ({ archive, where, only, onProgress, signal }) => importCursor({ archive, root: where, only, onProgress, signal }),
});
