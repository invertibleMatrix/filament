// @ts-check
// The folder a folder's project is made of (HarnessV4_Git_Plan GW-D46, GW-D8): a folder inside a linked worktree of a
// repository belongs to the same place in the repository's main folder, so a chat in `H:\app-fix-x` stands in
// Filament's project with Filament's memory. Read from git's own files, never by running git: the worktree's `.git` file
// names its record (`gitdir: …`), whose `commondir` names the repository's git folder, whose parent is the main folder.
// A submodule (its record has no `commondir`), a bare repository's worktree and every other folder are their own, as
// core/project-id.js has always made them. Each folder is read once a minute at most.
import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { normalizeCwd } from "../core/project-id.js";

/** How long a folder's answer is kept: a worktree made or removed is seen within it. */
const KEEP_MS = 60_000;
/** The answers kept at most; past it the cache starts over. */
const KEEP_MAX = 2000;
/** How many folders up a `.git` is looked for. */
const UP_MAX = 64;

/**
 * Each folder's answer: the folder its project is made of, or null for its own.
 * @type {Map<string, { at: number, folder: string | null }>}
 */
const kept = new Map();

/** @param {string} p */
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The main folder of the linked worktree whose top folder is `top`, or null: `top` holds no `.git` file, the file
 * names no record, the record has no `commondir` (a submodule), or the repository is bare.
 * @param {string} top @param {string} dotGit  `top`'s `.git` file
 */
function mainOf(top, dotGit) {
  const said = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
  if (!said) return null;
  const record = resolve(top, said[1]);
  let common;
  try {
    common = resolve(record, readFileSync(join(record, "commondir"), "utf8").trim());
  } catch {
    return null;
  }
  if (basename(common).toLowerCase() !== ".git") return null;
  const main = dirname(common);
  return isDir(main) && normalizeCwd(main) !== normalizeCwd(top) ? main : null;
}

/**
 * The folder whose project `folder` stands in: the same place in its repository's main folder when it is inside a
 * linked worktree, else `folder` itself, spelled as given (trimmed, no trailing slash). Never throws.
 * @param {string} folder
 * @param {{ asks?: boolean }} [o]  `asks` false: the disk is not asked of the folder — a network share the folder rules
 *   keep out — and it stands in its own project, as written
 * @returns {string}
 */
export function projectFolderOf(folder, { asks = true } = {}) {
  const given = String(folder ?? "").trim().replace(/[\\/]+$/, "");
  const key = normalizeCwd(given);
  if (!key || !asks) return given;
  const now = Date.now();
  const had = kept.get(key);
  if (had && now - had.at < KEEP_MS) return had.folder ?? given;
  /** @type {string | null} */
  let found = null;
  try {
    let dir = resolve(given);
    /** @type {string[]} */
    const below = [];
    for (let i = 0; i < UP_MAX; i++) {
      const dotGit = join(dir, ".git");
      const st = lstatSync(dotGit, { throwIfNoEntry: false });
      if (st) {
        const main = st.isFile() ? mainOf(dir, dotGit) : null;
        if (main) found = join(main, ...below);
        break;
      }
      const up = dirname(dir);
      if (up === dir) break;
      below.unshift(basename(dir));
      dir = up;
    }
  } catch {
    found = null;
  }
  if (kept.size >= KEEP_MAX) kept.clear();
  kept.set(key, { at: now, folder: found });
  return found ?? given;
}

/**
 * The main folder of the repository `folder` is in, from any folder inside it or inside one of its linked worktrees
 * (HarnessV4_Four_Plan FO-D31: a worktree template is the repository's, whichever of its folders a chat starts in); a
 * submodule is its own. Null where no `.git` is found above it. Read from git's files, each time; never throws.
 * @param {string} folder
 * @returns {string | null}
 */
export function repositoryFolderOf(folder) {
  try {
    let dir = resolve(String(folder ?? "").trim());
    for (let i = 0; i < UP_MAX; i++) {
      const dotGit = join(dir, ".git");
      const st = lstatSync(dotGit, { throwIfNoEntry: false });
      if (st) return (st.isFile() ? mainOf(dir, dotGit) : null) ?? dir;
      const up = dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  } catch {}
  return null;
}
