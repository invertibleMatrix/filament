// @ts-check
// The desk (the remote desk of 11-22): this computer's left bar lists every other machine's chats beside its own. The
// desktop app watches each machine kept beside this one (desktop/lib/watch.js) and tells this computer's page alone
// what it found (harness-preload.cjs `filamentMachines.onDesk`): each machine's Now — what needs you, what works, what
// finished unread — and its newest chats. Every string in it is that machine's, of any version: this file reads it into
// rows the bar draws, each field checked or dropped, each row keyed by its machine (`m:<id>/…`), and its chat's id kept
// apart (`there`), so nothing of this computer's found by a chat's id is ever given one. A chat's project stands with
// another machine's, or this computer's, by its repository's remote alone where that names a host (`mergeKey`): a
// remote that is a folder says nothing across machines. Nothing here asks a machine anything.

import { ICONS } from "./icons.js";

/** The colours a machine wears (desktop/lib/machines.js MACHINE_COLORS). */
export const MACHINE_COLORS = Object.freeze(["blue", "orange", "green", "purple", "teal", "pink", "indigo", "yellow"]);
/** Its icons (desktop/lib/machines.js MACHINE_ICONS): one this page does not draw is a desktop's. */
export const MACHINE_ICONS = Object.freeze(["monitor", "laptop", "server", "cloud", "house", "terminal"]);
/** A machine's states as the app says them (machines.js MachineStatus): `disconnected` is kept off in this window. */
const STATUSES = ["online", "reconnecting", "offline", "disconnected"];
/** The most rows of a group, and chats, read from one machine: what a list shows and more. */
const ROWS_MOST = 50;
const RECENT_MOST = 200;
/** The most machines read: more than anyone keeps. */
const MACHINES_MOST = 32;
/** The longest words kept: a title, a fact, a name. */
const WORDS_MOST = 300;
const NAME_MOST = 80;

/**
 * A machine as the desk names it on its rows: its id, its name, how it looks, and whether it answers now.
 * @typedef {{ id: string, name: string, color: string, icon: string, status: "online" | "reconnecting" | "offline" | "disconnected", refused: boolean }} DeskMachine
 */
/**
 * Where a row's chat is on its machine: its own id there, and the thread of it a row opens. @typedef {{ chain: string, thread: string | null }} There
 */
/**
 * A row of Now from another machine: Now's row (lib/now.js `NowRow`), its `key` and `chain` that machine's
 * (`m:<id>/…`) — never a chat of this computer's —, its machine, and its chat there (`there`). It has no lines under it.
 * @typedef {import("./now.js").NowRow & { machine: DeskMachine, there: There }} DeskRow
 */
/**
 * A chat of another machine's, as the desk lists it: its title, its project's name and its id there, its folder, its
 * newest moment, its marks, whose agents started it, its repository's remote's key and the key it stands with others by
 * (`mergeKey`); keyed by its machine as a row is. `aside`: a thread of another chat, or a team's on a chat's side —
 * its machine's own bar draws it under that chat, so the desk's projects list it not at all.
 * @typedef {{ key: string, chain: string, title: string, project: string, projectId: string, cwd: string, when: number,
 *   unread: boolean, pinned: boolean, from: string, remoteKey: string | null, merge: string | null, aside: boolean, machine: DeskMachine, there: There }} DeskChat
 */
/**
 * @typedef {{ needs: DeskRow[], works: DeskRow[], done: DeskRow[] }} DeskGroups
 * @typedef {DeskMachine & { flags: string[], rows: DeskGroups, recent: DeskChat[] }} DeskMachineSaid
 * @typedef {{ here: { id: string, name: string, color: string, icon: string }, machines: DeskMachineSaid[] }} Desk
 */

/** Words as kept: a string, its control characters gone, `most` characters at most. @param {unknown} v @param {number} [most] */
const words = (v, most = WORDS_MOST) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, most) : "");
/**
 * An id as kept: what a machine's or a chat's id is made of, a letter or a digit first — one of dots alone would be a
 * step up a path it goes into —, else "". @param {unknown} v
 */
const idOf = (v) => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v) ? v : "");
/** A moment (ms) a Date holds, else 0: one past it threw where a row's age is written (the review of s1b). @param {unknown} v */
const moment = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 8.64e15 ? Number(v) : 0);
/** One of `allowed`, else `or`. @template {string} T @param {unknown} v @param {readonly T[]} allowed @param {T} or @returns {T} */
const oneOf = (v, allowed, or) => (allowed.includes(/** @type {any} */ (v)) ? /** @type {T} */ (v) : or);

/**
 * The key a chat's project stands with others' by: its repository's remote's key (inspect.js `remoteKey`) where it names
 * a host — `github.com/o/r`, `gitlab.example/o/r` —, else null. A key that is a folder (`/srv/git/app`, `C:/repos/app`,
 * `../app`, `~/app`) is that machine's own: the same words on another say nothing of one repository (the review of s1c).
 * @param {unknown} key @returns {string | null}
 */
export function mergeKey(key) {
  const k = typeof key === "string" ? key.trim().toLowerCase() : "";
  if (!k || k.length > 300 || /\s/.test(k) || /^[./~\\]/.test(k) || /^[a-z]:/.test(k)) return null;
  const slash = k.indexOf("/");
  return slash > 0 && slash < k.length - 1 ? k : null;
}

/** Where a row's chat opens in its machine's page: its chat, a thread's on its Sub Agents view (watch.js `chatRoute`). @param {There} t */
export const deskRoute = (t) => `#/task/${encodeURIComponent(t.chain)}${t.thread ? "/side" : ""}`;

/** @param {any} m @returns {DeskMachine | null} */
function machineOf(m) {
  const id = idOf(m?.id);
  if (!id) return null;
  return {
    id,
    name: words(m.name, NAME_MOST) || "Another machine",
    color: oneOf(m.color, MACHINE_COLORS, "blue"),
    icon: oneOf(m.icon, MACHINE_ICONS, "monitor"),
    status: oneOf(m.status, /** @type {DeskMachine["status"][]} */ (STATUSES), "reconnecting"),
    refused: m.refused === true,
  };
}

/**
 * A row of that machine's Now, as this page draws it: its words and marks checked, its tile's glyph one this page has,
 * keyed by its machine; null where it names no chat (a Space's button running there opens nothing here).
 * @param {any} r @param {DeskMachine} m @param {"needs" | "works" | "done"} group @returns {DeskRow | null}
 */
function rowOf(r, m, group) {
  const chain = idOf(r?.chain);
  if (!chain || r.space) return null;
  const thread = idOf(r.thread) || null;
  const key = `m:${m.id}/${thread ? `thread:${thread}` : `chat:${chain}`}`;
  /** @type {DeskRow} */
  const row = {
    key,
    chain: key,
    thread: null,
    group,
    title: words(r.title) || "untitled",
    project: words(r.project, NAME_MOST),
    fact: words(r.fact),
    tone: oneOf(r.tone, /** @type {const} */ (["asks", "error", ""]), ""),
    icon: typeof r.icon === "string" && Object.prototype.hasOwnProperty.call(ICONS, r.icon) ? r.icon : "messageSquare",
    tile: oneOf(r.tile, /** @type {const} */ (["needs", "model", "agent", "lead", "done"]), group === "needs" ? "needs" : group === "done" ? "done" : "agent"),
    model: words(r.model, NAME_MOST),
    at: moment(r.at),
    under: [],
    team: words(r.team, NAME_MOST),
    step: words(r.step, NAME_MOST),
    ...(typeof r.from === "string" && r.from ? { from: words(r.from, NAME_MOST) } : {}),
    machine: m,
    there: { chain, thread },
  };
  return row;
}

/** @param {any} c @param {DeskMachine} m @returns {DeskChat | null} */
function chatOf(c, m) {
  const chain = idOf(c?.chain);
  if (!chain) return null;
  const remoteKey = typeof c.remoteKey === "string" && c.remoteKey ? words(c.remoteKey) : null;
  return {
    key: `m:${m.id}/chat:${chain}`,
    chain: `m:${m.id}/chat:${chain}`,
    title: words(c.title) || "untitled",
    project: words(c.project, NAME_MOST),
    projectId: words(c.projectId, NAME_MOST),
    cwd: words(c.cwd),
    when: moment(c.when),
    unread: c.unread === true,
    pinned: c.pinned === true,
    from: words(c.from, NAME_MOST),
    remoteKey,
    merge: mergeKey(remoteKey),
    aside: !!idOf(c.threadOf) || c.kind === "team",
    machine: m,
    there: { chain, thread: null },
  };
}

/**
 * The desk as the app told it, read: This computer's name and look, and each other machine with its rows and chats —
 * none for one this window is refused by. Null for what is no desk.
 * @param {unknown} raw @returns {Desk | null}
 */
export function readDesk(raw) {
  const d = /** @type {any} */ (raw);
  if (!d || typeof d !== "object" || !Array.isArray(d.machines)) return null;
  const here = { id: idOf(d.here?.id), name: words(d.here?.name, NAME_MOST) || "This computer", color: oneOf(d.here?.color, MACHINE_COLORS, "blue"), icon: oneOf(d.here?.icon, MACHINE_ICONS, "monitor") };
  /** @type {DeskMachineSaid[]} */
  const machines = [];
  for (const x of d.machines.slice(0, MACHINES_MOST)) {
    const m = machineOf(x);
    if (!m || m.id === here.id || machines.some((y) => y.id === m.id)) continue;
    /** @param {"needs" | "works" | "done"} g */
    const group = (g) => (m.refused || !Array.isArray(x.rows?.[g]) ? [] : x.rows[g].slice(0, ROWS_MOST).map((/** @type {any} */ r) => rowOf(r, m, g)).filter(/** @returns {r is DeskRow} */ (r) => !!r));
    machines.push({
      ...m,
      flags: Array.isArray(x.flags) ? x.flags.filter((/** @type {unknown} */ f) => typeof f === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(f)).slice(0, 32) : [],
      rows: { needs: group("needs"), works: group("works"), done: group("done") },
      recent: m.refused || !Array.isArray(x.recent) ? [] : x.recent.slice(0, RECENT_MOST).map((/** @type {any} */ c) => chatOf(c, m)).filter(/** @returns {c is DeskChat} */ (c) => !!c),
    });
  }
  return { here, machines };
}

/**
 * Every other machine's Now as one, each group newest first — those `hidden` names left out.
 * @param {Desk | null} desk @param {ReadonlySet<string>} [hidden] @returns {DeskGroups}
 */
export function deskGroups(desk, hidden = new Set()) {
  const shown = (desk?.machines || []).filter((m) => !hidden.has(m.id));
  /** @param {"needs" | "works" | "done"} g */
  const all = (g) => shown.flatMap((m) => m.rows[g]).sort((a, b) => b.at - a.at);
  return { needs: all("needs"), works: all("works"), done: all("done") };
}

/** Whether a machine's rows stand as it last answered — it does not answer now —, and its words for it. @param {DeskMachine} m */
export function awayWords(m) {
  if (m.status === "online") return "";
  if (m.status === "disconnected") return `${m.name} is disconnected in this window: its chats as they last stood`;
  if (m.status === "offline") return `${m.name} is offline: its chats as they last stood`;
  return `${m.name} is reconnecting: its chats as they last stood`;
}

/**
 * Every other machine's chats beside this computer's projects (`ownKeys`: each project's id here by its repository's
 * `mergeKey`): those of a repository a project here has, by that project's id; the rest each in a group of its own —
 * one repository's on every machine as one, else one machine's project — newest first. `hidden`'s machines left out;
 * `merge` false keeps each machine's projects apart (the list grouped by machine); `inNow`: the rows Now shows, by key,
 * which stand there alone (one chat, one place) — one Now does not show (folded, past Done's newest three) stands
 * here (the review of s1b). A thread, or a team's on a chat's side (`aside`), stands in none.
 * @param {Desk | null} desk @param {ReadonlyMap<string, string>} ownKeys @param {ReadonlySet<string>} [hidden]
 * @param {{ merge?: boolean, inNow?: ReadonlySet<string> }} [o]
 * @returns {{ joined: Map<string, DeskChat[]>, apart: { key: string, name: string, merge: string | null, machines: DeskMachine[], chats: DeskChat[] }[] }}
 */
export function deskProjects(desk, ownKeys, hidden = new Set(), { merge = true, inNow = new Set() } = {}) {
  /** @type {Map<string, DeskChat[]>} */
  const joined = new Map();
  /** @type {Map<string, { key: string, name: string, merge: string | null, machines: DeskMachine[], chats: DeskChat[] }>} */
  const apart = new Map();
  for (const m of desk?.machines || []) {
    if (hidden.has(m.id)) continue;
    for (const c of m.recent) {
      if (c.aside || inNow.has(c.key)) continue;
      const own = merge && c.merge ? ownKeys.get(c.merge) : undefined;
      if (own) {
        joined.set(own, [...(joined.get(own) || []), c]);
        continue;
      }
      const key = merge && c.merge ? `repo:${c.merge}` : `m:${m.id}/project:${c.projectId || c.project || "none"}`;
      const g = apart.get(key) || { key, name: c.project || "(no folder)", merge: c.merge, machines: [], chats: [] };
      if (!g.machines.some((x) => x.id === m.id)) g.machines.push(m);
      g.chats.push(c);
      apart.set(key, g);
    }
  }
  const newest = (/** @type {DeskChat} */ a, /** @type {DeskChat} */ b) => b.when - a.when;
  for (const list of joined.values()) list.sort(newest);
  const groups = [...apart.values()];
  for (const g of groups) g.chats.sort(newest);
  groups.sort((a, b) => (b.chats[0]?.when || 0) - (a.chats[0]?.when || 0));
  return { joined, apart: groups };
}

/**
 * This computer's projects by the key another machine's chats stand with them by (`mergeKey` of each one's
 * `remoteKey`, as `GET /memory/projects?remotes=1` says it): a repository two projects here share — a checkout and its
 * worktree — takes the first's, the list's newest. @param {readonly any[]} projects @returns {Map<string, string>}
 */
export function ownKeysOf(projects) {
  /** @type {Map<string, string>} */
  const keys = new Map();
  for (const p of projects) {
    const k = mergeKey(p?.remoteKey);
    if (k && p?.id != null && !keys.has(k)) keys.set(k, String(p.id));
  }
  return keys;
}

/**
 * What the projects' list draws of the desk, in a word: each machine as it looks and stands, and its chats as their
 * rows say them — the list is drawn again when it moved, not at each word another machine's agent says (the review of
 * s1b: every tick drew the bar whole), and which stand in Now and which of theirs wait or work (`marks`).
 * @param {Desk | null} desk @param {ReadonlySet<string>} inNow @param {ReadonlyMap<string, string>} marks
 */
export function deskListKey(desk, inNow, marks) {
  return JSON.stringify([
    (desk?.machines || []).map((m) => [m.id, m.name, m.color, m.icon, m.status, m.recent.map((c) => [c.key, c.title, c.project, c.projectId, c.when, c.unread, c.merge, c.aside, c.from])]),
    [...inNow].sort(),
    [...marks].sort(),
  ]);
}

/**
 * Which of the other machines' chats wait on you or work, by key, from their Now: a row of theirs under the projects
 * wears the mark (Now folded, the review of s1b). @param {DeskGroups | null} g @returns {Map<string, "needs" | "works">}
 */
export function deskMarks(g) {
  /** @type {Map<string, "needs" | "works">} */
  const marks = new Map();
  for (const r of g?.works || []) marks.set(r.key, "works");
  for (const r of g?.needs || []) marks.set(r.key, "needs");
  return marks;
}
