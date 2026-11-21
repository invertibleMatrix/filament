// @ts-check
// The Changes pane's words (HarnessV4_Git_Plan step 3; by place since the owner's of 10-29, changes-places.js): a clock
// time, a worker's file, who an agent is, git's refusal, a binary file's and a cut diff's words, a whole diff split per
// file; the places in the repository (step 4), their lines and Remove's sheet. No DOM, no fetch.
import { aheadWords, sizeWords } from "../lib/labels.js";
import { workerCalled } from "../lib/team.js";

/** The lines a diff is cut at, as the server cuts it. */
export const DIFF_LINES = 2000;

/** A clock time, 24-hour: "14:02". @param {number} at */
export const clockOf = (at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** "1 file", "3 files". @param {number} n */
export const fileCount = (n) => `${n} file${n === 1 ? "" : "s"}`;

/** A worker's file as the other lists spell it: its status a word, not git's letter. @param {any} f */
export const workerFile = (f) => ({ ...f, status: { A: "added", M: "modified", D: "deleted", T: "typechange", R: "renamed" }[String(f?.status)] || f?.status });

/**
 * Who an agent is in its block's head: yours, or a sub-agent by its role, else its card, with what it was asked.
 * @param {string} agent @param {import("../lib/subagents.js").SubagentRow | null} row
 * @returns {{ name: string, about: string }}
 */
export function agentName(agent, row) {
  if (!agent) return { name: "Your agent", about: "" };
  if (!row) return { name: `Sub-agent ${agent}`, about: "" };
  return { name: workerCalled(row) || row.team?.role || "Sub-agent", about: String(row.description || "") };
}

/** A folder as the page compares two spellings of it: forward slashes, no trailing one, one case. @param {string} p */
export const placeKey = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** git missing, in the pane's one line (GWC-20). */
export const GIT_MISSING = "git is not on this computer's PATH";

/** git's refusal in the pane's words: git missing as GWC-20 says it, its own sentence otherwise. @param {any} error */
export const gitWords = (error) => (/git is not installed|not on PATH/i.test(String(error || "")) ? GIT_MISSING : String(error || ""));

/** A binary file's diff in words (GWC-30): "binary · 24 KB". @param {{ size?: number }} f */
export const binaryWords = (f) => (f?.size != null ? `binary · ${sizeWords(f.size)}` : "binary");

/** A cut diff in words (GWC-31): "cut at 2,000 lines of 5,123". @param {{ truncated?: boolean, lines?: number }} f */
export const cutWords = (f) =>
  f?.truncated ? `cut at ${DIFF_LINES.toLocaleString("en-US")} lines${f.lines ? ` of ${Number(f.lines).toLocaleString("en-US")}` : ""}` : "";

/** A path's folder and its name: "src/app/" and "x.js". @param {string} path */
export function dirLeaf(path) {
  const p = String(path || "").replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return { dir: i < 0 ? "" : p.slice(0, i + 1), leaf: i < 0 ? p : p.slice(i + 1) };
}

/**
 * A whole unified diff split per file, keyed by its path after the change; a quoted path (git quotes one with spaces or
 * other bytes) is read without its quotes.
 * @param {string} diff @returns {Map<string, string>}
 */
export function splitPatch(diff) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {string | null} */
  let path = null;
  /** @type {string[]} */
  let lines = [];
  for (const line of String(diff || "").split("\n")) {
    const m = /^diff --git "?a\/.*?"? "?b\/(.*?)"?$/.exec(line);
    if (m) {
      if (path) out.set(path, lines.join("\n"));
      path = m[1];
      lines = [line];
    } else if (path) lines.push(line);
  }
  if (path) out.set(path, lines.join("\n"));
  return out;
}

// ---- the places in the repository (step 4) -----------------------------------------------------------------------

/** The chats a sentence names at most; the rest are counted. */
const CHATS_NAMED = 3;

/** A chat by its name in a sentence; the one open, "this chat". @param {{ id: string, name: string }} c @param {string | null} self */
const chatName = (c, self) => (self && c.id === self ? "this chat" : `“${c.name || "an untitled chat"}”`);

/** "a", "a and b", "a, b and 2 more". @param {string[]} names */
function andList(names) {
  const shown = names.slice(0, CHATS_NAMED);
  const more = names.length - shown.length;
  if (more) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0] || "";
}

/**
 * The chats at work in a place now, in its line (GW-D59): "this chat is at work", "“fix login” and “docs” are at
 * work"; nothing where none is — a count of every chat whose folder it is says nothing to do.
 * @param {{ id: string, name: string, atWork?: boolean }[]} chats @param {string | null} [self]  the chat open
 */
export function chatsWords(chats, self = null) {
  const busy = (chats || []).filter((c) => c.atWork);
  if (!busy.length) return "";
  return `${andList(busy.map((c) => chatName(c, self)))} ${busy.length === 1 ? "is" : "are"} at work`;
}

/**
 * Whose a place is, on hover over its line (GW-D59): the chats whose folder it is, then those whose agents wrote there.
 * @param {{ id: string, name: string, home?: boolean }[]} chats @param {string | null} [self]  the chat open
 */
export function chatsTitle(chats, self = null) {
  const list = chats || [];
  const home = list.filter((c) => c.home).map((c) => chatName(c, self));
  const wrote = list.filter((c) => !c.home).map((c) => chatName(c, self));
  if (!list.length) return "No chat works here";
  return [home.length ? `The folder of ${andList(home)}` : "", wrote.length ? `Written in by ${andList(wrote)}` : ""].filter(Boolean).join("\n");
}

/**
 * A place's second line in the places list (GW-D38): how far from its base, what is uncommitted, the chats at work
 * there — "↑2 on main · 3 uncommitted · this chat is at work", "clean · merged into main"; a gone or unread one says
 * so.
 * @param {any} p  a place as `/git/places` answers one @param {string | null} [self]  the chat open
 */
export function placeLine(p, self = null) {
  const chats = chatsWords(p.chats, self);
  if (p.missing) return ["its folder is gone; git keeps its record", chats].filter(Boolean).join(" · ");
  if (!p.ok) return gitWords(p.error) || "git could not read it";
  const parts = [];
  if (p.base && !p.onBase && aheadWords(p)) parts.push(`${aheadWords(p)} on ${p.base}`);
  if (p.uncommitted) parts.push(p.uncommitted.files ? `${p.uncommitted.files} uncommitted` : "clean");
  // "merged" beside files not committed would read as nothing to lose: it is said of a clean place only.
  if (!p.main && p.base && !p.onBase && p.ahead === 0 && p.uncommitted && !p.uncommitted.files) parts.push(p.fresh ? "nothing of its own yet" : `merged into ${p.base}`);
  if (chats) parts.push(chats);
  return parts.join(" · ");
}

/**
 * Whether a place's row has the "…" menu, where Remove is (GW-D60): a worktree git could read whose folder stands —
 * never the main folder.
 * @param {any} p
 */
export const placeMenu = (p) => !p.main && !!p.ok && !p.missing;

/**
 * Why Remove is greyed in a place's menu (GW-D60): the server's reason; nothing where it is offered.
 * @param {any} p
 */
export const placeWhy = (p) => (p.removable ? "" : String(p.why || "it is not offered here"));

/** What a removed or removable place keeps: "the branch fix-x", "its commit 1a2b3c4d". @param {{ branch?: string | null, head?: string | null }} p */
const keeps = (p) => (p.branch ? `the branch ${p.branch}` : `its commit ${p.head || "?"}`);

/** A removed place's line, with its Put back (GW-D37): "removed 14:02 · the branch fix-x stays". @param {any} r @param {(at: number) => string} [clock] */
export const removedLine = (r, clock = clockOf) => `removed ${clock(r.at)} · ${keeps(r)} stays`;

/** The toast after a Remove: "Removed proj-fix · the branch fix stays". @param {any} r */
export const removedToast = (r) => `Removed ${r.name} · ${keeps(r)} stays`;

/**
 * What goes with the folder beside the branch's files (GW-D36), in the sheet's words.
 * @param {{ names: { path: string, link: boolean }[], more: number } | null} goes
 */
export function goesWords(goes) {
  if (!goes) return "git could not list what it ignores there: whatever that is goes with the folder.";
  if (!goes.names.length) return "Nothing git ignores is in it either.";
  const named = goes.names.map((g) => (g.link ? `${g.path.replace(/\/$/, "")} (a link: only the link goes)` : g.path));
  const more = goes.more ? `, and ${goes.more} more` : "";
  return `With it go what git ignores there: ${named.join(", ")}${more}. Put back brings the branch's files back, not these.`;
}

/**
 * Remove's sheet (GW-D10, GW-D36, GW-D39): its title, the folder, and its paragraphs — what stays, what goes, which
 * chats lose their folder until Put back. `moveTo`: the main folder's name, where the chats whose folder it is may
 * move first (the owner's of 11-09): `move` is the sheet's tick for it, ticked, its label, and the paragraph `at` that
 * says where they go while it is ticked (`line`).
 * @param {any} p  a removable place @param {string | null} [self]  the chat open @param {{ moveTo?: string | null }} [o]
 * @returns {{ title: string, path: string, lines: string[], move?: { at: number, line: string, label: string } }}
 */
export function removeSheet(p, self = null, { moveTo = null } = {}) {
  // A branch's own commits its base lacks stay with the branch: the base is said only where it has them.
  const has = p.base && !p.onBase && !p.ahead ? `; ${p.base} has ${p.branch ? "them all" : "it"}` : "";
  const kept = p.branch ? `The folder goes. The branch ${p.branch} stays, with every commit on it${has}.` : `The folder goes. Its commit ${p.head} stays${has}.`;
  /** @type {{ id: string, name: string, home?: boolean, own?: boolean }[]} */
  const chats = p.chats || [];
  const home = chats.filter((c) => c.home);
  const wrote = chats.filter((c) => !c.home);
  const names = (/** @type {typeof chats} */ l) => andList(l.map((c) => chatName(c, self)));
  const one = home.length === 1;
  const homeLine = home.length ? `${names(home)} ${one ? "works" : "work"} there: ${one ? "its" : "their"} folder is gone until you put it back.` : "No chat works there.";
  const wroteLine = wrote.length ? `${names(wrote)} also wrote there; ${wrote.length === 1 ? "it keeps its" : "they keep their"} own folder.` : "";
  const lines = [kept, `Nothing uncommitted is in it. ${goesWords(p.goes)}`, homeLine, wroteLine].filter(Boolean);
  const cap = (/** @type {string} */ l) => l.charAt(0).toUpperCase() + l.slice(1);
  const sheet = { title: `Remove the worktree ${p.name}?`, path: String(p.path), lines: lines.map(cap) };
  // A client's session (`own` false) is its client's, which names its folder at each request: it never moves.
  const goes = home.filter((c) => c.own !== false);
  const stays = home.filter((c) => c.own === false);
  if (!goes.length || !moveTo) return sheet;
  const lone = goes.length === 1;
  const moves = `${names(goes)} ${lone ? "moves" : "move"} to ${moveTo} first: ${lone ? "its" : "their"} conversation goes on there.`;
  const left = stays.length ? ` ${names(stays)} ${stays.length === 1 ? "is a client's session: its" : "are clients' sessions: their"} folder is gone until you put it back.` : "";
  return { ...sheet, move: { at: 2, line: cap(moves + left), label: `Move ${lone ? "its chat" : `its ${goes.length} chats`} to the main folder, ${moveTo}` } };
}
