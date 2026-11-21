// @ts-check
// A worktree template (HarnessV4_Four_Plan E19): what a project's list can hold — what git leaves out of a new
// worktree, each measured (FO-D32) — and the copy of a list into a worktree just made (FO-D33). File by file, with the
// disk's fast clone where it has one; a link copied as a link, never followed, and one that points inside the place
// pointed at the same path in the worktree; a file the checkout put there left as git put it. What could not be copied
// is named and the rest copied. Reads the place; writes only into the worktree.
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fewAtOnce } from "../../core/at-once.js";
import { copyPath, copyPathProblem } from "../../core/worktree-copy.js";
import { firstLine, git } from "./snapshot.js";
import { NO_LOCKS, parsePorcelainV2 } from "./inspect.js";

/** What the picker lists at most, biggest first; the rest are counted (FO-D35). */
const CANDIDATES_MAX = 400;
/** Files copied side by side: a copy of many small files waits on each file's open and close. */
const COPY_AT_ONCE = 8;
/** The failures named at most; the rest are counted. */
const FAILED_MAX = 20;
/** The clone where the disk has one, else a copy; never over a file that is there (FO-D33). */
const COPY_MODE = constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE;

/**
 * Why a file or folder could not be read or copied, in words.
 * @param {any} e
 */
function codeWords(e) {
  const code = String(e?.code || "");
  if (code === "EBUSY") return "a program is using it (EBUSY)";
  if (code === "EPERM" || code === "EACCES") return `not allowed: a program holds it, or its rights forbid it (${code})`;
  if (code === "ENOSPC") return "the disk is full (ENOSPC)";
  if (code === "ENAMETOOLONG") return "its path is too long (ENAMETOOLONG)";
  return firstLine(e?.message || String(e));
}

/**
 * @typedef {{ path: string, dir: boolean, link: boolean, bytes: number, files: number, missing: boolean }} Measured
 *   one path of a place: a folder's bytes and files counted through it, a link as one file of no bytes
 * @typedef {{ rel: string, kind: "dir" | "file" | "link", size: number }} Item  one thing under a path, named from
 *   the place's top folder
 */

/**
 * Everything under `top/path`, each folder before what it holds, links not followed; `unread`, the folders that could
 * not be listed. Null where nothing is there.
 * @param {string} top @param {string} path
 * @returns {Promise<{ items: Item[], unread: { path: string, error: string }[] } | null>}
 */
async function listOf(top, path) {
  let st;
  try {
    st = await lstat(join(top, path));
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) return { items: [{ rel: path, kind: "link", size: 0 }], unread: [] };
  if (!st.isDirectory()) return { items: [{ rel: path, kind: "file", size: st.size }], unread: [] };
  /** @type {Item[]} */
  const items = [{ rel: path, kind: "dir", size: 0 }];
  /** @type {{ path: string, error: string }[]} */
  const unread = [];
  const stack = [path];
  while (stack.length) {
    const dir = /** @type {string} */ (stack.pop());
    let entries;
    try {
      entries = await readdir(join(top, dir), { withFileTypes: true });
    } catch (e) {
      unread.push({ path: dir, error: codeWords(e) });
      continue;
    }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`;
      if (e.isSymbolicLink()) items.push({ rel, kind: "link", size: 0 });
      else if (e.isDirectory()) {
        items.push({ rel, kind: "dir", size: 0 });
        stack.push(rel);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = (await lstat(join(top, rel))).size;
        } catch {}
        items.push({ rel, kind: "file", size });
      }
    }
  }
  return { items, unread };
}

/**
 * One path of a place, measured (FO-D32): its bytes and files, a link not followed.
 * @param {string} top  the place's top folder @param {string} path  from it, with "/"
 * @returns {Promise<Measured>}
 */
export async function measure(top, path) {
  const l = await listOf(top, path);
  if (!l) return { path, dir: false, link: false, bytes: 0, files: 0, missing: true };
  let bytes = 0;
  let files = 0;
  for (const it of l.items) {
    if (it.kind === "dir") continue;
    bytes += it.size;
    files++;
  }
  return { path, dir: l.items[0].kind === "dir", link: l.items[0].kind === "link", bytes, files, missing: false };
}

/**
 * What a project's list can hold from `place` (FO-D32): what git ignores and what is not in git yet, as git's status
 * names them (a folder whose files are all left out is named once), each measured, biggest first; past
 * `CANDIDATES_MAX`, counted.
 * @param {string} place  the top folder of the place the chat starts in
 * @returns {Promise<{ ok: true, items: (Measured & { ignored: boolean })[], more: number } | { ok: false, error: string }>}
 */
export async function copyCandidates(place) {
  const st = await git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--ignored"], { cwd: place });
  if (st.code !== 0) return { ok: false, error: firstLine(st.err || st.error || `git status exited ${st.code}`) };
  const left = parsePorcelainV2(st.out).files.filter((f) => (f.kind === "ignored" || f.kind === "untracked") && !copyPathProblem(f.path));
  const measured = await fewAtOnce(left, async (f) => ({ ...(await measure(place, copyPath(f.path))), ignored: f.kind === "ignored" }));
  const here = measured.filter((m) => !m.missing).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { ok: true, items: here.slice(0, CANDIDATES_MAX), more: Math.max(0, here.length - CANDIDATES_MAX) };
}

/**
 * A link copied as a link (FO-D33): one whose whole target lies inside the place points at the same path in the
 * worktree, any other as it pointed. On Windows a folder's link is made a junction, which needs no right of its own.
 * @param {string} src @param {string} dst @param {string} from @param {string} to
 */
async function copyLink(src, dst, from, to) {
  const target = await readlink(src);
  const inside = isAbsolute(target) ? relative(resolve(from), resolve(target)) : null;
  const pointed = inside && !inside.startsWith("..") && !isAbsolute(inside) ? join(to, inside) : target;
  let dir = false;
  try {
    dir = (await stat(src)).isDirectory();
  } catch {}
  await symlink(pointed, dst, process.platform === "win32" ? (dir ? "junction" : "file") : undefined);
}

/**
 * @typedef {{ done: number, total: number, files: number, totalFiles: number, entry: string }} CopyProgress  the bytes
 *   gone through (copied, found there, or failed) of all, the files so, and the path being copied
 * @typedef {object} CopyResult
 * @property {string[]} copied  the paths begun, in the list's order
 * @property {{ path: string, why: string }[]} skipped  the paths not begun: not here, or no path for the list
 * @property {{ path: string, error: string }[]} failed  what could not be copied, the first `FAILED_MAX`
 * @property {number} failedMore  past those
 * @property {number} bytes  copied
 * @property {number} files  copied, links included
 * @property {number} kept  the files the checkout had put there, left as git put them
 * @property {number} total  the bytes the paths hold
 * @property {number} totalFiles
 * @property {string | null} cut  why it stopped before its end, in words
 */

/**
 * Copy a list's paths from a place into a worktree (FO-D33), side by side; a path inside another on the list goes with
 * that one. The disk full stops it; `signal` stops it with its reason's words (Filament stopping). Never throws.
 * @param {{ from: string, to: string, paths: string[], onProgress?: (p: CopyProgress) => void,
 *   signal?: AbortSignal | null }} o
 * @returns {Promise<CopyResult>}
 */
export async function copyInto({ from, to, paths, onProgress = () => {}, signal = null }) {
  /** @type {CopyResult} */
  const r = { copied: [], skipped: [], failed: [], failedMore: 0, bytes: 0, files: 0, kept: 0, total: 0, totalFiles: 0, cut: null };
  /** @param {string} path @param {string} error */
  const fail = (path, error) => {
    if (r.failed.length < FAILED_MAX) r.failed.push({ path, error });
    else r.failedMore++;
  };
  const listed = [...new Set(paths.map(copyPath))];
  /** A path inside another on the list. @param {string} p */
  const within = (p) => listed.some((o) => o !== p && p.toLowerCase().startsWith(`${o.toLowerCase()}/`));
  /** @type {{ path: string, items: Item[] }[]} */
  const plan = [];
  for (const path of listed) {
    const why = copyPathProblem(path);
    if (why) r.skipped.push({ path, why });
    if (why || within(path)) continue;
    const l = await listOf(from, path);
    if (!l) {
      r.skipped.push({ path, why: "not here" });
      continue;
    }
    for (const u of l.unread) fail(u.path, u.error);
    plan.push({ path, items: l.items });
    for (const it of l.items) {
      if (it.kind === "dir") continue;
      r.total += it.size;
      r.totalFiles++;
    }
  }
  let done = 0;
  let through = 0;
  /** @param {string} entry @param {number} size */
  const tick = (entry, size) => {
    done += size;
    through++;
    onProgress({ done, total: r.total, files: through, totalFiles: r.totalFiles, entry });
  };
  /** @type {Set<Promise<void>>} */
  const running = new Set();
  /** @param {Promise<void>} p */
  const run = (p) => {
    const t = p.finally(() => running.delete(t));
    running.add(t);
  };
  outer: for (const { path, items } of plan) {
    r.copied.push(path);
    try {
      await mkdir(dirname(join(to, path)), { recursive: true });
    } catch (e) {
      fail(path, codeWords(e));
      continue;
    }
    for (const it of items) {
      if (signal?.aborted) r.cut = firstLine(String(signal.reason?.message || signal.reason || "stopped"));
      if (r.cut) break outer;
      const dst = join(to, it.rel);
      if (it.kind === "dir") {
        try {
          await mkdir(dst, { recursive: true });
        } catch (e) {
          fail(it.rel, codeWords(e));
        }
        continue;
      }
      while (running.size >= COPY_AT_ONCE) await Promise.race(running);
      const src = join(from, it.rel);
      run(
        (it.kind === "link" ? copyLink(src, dst, from, to) : copyFile(src, dst, COPY_MODE)).then(
          () => {
            r.bytes += it.size;
            r.files++;
            tick(path, it.size);
          },
          (/** @type {any} */ e) => {
            if (e?.code === "EEXIST") r.kept++;
            else if (e?.code === "ENOSPC") r.cut = codeWords(e);
            else fail(it.rel, it.kind === "link" && e?.code === "EPERM" ? "a file link: Windows makes one only in Developer Mode or as an administrator" : codeWords(e));
            tick(path, it.size);
          },
        ),
      );
    }
  }
  await Promise.all(running);
  return r;
}
