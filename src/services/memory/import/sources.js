// @ts-check
// The coding agents whose chats Filament brings in, as one list, and what the Import section asks of it: each
// agent's chats with their state, what a Sync would bring, and the person's choices.
//
// A source is { id, label, prefix, where(home), found(where), chats(where), run({ archive, where, only, onProgress,
// signal }) }: `prefix` starts the key of every chain it makes (`cc:` …), `chats` lists every chat without reading
// one whole, or promises the list (Cursor's looks for its projects' folders on the drive without holding the server) —
// { id, key, agentSession, cwd, project?, preview, startedAt, lastAt, bytes, about?, mark, own? },
// `project` the name of a project whose folder is not on this computer, `about` where `bytes` is an estimate —
// and `run` writes the chats named by `only` (all when null). A new agent is one more file and one more line here.
import { readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { claudeCodeSource, listClaudeCodeFiles } from "./claude-code.js";
import { codexSource } from "./codex.js";
import { cursorSource } from "./cursor.js";
import { isFile } from "./sink.js";
import { PASS_TURNS } from "../learn.js";

export const SOURCES = Object.freeze([claudeCodeSource, codexSource, cursorSource]);
/** @param {string} id */
export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;
/** Is this the key of a chain an import made? @param {string} key */
export const isImportKey = (key) => SOURCES.some((s) => String(key || "").startsWith(s.prefix));

/** How far back a Sync reaches when the person has not chosen: days of last activity. 0 = everything. */
export const REACH_DAYS = 30;
/** The reaches the section offers. */
export const REACHES = Object.freeze([7, 30, 90, 0]);
/** How many removed chats' keys, and how many empty ones', are remembered (the oldest go first). */
const REMOVED_KEPT = 5000;
const STATE_KEY = "imports";

/**
 * The person's choices and the last run, as the archive keeps them (`schema_meta`, one JSON value): which agents a
 * Sync brings (`on`: none until the person switches one on — the owner's of 10-29: a Sync pressed by mistake had
 * flooded the left bar with every agent's chats; an `off` list an older Filament kept is no choice of theirs, and
 * reads as none), how far back it reaches, whether memory reads what comes in, the chats they deleted after an import
 * (`removed`, by chain key: a Sync does not bring one back), the chats an import read whole and found no turn in
 * (`empty`: chain key → how big the file was then), what the last run did, and how memory's last reading ended
 * (`read`).
 * @param {any} archive
 * @returns {{ reachDays: number, on: string[], learn: boolean, removed: string[], empty: Record<string, number>, last: any, read: any }}
 */
export function importState(archive) {
  const s = archive?.schemaMetaGet?.(STATE_KEY) || {};
  return {
    reachDays: Number.isInteger(s.reachDays) && s.reachDays >= 0 ? s.reachDays : REACH_DAYS,
    on: Array.isArray(s.on) ? s.on.filter((id) => sourceById(id)) : [],
    learn: s.learn === true,
    removed: Array.isArray(s.removed) ? s.removed.map(String) : [],
    empty: s.empty && typeof s.empty === "object" && !Array.isArray(s.empty) ? s.empty : {},
    last: s.last && typeof s.last === "object" ? s.last : null,
    read: s.read && typeof s.read === "object" ? s.read : null,
  };
}
/** @param {any} archive @param {Partial<ReturnType<typeof importState>>} patch */
function writeState(archive, patch) {
  const next = { ...importState(archive), ...patch };
  archive.schemaMetaSet(STATE_KEY, next);
  return next;
}
/**
 * The person's choices, changed: `reachDays` (a whole number of days, 0 = everything), `on` (the agents a Sync
 * brings), `learn`. A value that is none of those is refused in words.
 * @param {any} archive @param {{ reachDays?: unknown, on?: unknown, learn?: unknown }} patch
 */
export function setImportPrefs(archive, patch = {}) {
  /** @type {Partial<ReturnType<typeof importState>>} */
  const next = {};
  if (patch.reachDays !== undefined) {
    const n = Number(patch.reachDays);
    if (!Number.isInteger(n) || n < 0 || n > 3650) throw refusal("reachDays is a whole number of days from 0 (everything) to 3650");
    next.reachDays = n;
  }
  if (patch.on !== undefined) {
    if (!Array.isArray(patch.on)) throw refusal("on is a list of agents");
    const unknown = patch.on.find((id) => !sourceById(String(id)));
    if (unknown !== undefined) throw refusal(`no such agent: ${String(unknown).slice(0, 40)}`);
    next.on = [...new Set(patch.on.map(String))];
  }
  if (patch.learn !== undefined) {
    if (typeof patch.learn !== "boolean") throw refusal("learn is true or false");
    next.learn = patch.learn;
  }
  return writeState(archive, next);
}
/** What the last run did, kept for the section. @param {any} archive @param {any} last */
export const noteImportRun = (archive, last) => writeState(archive, { last });
/** How memory's last reading ended, kept for the section. @param {any} archive @param {any} read */
export const noteReading = (archive, read) => writeState(archive, { read });
/**
 * Chains deleted by the person: those an import made are remembered, so a Sync does not bring them back.
 * @param {any} archive @param {readonly (string | null | undefined)[]} keys
 */
export function noteRemoved(archive, keys) {
  const gone = (keys || []).filter((k) => isImportKey(String(k || ""))).map(String);
  if (!gone.length) return;
  const have = importState(archive).removed.filter((k) => !gone.includes(k));
  writeState(archive, { removed: [...have, ...gone].slice(-REMOVED_KEPT) });
}
/**
 * Chats an import read whole and found no turn in (a file of the agent's own lines alone, a fork nobody wrote in):
 * each is remembered with how big it was, so it is not counted as new again until its file has grown.
 * @param {any} archive @param {readonly { key: string, mark: number }[]} list
 */
export function noteEmpty(archive, list) {
  const found = (list || []).filter((e) => isImportKey(String(e?.key || "")));
  if (!found.length) return;
  const have = { ...importState(archive).empty };
  for (const e of found) {
    delete have[e.key];
    have[e.key] = Number(e.mark) || 0;
  }
  writeState(archive, { empty: Object.fromEntries(Object.entries(have).slice(-REMOVED_KEPT)) });
}
/** Chats the person asked for by name come back: their keys leave the removed list. @param {any} archive @param {readonly string[]} keys */
export function forgetRemoved(archive, keys) {
  const state = importState(archive);
  const back = new Set(keys);
  if (state.removed.some((k) => back.has(k))) writeState(archive, { removed: state.removed.filter((k) => !back.has(k)) });
}
/** A request the section's routes answer 400 with. @param {string} message */
export function refusal(message) {
  return Object.assign(new Error(message), { refused: true });
}

/**
 * An agent's chats, each with where it stands in Filament:
 *   new      — not in the archive;
 *   grown    — in the archive, and the agent's copy is bigger than it was when read (or its last read was cut short);
 *   imported — in the archive, as big as the agent's copy;
 *   own      — Filament ran it itself (the file says so, or a bridge's list names its session), so it is a session already;
 *   removed  — imported once, then deleted by the person;
 *   empty    — read whole by an import that found no turn in it, and no bigger since.
 * A chat in the archive names its chain and how many turns it holds.
 * @param {any} source @param {{ archive: any, where: string, ownIds?: ReadonlySet<string> | null, removed?: readonly string[], empty?: Readonly<Record<string, number>> }} o
 * @returns {Promise<any[]>}
 */
export async function chatStates(source, { archive, where, ownIds = null, removed = [], empty = {} }) {
  const listed = await source.chats(where);
  const chains = new Map((archive?.chainsWithKeyPrefix?.(source.prefix) || []).map((/** @type {any} */ c) => [c.key, c]));
  const gone = new Set(removed);
  return listed.map((/** @type {any} */ chat) => {
    const chain = chains.get(chat.key) || null;
    const state =
      chat.own || ownIds?.has(String(chat.agentSession))
        ? "own"
        : chain
          ? chat.mark > (chain.meta?.mark ?? -1)
            ? "grown"
            : "imported"
          : gone.has(chat.key)
            ? "removed"
            : empty[chat.key] != null && chat.mark <= empty[chat.key]
              ? "empty"
              : "new";
    return { ...chat, state, chain: chain?.id ?? null, turns: chain?.turns ?? null, title: chain?.title ?? null };
  });
}
/**
 * An agent's chats with how each stands, or why its store cannot be read (`error`, in the system's words). One
 * agent's unreadable store is that agent's row's matter: the section opens, and a Sync brings the others'.
 * @param {any} source @param {Parameters<typeof chatStates>[1]} o
 * @returns {Promise<{ chats: any[], error: string | null }>}
 */
export async function readChats(source, o) {
  try {
    return { chats: await chatStates(source, o), error: null };
  } catch (e) {
    return { chats: [], error: String(/** @type {any} */ (e)?.message || e).slice(0, 300) };
  }
}
/**
 * What a Sync brings of an agent's chats: the new and the grown whose last activity is inside the reach.
 * @param {readonly any[]} chats @param {{ reachDays: number, now: number }} o
 */
export function pendingOf(chats, { reachDays, now }) {
  const since = reachDays > 0 ? now - reachDays * 86_400_000 : -Infinity;
  return chats.filter((c) => (c.state === "new" || c.state === "grown") && (c.lastAt ?? 0) >= since);
}
/** How much room the drive of a folder has left, or null where the system does not say. @param {string} folder */
export function freeBytes(folder) {
  try {
    const s = statfsSync(folder);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}
const sum = (/** @type {readonly any[]} */ list, /** @type {(x: any) => number} */ of) => list.reduce((n, x) => n + (of(x) || 0), 0);
const countBy = (/** @type {readonly any[]} */ list, /** @type {string} */ key) => {
  /** @type {Record<string, number>} */
  const out = {};
  for (const x of list) out[x[key]] = (out[x[key]] || 0) + 1;
  return out;
};

/** What a listed chat says of itself, where it has a value for it. */
const LISTED = Object.freeze(["id", "cwd", "project", "title", "preview", "lastAt", "bytes", "about", "state"]);
/** A chat as the overview's list names it: of those keys, the ones that have a value. @param {any} c */
const listedChat = (c) => Object.fromEntries(LISTED.filter((k) => c[k] != null && c[k] !== "" && c[k] !== false).map((k) => [k, c[k]]));

/**
 * The Import section's first read: every agent with where its chats are, how many, how big, how they stand, and what
 * a Sync would bring of them now; the person's choices; the last run; the room left on the archive's drive; and how
 * many imported chats memory has not read, with the passes that reading them takes, and how its last reading ended.
 * `list`: what a Sync would bring names its chats too (`pending.list`, the newest first: the welcome tour's Your
 * chats chooses among them), from the same look through the agents' files that counts them.
 * @param {{ archive: any, home?: string, folder?: string | null, ownIds?: ReadonlySet<string> | null, now?: number, list?: boolean }} o
 */
export async function importOverview({ archive, home = homedir(), folder = null, ownIds = null, now = Date.now(), list = false }) {
  const state = importState(archive);
  const sources = await Promise.all(SOURCES.map(async (source) => {
    const where = source.where(home);
    const found = source.found(where);
    const on = state.on.includes(source.id);
    if (!found) return { id: source.id, label: source.label, where, found, on, chats: 0, bytes: 0, projects: 0, states: {}, pending: { chats: 0, bytes: 0, ...(list ? { list: [] } : {}) } };
    const { chats, error } = await readChats(source, { archive, where, ownIds, removed: state.removed, empty: state.empty });
    const pending = pendingOf(chats, { reachDays: state.reachDays, now });
    return {
      id: source.id,
      label: source.label,
      where,
      found,
      on,
      chats: chats.length,
      bytes: sum(chats, (c) => c.bytes),
      ...(chats.some((c) => c.about) ? { about: true } : {}),
      projects: new Set(chats.map((c) => c.cwd || c.project || "")).size,
      states: countBy(chats, "state"),
      pending: { chats: pending.length, bytes: sum(pending, (c) => c.bytes), ...(list ? { list: pending.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).map(listedChat) } : {}) },
      ...(error ? { error } : {}),
    };
  }));
  return {
    prefs: { reachDays: state.reachDays, on: state.on, learn: state.learn },
    reaches: REACHES,
    last: state.last,
    free: folder ? freeBytes(folder) : null,
    sources,
    unread: unreadByMemory(archive),
    lastRead: state.read,
  };
}
/** How many of a chain's turns memory has not read. @param {any} c */
const unreadTurns = (c) => (c.turns || 0) - (Number(c.meta?.learnedThrough) || 0);
/**
 * The imported chats memory has not read to their end, the newest first: the person's own chats, no sub-agent's.
 * @param {any} archive @returns {any[]}
 */
export function unreadChats(archive) {
  /** @type {any[]} */
  const out = [];
  for (const source of SOURCES)
    for (const c of archive?.chainsWithKeyPrefix?.(source.prefix) || [])
      if (unreadTurns(c) > 0 && (!c.kind || c.kind === "interactive" || c.kind === "fork")) out.push(c);
  return out.sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
}
/**
 * How many those are, and the passes reading them takes (one model call a pass).
 * @param {any} archive @returns {{ chats: number, passes: number }}
 */
export function unreadByMemory(archive) {
  const chats = unreadChats(archive);
  return { chats: chats.length, passes: chats.reduce((n, c) => n + Math.ceil(unreadTurns(c) / PASS_TURNS), 0) };
}

// ---- what the dashboard's Import panel asks ---------------------------------------------------------------------
const HERMES_DB = [".hermes", "mnemosyne", "data", "mnemosyne.db"];
// WSL distributions: the \\wsl.localhost\ share when it lists (WSL running), else `wsl.exe -l -q` (UTF-16 output).
function wslDistros() {
  try {
    const names = readdirSync("\\\\wsl.localhost\\");
    if (names.length) return names;
  } catch {}
  try {
    const buf = execFileSync("wsl.exe", ["-l", "-q"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const text = buf.length > 1 && buf[1] === 0 ? buf.toString("utf16le") : buf.toString("utf8");
    return text
      .replace(/\0/g, "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
// → { claudeCode: { root, exists, files, sessions, projects }, hermes: { candidates } }.
// `wsl`: false skips WSL, an array names the distributions to look in, true (the default on Windows) enumerates them.
/** @param {{ home?: string, claudeRoot?: string | null, wsl?: boolean | string[] }} [o] */
export function detectSources({
  home = homedir(),
  claudeRoot = null,
  wsl = process.platform === "win32",
} = {}) {
  /** @type {{ claudeCode: { root: string, exists: boolean, files: number, sessions: number, projects: number }, hermes: { candidates: string[] } }} */
  const out = {
    claudeCode: {
      root: claudeRoot || join(home, ".claude", "projects"),
      exists: false,
      files: 0,
      sessions: 0,
      projects: 0,
    },
    hermes: { candidates: [] },
  };
  try {
    out.claudeCode.exists = statSync(out.claudeCode.root).isDirectory();
  } catch {}
  if (out.claudeCode.exists) {
    const files = listClaudeCodeFiles(out.claudeCode.root);
    out.claudeCode.files = files.length;
    out.claudeCode.sessions = new Set(files.map((f) => f.stem)).size;
    out.claudeCode.projects = new Set(files.map((f) => f.slug)).size;
  }
  const local = join(home, ...HERMES_DB);
  if (isFile(local)) out.hermes.candidates.push(local);
  if (wsl)
    for (const distro of Array.isArray(wsl) ? wsl : wslDistros()) {
      const homes = [`\\\\wsl.localhost\\${distro}\\root`];
      try {
        for (const u of readdirSync(`\\\\wsl.localhost\\${distro}\\home`))
          homes.push(`\\\\wsl.localhost\\${distro}\\home\\${u}`);
      } catch {}
      for (const h of homes) {
        const p = `${h}\\${HERMES_DB.join("\\")}`;
        if (isFile(p)) out.hermes.candidates.push(p);
      }
    }
  return out;
}
