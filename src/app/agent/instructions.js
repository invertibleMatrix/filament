// @ts-check
// Instructions (HarnessV2 §5.6): the project's instruction files (`instructions.files`, relative to the working folder,
// fenced inside it) and the session's own text (`instructions.session`) as one block at the end of the loop's system
// prompt. Byte-stable for the same bytes on disk — a file that changes changes the prompt, and the turn's record
// carries the block's hash so the change is visible. A missing file is skipped and named; a file over the cap is cut
// with the cut said. Skills (§5.6 too) ride the same block: the catalogue, the same every turn; a skill the message calls rides that message whole (agent/turn.js).
// As Claude Code reads them (the Designer's answer of 10-27): the person's own files (`instructions.userFiles`, none by
// default) come first, wherever the chat works; the project's files are looked for in the chat's folder and each folder
// above it up to the top of its repository, outermost first; a file the same as one told before it is told once. A
// folder below the chat's is told its files when the agent first reads or changes a file there (`folderInstructions`),
// with the round's results.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { resolveInside } from "../../adapters/tools/fs-fence.js";

export const INSTRUCTIONS_FILE_CAP = 24_000;
export const INSTRUCTIONS_SESSION_CAP = 12_000;
/** What one round's folder notes carry at most: a file past it is named, and told when the agent next works there. */
export const FOLDER_NOTES_CAP = 48_000;
/** How many folders up the walk to a repository's top looks before the chat's folder stands alone. */
const UP_LIMIT = 64;

/**
 * @typedef {object} InstructionsBlock
 * @property {string} text  the block, "" when nothing applies
 * @property {{ file: string, chars: number, truncated: boolean, from?: "yours" | "above" }[]} files  the files told, in
 *   the block's order: the person's own (`from: "yours"`, by the path they wrote), the folders' above the chat's
 *   (`"above"`, named from it: ../AGENTS.md), then the chat's folder's own
 * @property {string[]} missing  listed files found in no folder of the walk (or unreadable, or outside it)
 * @property {string[]} yoursMissing  the person's own files not found
 * @property {{ file: string, as: string }[]} same  files told once: each holds what `as`, told before it, holds
 * @property {number} sessionChars
 * @property {string | null} hash  sha256 of the block, 12 hex characters; null when the block is empty
 * @property {Record<string, { file: string, text: string | null }>} read  every file the block looked for, by its full path:
 *   the name it is told by, and its text as read — null where there was none —; what a chat keeps (`kept`)
 */

/** A list knob's paths, each a non-empty string. @param {unknown} v @returns {string[]} */
const pathsOf = (v) => (Array.isArray(v) ? v.filter((f) => typeof f === "string" && f.trim()) : []);

/** A file's text; null where there is none to read: gone, a folder, unreadable. @param {string} abs */
const textAt = (abs) => {
  try {
    return statSync(abs).isFile() ? readFileSync(abs, "utf8") : null;
  } catch {
    return null;
  }
};

/** A file's text as it is told: cut at the cap, the cut said. @param {string} file @param {string} text */
const capped = (file, text) =>
  text.length > INSTRUCTIONS_FILE_CAP ? `${text.slice(0, INSTRUCTIONS_FILE_CAP)}\n…[Filament: ${file} cut at ${INSTRUCTIONS_FILE_CAP.toLocaleString()} of ${text.length.toLocaleString()} characters]` : text;

/** What two files are compared by: their text, line endings aside. @param {string} text */
const sameKey = (text) => text.replace(/\r\n/g, "\n");

/** A path as two spellings of one file compare: Windows names a file the same in any case. @param {string} p */
const keyOf = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Where one of the person's own files is: `~` is their home folder, and a path that names no root is read from it too.
 * @param {string} p @param {string} [home]
 */
export function yourFilePath(p, home = homedir()) {
  const s = String(p).trim();
  if (s === "~") return home;
  if (/^~[\\/]/.test(s)) return join(home, s.slice(2));
  return isAbsolute(s) ? s : join(home, s);
}

/**
 * The folders whose instruction files a chat working in `root` is told from its start: each folder above it up to the
 * top of its repository — the nearest that holds `.git`, a folder or a worktree's file — outermost first, `root` last;
 * outside a repository, `root` alone. A walk to the drive's root, as Claude Code's is, would tell each of Filament's
 * worktrees, which sit inside the main checkout, the checkout's files again.
 * @param {string} root @returns {string[]}
 */
export function foldersUp(root) {
  const start = resolve(root);
  const chain = [start];
  for (let dir = start, n = 0; n < UP_LIMIT; n++) {
    if (existsSync(join(dir, ".git"))) return chain;
    const up = dirname(dir);
    if (up === dir) break;
    chain.unshift(up);
    dir = up;
  }
  return [start];
}

/**
 * @param {any} doc  the effective settings document
 * @param {string} root  the working folder
 * @param {{ extra?: string[], home?: string, kept?: Record<string, { file: string, text: string | null }> | null }} [o]
 *   `extra`: more sections to ride the block (skills), already formatted; `home`: the folder `~` names in the person's
 *   own paths; `kept`: the files as a chat's prompt was written with them (`read`), told as they were — a file the chat
 *   did not look for is read from disk
 * @returns {InstructionsBlock}
 */
export function instructionsBlock(doc, root, { extra = [], home = homedir(), kept = null } = {}) {
  const names = pathsOf(doc?.instructions?.files);
  /** @type {InstructionsBlock["read"]} */
  const read = {};
  /** A file's text, as the chat keeps it or from disk, recorded as read. @param {string} abs @param {string} file */
  const at = (abs, file) => {
    const text = kept && Object.hasOwn(kept, abs) ? kept[abs].text : textAt(abs);
    read[abs] = { file, text };
    return text;
  };
  /** @type {InstructionsBlock["files"]} */
  const found = [];
  /** @type {string[]} */
  const yoursMissing = [];
  /** @type {InstructionsBlock["same"]} */
  const same = [];
  /** What each text told was told as. @type {Map<string, string>} */
  const told = new Map();
  /** A file's section, or null where a file told before it holds the same. @param {string} file @param {string} text @param {"yours" | "above"} [from] */
  const section = (file, text, from) => {
    const was = told.get(sameKey(text));
    if (was !== undefined) {
      same.push({ file, as: was });
      return null;
    }
    told.set(sameKey(text), file);
    found.push({ file, chars: text.length, truncated: text.length > INSTRUCTIONS_FILE_CAP, ...(from ? { from } : {}) });
    return `## ${file}\n${capped(file, text).trimEnd()}`;
  };
  /** @type {string[]} */
  const yours = [];
  for (const file of pathsOf(doc?.instructions?.userFiles)) {
    const text = at(yourFilePath(file, home), file);
    if (text == null) yoursMissing.push(file);
    else {
      const s = section(file, text, "yours");
      if (s) yours.push(s);
    }
  }
  /** @type {string[]} */
  const sections = [];
  /** The names found in some folder of the walk. */
  const seen = new Set();
  const chain = root ? foldersUp(root) : [root];
  for (const [i, folder] of chain.entries()) {
    const up = chain.length - 1 - i;
    for (const file of names) {
      let text = null;
      try {
        text = at(resolveInside(folder, file), up ? `${"../".repeat(up)}${file}` : file);
      } catch {}
      if (text == null) continue;
      seen.add(file);
      const s = up ? section(`${"../".repeat(up)}${file}`, text, "above") : section(file, text);
      if (s) sections.push(s);
    }
  }
  const missing = names.filter((f) => !seen.has(f));
  const session = typeof doc?.instructions?.session === "string" ? doc.instructions.session.trim() : "";
  const parts = [];
  if (yours.length) parts.push(`# The user's instructions for every project\n${yours.join("\n\n")}`);
  if (sections.length) parts.push(`# Project instructions\n${sections.join("\n\n")}`);
  if (session) parts.push(`# Session instructions\n${session.length > INSTRUCTIONS_SESSION_CAP ? `${session.slice(0, INSTRUCTIONS_SESSION_CAP)}\n…[Filament: cut at ${INSTRUCTIONS_SESSION_CAP.toLocaleString()} characters]` : session}`);
  for (const x of extra) if (x && String(x).trim()) parts.push(String(x).trim());
  const text = parts.join("\n\n");
  return { text, files: found, missing, yoursMissing, same, sessionChars: session.length, hash: text ? createHash("sha256").update(text).digest("hex").slice(0, 12) : null, read };
}

/**
 * The instruction files that changed since a chat's prompt was written with them (`kept`, as `read` gave it), each as a
 * note for the person's next message — the prompt keeps their old text until the chat's next compaction, so what the
 * provider caches holds (the owner's of 11-07) —, said once a text: `told` holds the texts said, by path, as hashes.
 * One told of and then back as the prompt has it is said so, once: what was told of it since no longer holds.
 * @param {InstructionsBlock["read"]} kept @param {InstructionsBlock["read"]} now  the same files read from disk
 * @param {Record<string, string>} told
 * @returns {{ path: string, hash: string, text: string }[]}
 */
export function instructionsChanged(kept, now, told) {
  /** @type {{ path: string, hash: string, text: string }[]} */
  const out = [];
  /** @param {string | null} text */
  const hashOf = (text) => createHash("sha256").update(text ?? "").digest("hex").slice(0, 12);
  for (const [path, was] of Object.entries(kept)) {
    const is = now[path]?.text ?? null;
    if (is === was.text || (is != null && was.text != null && sameKey(is) === sameKey(was.text))) {
      const back = hashOf(was.text);
      if (told[path] && told[path] !== back)
        out.push({ path, hash: back, text: was.text == null ? `[Filament: ${was.file} is gone again, as it was when this chat's instructions were written: what was said of it since no longer holds.]` : `[Filament: ${was.file} reads again as this chat's instructions have it: what was said of it since no longer holds.]` });
      continue;
    }
    const hash = hashOf(is);
    if (told[path] === hash) continue;
    const said = was.text == null ? "appeared" : "changed";
    const head = `[Filament: ${was.file} ${said} since this chat's instructions were written; they keep ${was.text == null ? "no text of it" : "its old text"} until the chat's next compaction, and this is what holds now.`;
    const body = is == null ? " It is gone: what it said no longer holds.]" : `${was.text == null ? "" : " It reads now:"}\n\n${capped(was.file, is).trimEnd()}\n]`;
    out.push({ path, hash, text: `${head}${body}` });
  }
  return out;
}

/**
 * Where each of the person's own files stands, for the settings row's lines — found, with its size, or not there — and
 * Claude Code's own file, offered where this computer has one. Sizes only: nothing of what a file says.
 * @param {unknown} paths @param {string} [home]
 * @returns {{ files: { path: string, found: boolean, chars?: number }[], offer: { path: string, chars: number } | null }}
 */
export function yourFilesCheck(paths, home = homedir()) {
  /** @param {string} p */
  const look = (p) => {
    const text = textAt(yourFilePath(p, home));
    return text == null ? { path: p, found: false } : { path: p, found: true, chars: text.length };
  };
  const claude = look("~/.claude/CLAUDE.md");
  return { files: pathsOf(paths).map(look), offer: claude.found ? { path: claude.path, chars: claude.chars || 0 } : null };
}

/** The line a folder's file is told under — what the conversation is searched for, so it is told once while it holds it. @param {string} file */
export const folderNoteHead = (file) => `<folder-instructions file="${file}">`;

/** @typedef {{ file: string, as: string, how: "read" | "edit" | "write", chars: number, truncated: boolean, text: string }} FolderTold */

const DID = Object.freeze({ read: "read", edit: "edited", write: "wrote" });

/**
 * The instruction files of the folders below the chat's own that a round worked in (the Designer's answer of 10-27, as
 * Claude Code reads a subfolder's CLAUDE.md): for each file the round read, edited or wrote — a search's hit or a
 * command's is no work there — each folder between the chat's folder and the file's, outermost first, its
 * `instructions.files`, each told once while the conversation holds it (`told`: a compaction that drops the note makes
 * it untold again). A file the round read itself is not told again; one the same as another of its folder is told
 * once; past FOLDER_NOTES_CAP a file is named, to be told when the agent next works there.
 * @param {string} root  the chat's folder
 * @param {string[]} names  the instruction files' names, as `instructions.files` lists them
 * @param {{ path: string, how: "read" | "edit" | "write" }[]} worked  the round's calls in order, each path as given
 * @param {{ has: (head: string) => boolean, add: (head: string) => void }} told  the heads the conversation holds
 * @param {{ redact?: (s: string) => string }} [o]  what a file's text passes through, as a read's does
 * @returns {{ text: string, told: FolderTold[], left: string[] }}
 */
export function folderInstructions(root, names, worked, told, { redact = (s) => s } = {}) {
  /** @type {FolderTold[]} */
  const out = [];
  /** @type {string[]} */
  const left = [];
  if (!root || !names.length || !worked.length) return { text: "", told: out, left };
  const top = resolve(root);
  const readHere = new Set(worked.filter((w) => w.how === "read").map((w) => keyOf(resolve(top, w.path))));
  const looked = new Set();
  let room = FOLDER_NOTES_CAP;
  for (const w of worked) {
    const rel = relative(top, resolve(top, w.path));
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
    const steps = rel.split(sep).slice(0, -1);
    for (let i = 1; i <= steps.length; i++) {
      const folder = steps.slice(0, i).join("/");
      if (looked.has(keyOf(folder))) continue;
      looked.add(keyOf(folder));
      /** @type {{ file: string, abs: string, head: string }[]} */
      const here = [];
      for (const name of names) {
        try {
          const abs = resolveInside(join(top, ...steps.slice(0, i)), name);
          if (existsSync(abs)) here.push({ file: `${folder}/${String(name).replace(/\\/g, "/")}`, abs, head: folderNoteHead(`${folder}/${String(name).replace(/\\/g, "/")}`) });
        } catch {}
      }
      if (!here.length || here.every((f) => told.has(f.head))) continue;
      /** The texts of this folder told or held already. */
      const texts = new Set();
      for (const f of here) {
        const text = textAt(f.abs);
        if (text == null) continue;
        if (told.has(f.head) || readHere.has(keyOf(f.abs))) {
          texts.add(sameKey(text));
          continue;
        }
        if (texts.has(sameKey(text))) {
          told.add(f.head);
          continue;
        }
        const body = capped(f.file, redact(text));
        if (body.length > room) {
          left.push(f.file);
          continue;
        }
        room -= body.length;
        texts.add(sameKey(text));
        told.add(f.head);
        const as = rel.split(sep).join("/");
        out.push({ file: f.file, as, how: w.how, chars: text.length, truncated: text.length > INSTRUCTIONS_FILE_CAP, text: body });
      }
    }
  }
  const notes = out.map((t) => {
    const folder = t.file.slice(0, t.file.lastIndexOf("/"));
    return `${folderNoteHead(t.file)}\nTold as you ${DID[t.how]} ${t.as}: these hold for your work in ${folder} and the folders below it, beside the project's instructions.\n\n${t.text.trimEnd()}\n</folder-instructions>`;
  });
  if (left.length) notes.push(`The folders you worked in also hold ${left.join(", ")}, not told here for room: read ${left.length === 1 ? "it" : "them"} before you change files there.`);
  return { text: notes.join("\n\n"), told: out, left };
}
