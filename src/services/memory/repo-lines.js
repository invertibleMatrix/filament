// @ts-check
// The briefing's words for where a session's repository stands (the owner's of 10-29: a session should start knowing
// what happened in the last commits and which worktrees are merged, never from a memory that went stale). The git
// adapter reads it once, as the session starts (adapters/git/standing.js, handed to memory by the composition root);
// here it is worded within a room of characters. What is read once goes stale as the session works: the head says so.
// It is small (the memory plan's e1): this folder's line, the other worktrees in one line, by how each stands against
// the base, and the newest commit with where git keeps the rest — a client lists its recent commits itself (Filament's
// Environment, Claude Code's git status).
import { clip } from "../../core/text.js";

/** @typedef {import("../../core/repo-standing.js").RepoStanding} RepoStanding */
/** @typedef {import("../../core/repo-standing.js").WorktreeStanding} WorktreeStanding */
/** @typedef {import("../../core/repo-standing.js").CommitLine} CommitLine */

export const STANDING_HEAD = "Where things stand (git, read as this session started; ask git for the state now):";

/** git's spelling of a Windows folder (H:/x) as the system's (H:\x); any other as it is. @param {string} p */
const native = (p) => (/^[A-Za-z]:\//.test(p) ? p.replace(/\//g, "\\") : p);
/** A folder by its last part, as a worktree is named among the others. @param {string} p */
const leaf = (p) => String(p).split(/[\\/]/).filter(Boolean).at(-1) || String(p);
/** @param {number} n @param {string} one */
const many = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Whether a text leaves a quote open: an odd number of straight quotes, or curly ones that do not pair. @param {string} t */
const quoteOpen = (t) => (t.split('"').length - 1) % 2 === 1 || t.split("“").length !== t.split("”").length;

/**
 * A commit's subject as its line names it: up to its first ": " where that falls after a few words and within `max`,
 * outside a quote, else clipped at `max` — subjects here run to paragraphs, and their head says what the commit is.
 * @param {string} subject @param {number} [max]
 */
export function subjectHead(subject, max = 110) {
  const s = String(subject || "").replace(/\s+/g, " ").trim();
  for (let at = s.indexOf(": "); at >= 0 && at <= max; at = s.indexOf(": ", at + 1)) if (at >= 20 && !quoteOpen(s.slice(0, at))) return s.slice(0, at);
  return clip(s, max);
}

/**
 * Where a branch stands against the base, in words: what it has the base lacks, merged, or nothing of its own yet.
 * @param {Pick<WorktreeStanding, "onBase" | "ahead" | "behind" | "fresh">} x @param {string | null} base
 */
function against(x, base) {
  if (!base) return "";
  if (x.onBase) return "the base branch";
  if (x.ahead == null) return `not compared with ${base}`;
  const more = x.behind ? `; ${base} has ${x.behind} more` : "";
  if (x.ahead > 0) return `${many(x.ahead, "commit")} ${base} lacks${more}`;
  return `${x.fresh ? "nothing of its own yet" : `merged into ${base}`}${more}`;
}

/** @param {Pick<WorktreeStanding, "branch" | "head">} x */
const onWhat = (x) => (x.branch ? `on ${x.branch}${x.head ? ` @ ${x.head}` : ", no commit yet"}` : `detached at ${x.head || "?"}`);
/** What is uncommitted, its lines where it changes any (an untracked file's are none). @param {WorktreeStanding["uncommitted"]} u */
const dirt = (u) => (!u ? "" : u.files ? `${many(u.files, "file")} uncommitted${u.added || u.removed ? ` (+${u.added} −${u.removed})` : ""}` : "clean");

/**
 * The lines that open a block, those that fit `room` characters with the head, in order — one that does not is passed
 * over, and a shorter one after it may still fit; "" where not one does.
 * @param {string} head @param {string[]} rows @param {number} room
 */
function fit(head, rows, room) {
  const out = [head];
  let used = head.length;
  for (const row of rows) {
    if (used + row.length + 1 > room) continue;
    out.push(row);
    used += row.length + 1;
  }
  return { text: out.length > 1 ? out.join("\n") : "", lines: out.length - 1 };
}

/**
 * The other worktrees in one line, by how each stands against the base — ahead of it (with its commits the base lacks),
 * merged into it, on it, nothing of its own yet, not compared with it, its folder gone, not read — each named by its
 * folder's last part, with its uncommitted files where it has any; with no base, by its branch. "" where there are none.
 * @param {RepoStanding} s
 */
function othersLine(s) {
  const base = s.base;
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const w of s.worktrees) {
    const label = w.missing
      ? "its folder gone"
      : w.unread
        ? "not read"
        : !base
          ? w.branch
            ? `on ${w.branch}`
            : "detached"
          : w.onBase
            ? `on ${base}`
            : w.ahead == null
              ? `not compared with ${base}`
              : w.ahead > 0
                ? `ahead of ${base}`
                : w.fresh
                  ? "nothing of its own yet"
                  : `merged into ${base}`;
    const bits = [!w.missing && w.ahead ? many(w.ahead, "commit") : "", !w.missing && w.uncommitted?.files ? `${w.uncommitted.files} uncommitted` : ""].filter(Boolean);
    groups.set(label, [...(groups.get(label) || []), `${leaf(native(w.path))}${bits.length ? ` (${bits.join(", ")})` : ""}`]);
  }
  const parts = [...groups].map(([label, names]) => `${label}: ${names.join(", ")}`);
  if (s.moreWorktrees) parts.push(`${s.moreWorktrees} more not read`);
  return parts.length ? `- Other worktrees (git worktree list): ${parts.join("; ")}` : "";
}

/**
 * The newest commit, as a pointer to the rest: the branch's own newest where it has commits the base lacks, else the
 * base's (HEAD's where there is no base). "" before the first commit. @param {RepoStanding} s
 */
function newestLine(s) {
  /** @param {CommitLine} c */
  const said = (c) => `${c.date} ${c.short} ${subjectHead(c.subject)}`;
  const own = s.own[0];
  if (own && s.base) return `- Newest commit here: ${said(own)} (${many(s.ahead ?? s.own.length, "commit")} ${s.base} lacks: git log ${s.base}..HEAD)`;
  const on = s.base || s.branch || "HEAD";
  return s.commits[0] ? `- Newest commit on ${on}: ${said(s.commits[0])} (git log ${on} for the rest)` : "";
}

/**
 * Where the repository stands, in `room` characters: this folder's branch against the base, the other worktrees in one
 * line, and its newest commit — the rows that fit, in that order.
 * @param {RepoStanding} s @param {number} room
 */
export function standingBlock(s, room) {
  const base = s.base;
  const here = [
    `- This folder: ${native(s.place)}${s.worktree && s.main ? ` (a worktree of ${native(s.main)})` : ""}, ${onWhat(s)}`,
    [against(s, base), !s.onBase && base && s.baseHead ? `${base} @ ${s.baseHead}` : "", dirt(s.uncommitted)].filter(Boolean).join("; "),
  ]
    .filter(Boolean)
    .join(" — ");
  // The other worktrees before the newest commit, which the client's own git status lists too.
  return fit(STANDING_HEAD, [here, othersLine(s), newestLine(s)].filter(Boolean), room);
}
