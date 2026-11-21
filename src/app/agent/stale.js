// @ts-check
// The files an agent read that changed since, told to it as Claude Code tells them (the owner's word of 10-27: "It
// doesn't notice when you change a file. Also make it work like claude"): before a request, each file of the agent's
// sightings (hands.js `changedSightings`) whose time or size moved and whose bytes did too is named once, with what
// changed — the lines around each change, numbered as the file holds them now — and the agent's sighting moves to it,
// so the write guard takes it as read. A file gone is said gone. The words ask the agent to keep the change: the
// developer, a formatter or a command of its own made it on purpose.
import { relative, isAbsolute } from "node:path";
import { lineDiff } from "../acp-render.js";

/** What one telling says of one file at most, and of them all. */
export const STALE_FILE_CHARS = 4_000;
export const STALE_NOTE_CHARS = 12_000;
/** Unchanged lines shown around each change. */
const CONTEXT = 2;
/** The files the note had no room to show, named at most this many. */
const LEFT_NAMES = 30;

/**
 * The note for the files that changed, or "" when none did.
 * @param {readonly { abs: string, was: string | null, now: string | null, gone?: boolean, notFile?: boolean }[]} changes
 *   `was`: what the file held when the agent last saw it, where a copy was kept; `now`: what it holds, where it is
 *   text the agent may be shown
 * @param {{ root?: string, redact?: ((text: string) => string) | null, left?: ((abs: string) => void) | null }} [o]
 *   `redact`: the session's, as a read's; `left`: told each file the note had no room to show, which it names alone —
 *   its sighting goes there, so a write asks for a read first (the Hunter's find of 10-27)
 */
export function staleNote(changes, { root = "", redact = null, left = null } = {}) {
  if (!changes.length) return "";
  const clean = (/** @type {string} */ t) => (redact ? redact(t) : t);
  const parts = [];
  let used = 0;
  /** @type {string[]} */
  const unshown = [];
  for (const c of changes) {
    const name = shownPath(c.abs, root);
    const part = c.gone
      ? `- ${name} was deleted.`
      : c.notFile
        ? `- ${name} is no longer a file: a folder or something else stands in its place.`
        : c.was == null || c.now == null
        ? `- ${name} changed; ${c.now == null ? "it is no text to show" : "no copy of what it held was kept to compare"} — read it again before you rely on what you read of it.`
        : `- ${name}:\n${changedLines(clean(c.was), clean(c.now))}`;
    if (used + part.length > STALE_NOTE_CHARS) {
      unshown.push(name);
      left?.(c.abs);
      continue;
    }
    parts.push(part);
    used += part.length;
  }
  const n = unshown.length;
  const them = n === 1 ? "it" : "them";
  const names = `${unshown.slice(0, LEFT_NAMES).join(", ")}${n > LEFT_NAMES ? ` and ${n - LEFT_NAMES} more` : ""}`;
  const more = n ? `\n…and ${n} more file${n === 1 ? "" : "s"} changed, too much to show here: ${names} — read ${them} again before you rely on ${them} or write ${them}.` : "";
  const one = changes.length === 1;
  return `Note: ${one ? "a file" : `${changes.length} files`} you read changed since — the developer, a formatter or a command made the change. It was made on purpose: take it into account, and don't undo it unless asked. What changed (+ added, - removed; the numbers are the file's lines now):\n${parts.join("\n")}${more}`;
}

/**
 * The note for the files that changed as a coding agent hears it (checkpoint.js DIVERGENCE file-news-names, c-news):
 * each by its name and how many lines changed — it reads them again with its own tools —, or "" when none did.
 * `moved`: the files were read or written in the chat before it moved to the agent that hears this, which read none of
 * them itself — the words say that, and never "you read" (the review of 11-11).
 * @param {readonly { abs: string, was: string | null, now: string | null, gone?: boolean, notFile?: boolean }[]} changes
 * @param {{ root?: string, moved?: boolean }} [o]
 */
export function staleNames(changes, { root = "", moved = false } = {}) {
  if (!changes.length) return "";
  /** @param {number} n @param {string} how */
  const lines = (n, how) => (n ? [`${n} line${n === 1 ? "" : "s"} ${how}`] : []);
  const named = changes.map((c) => {
    const name = shownPath(c.abs, root);
    if (c.gone) return `- ${name} was deleted.`;
    if (c.notFile) return `- ${name} is no longer a file: a folder or something else stands in its place.`;
    if (c.was == null || c.now == null) return `- ${name} changed.`;
    const ops = lineDiff(c.was, c.now);
    const counts = [...lines(ops.filter((o) => o.t === "+").length, "added"), ...lines(ops.filter((o) => o.t === "-").length, "removed")];
    return `- ${name}: ${counts.join(", ") || "changed"}.`;
  });
  const n = changes.length;
  const shown = named.slice(0, LEFT_NAMES).join("\n");
  const more = n > LEFT_NAMES ? `\n…and ${n - LEFT_NAMES} more.` : "";
  const them = n === 1 ? "it" : "them";
  if (moved)
    return `Note: ${n === 1 ? "a file" : `${n} files`} read or written in this chat before it moved to you changed since — the developer, a formatter or a command made the change. It was made on purpose: take it into account, and don't undo it unless asked. Read ${them} before you rely on what this chat says of ${them}:\n${shown}${more}`;
  return `Note: ${n === 1 ? "a file" : `${n} files`} you read changed since — the developer, a formatter or a command made the change. It was made on purpose: take it into account, and don't undo it unless asked. Read ${them} again before you rely on what you read of ${them}:\n${shown}${more}`;
}

/** A path as the agent names it: below the folder it works in, relative; anywhere else, whole. @param {string} abs @param {string} root */
const shownPath = (abs, root) => {
  if (!root) return abs;
  const rel = relative(root, abs);
  return rel && !isAbsolute(rel) && !/^\.\.(?:[\\/]|$)/.test(rel) ? rel.replace(/\\/g, "/") : abs;
};

/**
 * The changed lines of one file with CONTEXT lines around each change: a kept or added line under its number now, a
 * removed one under none, "…" where unchanged lines are left out; cut at STALE_FILE_CHARS.
 * @param {string} was @param {string} now
 */
function changedLines(was, now) {
  const ops = lineDiff(was, now);
  const keep = ops.map(() => false);
  ops.forEach((op, i) => {
    if (op.t !== "=") for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) keep[k] = true;
  });
  const out = [];
  let n = 0;
  let gap = false;
  let used = 0;
  let cut = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.t !== "-") n++;
    if (!keep[i]) {
      gap = true;
      continue;
    }
    if (gap && out.length) out.push("     …");
    gap = false;
    const line = `${op.t === "=" ? " " : op.t}${op.t === "-" ? "".padStart(6) : String(n).padStart(6)}\t${op.line}`;
    if (used + line.length > STALE_FILE_CHARS) {
      if (op.t !== "=") cut++;
      // The lines on either side of one left out are not drawn as if they followed each other.
      gap = true;
      continue;
    }
    out.push(line);
    used += line.length + 1;
  }
  if (cut) out.push(`     …and ${cut} more changed line${cut === 1 ? "" : "s"}: read the file to see them.`);
  return out.join("\n");
}
