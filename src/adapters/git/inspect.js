// @ts-check
// Read-only git for the project folder (harness plan B5): the status, one file's diff, the recent log, the branches,
// and a folder's remote, by which its clones on this machine are found for another one. Nothing here writes — no
// stage, no discard, no commit, no checkout; those are the developer's, by hand. Every call runs in the repository the
// folder belongs to through snapshot.js's `git()`, so an inherited GIT_DIR cannot redirect it, and a missing git or a
// folder outside any repository is answered in words.
import { readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { firstLine, git, repoOf } from "./snapshot.js";
import { EMPTY_TREE, PATHSPEC_MAGIC, STATUS_WORDS, diffFiles, diffPatch, foldersOf, parseNumstat, totalsOf, withPatches } from "./changes.js";
import { fewAtOnce } from "../../core/at-once.js";
import { commitTimes, filesOf } from "../../core/changes-view.js";
import { resolveInside } from "../tools/fs-fence.js";

export const MAX_DIFF_LINES = 2000;
const MAX_LOG = 200;
/** The commits and files a Branch read names at most (HarnessV4_Git_Plan GW-D29); the rest are counted. */
const MAX_BRANCH_COMMITS = 50;
export const MAX_BRANCH_FILES = 500;
/** An untracked file larger than this is listed with no lines read from it. */
export const MAX_UNTRACKED_PATCH_BYTES = 512 * 1024;
/**
 * Filament's reads never take a repository's index lock (HarnessV4_Git_Plan GW-D23): in a worktree where another agent
 * runs `git commit`, a lock a read holds makes that commit fail. `git status` refreshes the index unless told not to; a
 * working tree's diffs are read with the plumbing (`diff-files`, `diff-index`), which never writes it, where the
 * porcelain `git diff` rewrites it even with `--no-optional-locks`.
 */
export const NO_LOCKS = Object.freeze(["--no-optional-locks"]);
/**
 * The names a repository's main branch goes by, in the order they are taken where `origin/HEAD` names none: a place's
 * base (GW-D21) and the Environment block's main branch are one answer.
 */
export const BASE_NAMES = Object.freeze(["main", "master", "trunk", "develop"]);
/** A whole place read's fields before git has answered them (`placeInfo`). */
const WHOLE_UNREAD = Object.freeze({ base: null, onBase: false, ahead: null, behind: null, uncommitted: null });

/**
 * How long a folder's stat is waited for (`folderThere`). A folder on a network mount gone offline — a mapped drive, an
 * SMB or NFS share — answers none for as long as its system waits on the share, a minute and more: asked on the
 * server's thread, as a check of whether it is there was, it held every request and stream that long, and a desk asks
 * its chats' folders' remotes every minute.
 */
export const FOLDER_STAT_MS = 2000;
/**
 * How many stats that have not answered may be under way at once. Each holds one of the few threads Node's file calls
 * share until its system gives up on the share: past this many, a folder is not asked, and is unread, so that every
 * other file read of the server's goes on.
 */
export const FOLDER_STATS_HUNG = 2;
/**
 * The stats under way, by folder, so a folder that does not answer is asked once however often it is read; `late`: it
 * is past `FOLDER_STAT_MS`. @type {Map<string, { answer: Promise<boolean>, late: boolean }>}
 */
const statting = new Map();
/** How many stats under way are late. */
let hung = 0;

/**
 * Whether a folder is there, asked off the server's thread and waited for `ms` at most: true, false (gone, or not
 * readable), or null where its stat has not answered by then — it goes on, and the folder read again meanwhile is null
 * at once. `statOf`: the stat (the tests').
 * @param {string} folder @param {{ ms?: number, statOf?: (path: string) => Promise<unknown> }} [o]
 * @returns {Promise<boolean | null>}
 */
export async function folderThere(folder, { ms = FOLDER_STAT_MS, statOf = stat } = {}) {
  let asking = statting.get(folder);
  if (asking?.late) return null;
  if (!asking) {
    if (hung >= FOLDER_STATS_HUNG) return null;
    const answer = Promise.resolve()
      .then(() => statOf(folder))
      .then(
        () => true,
        () => false,
      );
    const it = { answer, late: false };
    asking = it;
    statting.set(folder, it);
    const timer = setTimeout(() => {
      it.late = true;
      hung++;
    }, ms);
    timer.unref?.();
    void answer.finally(() => {
      clearTimeout(timer);
      if (it.late) hung--;
      statting.delete(folder);
    });
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<null>} */
  const waited = new Promise((r) => (timer = setTimeout(() => r(null), ms)));
  try {
    return await Promise.race([asking.answer, waited]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {object} StatusFile
 * @property {string} path  repository-relative
 * @property {string | null} oldPath  the source of a rename
 * @property {string} index  the index column of `git status` (staged change), " " when none
 * @property {string} worktree  the worktree column (unstaged change), " " when none
 * @property {"staged" | "unstaged" | "both" | "untracked" | "ignored" | "conflicted"} kind
 * @property {{ head: string, index: string, worktree: string }} [modes]  a tracked entry's octal modes in HEAD, the
 *   index and the worktree, "000000" where one lacks it (the `1`, `2` and `u` rows; in conflict, stage 2 — ours, the
 *   commit's — stands for HEAD and the index)
 * @property {string} [headBlob]  the blob HEAD holds at it, all zeros where HEAD lacks it (the `1`, `2` and `u` rows; in
 *   conflict, stage 2's)
 * @property {boolean} [submodule]  the entry is a submodule (the `1`, `2` and `u` rows)
 */

/**
 * `git status --porcelain=v2 --branch -z` → the branch block and the files. The NUL-separated stream: `# key value`
 * header lines, `1 XY sub mH mI mW hH hI path` ordinary entries, `2 XY sub mH mI mW hH hI Xscore path` renames
 * followed by the original path as its own field, `u XY sub m1 m2 m3 mW h1 h2 h3 path` unmerged, `? path` untracked,
 * `! path` ignored.
 * @param {string} z
 */
export function parsePorcelainV2(z) {
  /** @type {{ head: string | null, oid: string | null, upstream: string | null, ahead: number, behind: number }} */
  const branch = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  /** @type {StatusFile[]} */
  const files = [];
  const parts = String(z || "").split("\0");
  const kindOf = (x, y) => (x !== "." && y !== "." ? "both" : x !== "." ? "staged" : "unstaged");
  for (let i = 0; i < parts.length; ) {
    const line = parts[i++];
    if (!line) continue;
    if (line.startsWith("# ")) {
      const [, key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }
    const tag = line[0];
    if (tag === "1" || tag === "2") {
      const f = line.split(" ");
      const xy = f[1] || "..";
      const fixed = tag === "1" ? 8 : 9;
      const path = f.slice(fixed).join(" ");
      const oldPath = tag === "2" ? (parts[i++] ?? null) : null;
      files.push({
        path,
        oldPath,
        index: xy[0] === "." ? " " : xy[0],
        worktree: xy[1] === "." ? " " : xy[1],
        kind: kindOf(xy[0], xy[1]),
        modes: { head: f[3] || "000000", index: f[4] || "000000", worktree: f[5] || "000000" },
        headBlob: f[6] || "",
        submodule: (f[2] || "")[0] === "S",
      });
    } else if (tag === "u") {
      // `u XY sub m1 m2 m3 mW h1 h2 h3 path`: the three stages' modes and blobs, then the worktree's mode.
      const f = line.split(" ");
      const xy = f[1] || "..";
      files.push({
        path: f.slice(10).join(" "),
        oldPath: null,
        index: xy[0],
        worktree: xy[1],
        kind: "conflicted",
        modes: { head: f[4] || "000000", index: f[4] || "000000", worktree: f[6] || "000000" },
        headBlob: f[8] || "",
        submodule: (f[2] || "")[0] === "S",
      });
    } else if (tag === "?") files.push({ path: line.slice(2), oldPath: null, index: " ", worktree: "?", kind: "untracked" });
    else if (tag === "!") files.push({ path: line.slice(2), oldPath: null, index: " ", worktree: "!", kind: "ignored" });
  }
  return { branch, files };
}

/** `--numstat -z` totals: added and removed lines over every file (binaries count as none). @param {string} z */
function numstatTotals(z) {
  let added = 0,
    removed = 0;
  for (const line of String(z || "").split("\0")) {
    const m = /^(-|\d+)\t(-|\d+)\t/.exec(line);
    if (!m || m[1] === "-") continue;
    added += Number(m[1]);
    removed += Number(m[2]);
  }
  return { added, removed };
}

/**
 * The working tree's state: branch, tracking, and the changed files with staged/unstaged line totals. `eachFile`: a new
 * folder's files each by its own name, where git names the folder whole — what a reader of each file's patch needs;
 * git's own setting still says whether untracked files are listed at all.
 * @param {string} folder @param {{ eachFile?: boolean }} [o]
 */
export async function statusOf(folder, { eachFile = false } = {}) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, repo: null, error: found.error };
  const { repo } = found;
  const read = (/** @type {string[]} */ more) => git([...NO_LOCKS, "status", "--porcelain=v2", "--branch", "-z", ...more], { cwd: repo });
  let st = await read([]);
  // Read again with every untracked file named only where git named a folder whole: where its setting lists none, none.
  if (eachFile && st.code === 0 && parsePorcelainV2(st.out).files.some((f) => f.kind === "untracked" && f.path.endsWith("/"))) st = await read(["--untracked-files=all"]);
  if (st.code !== 0) return { ok: false, repo, error: firstLine(st.err || st.error || `git status exited ${st.code}`) };
  const parsed = parsePorcelainV2(st.out);
  const [unstaged, staged] = await Promise.all([
    git(["diff-files", "--numstat", "-z", "-M"], { cwd: repo }),
    git(["diff-index", "--cached", "--numstat", "-z", "-M", found.head || EMPTY_TREE], { cwd: repo }),
  ]);
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (const f of parsed.files) {
    if (f.kind === "both") counts.staged++, counts.unstaged++;
    else if (f.kind in counts) counts[f.kind]++;
  }
  return {
    ok: true,
    repo,
    head: found.head,
    branch: parsed.branch.head,
    detached: !parsed.branch.head,
    upstream: parsed.branch.upstream,
    ahead: parsed.branch.ahead,
    behind: parsed.branch.behind,
    files: parsed.files.filter((f) => f.kind !== "ignored"),
    counts,
    stats: { unstaged: numstatTotals(unstaged.out), staged: numstatTotals(staged.out) },
    error: null,
  };
}

/**
 * @typedef {object} PlaceInfo  where a folder works (HarnessV4_Git_Plan step 2)
 * @property {boolean} ok  false where no repository holds the folder, or git could not read it (`error`)
 * @property {string} cwd  the folder as asked
 * @property {string | null} place  the top folder of its repository or worktree, as git spells it
 * @property {boolean} worktree  the place is a linked worktree, not its repository's main folder
 * @property {string | null} main  the repository's main folder (the place itself when it is that); null for a bare
 *   repository's worktree
 * @property {string | null} branch  null on a detached HEAD
 * @property {boolean} detached
 * @property {string | null} head  the short commit HEAD is at; null before the first commit
 * @property {string | null} error  in words
 * @property {string | null} [base]  `whole` only: the branch it is compared with (GW-D21); null where there is none
 * @property {boolean} [onBase]  `whole` only: the place is on its base branch itself
 * @property {number | null} [ahead]  `whole` only: commits it has that the base lacks; null without a base or a commit
 * @property {number | null} [behind]  `whole` only: commits the base has that it lacks
 * @property {boolean} [fresh]  `whole` only: a branch none of the base's lacks commits of, that never moved since it was
 *   made (its reflog's one line) — nothing of its own yet, not merged
 * @property {{ files: number, added: number, removed: number } | null} [uncommitted]  `whole` only: the files git
 *   status lists (an untracked one by its own name, as Branch lists it), and the lines the tracked ones add and remove
 *   against HEAD
 * @property {{ files: number, added: number, removed: number } | null} [sinceBase]  `sinceBase` only: all the place
 *   holds that its base lacks, committed or not — its working tree against where its branch left the base, an untracked
 *   file's lines too; on its base, or with none, what is uncommitted. Null where git could not tell
 */

/**
 * Where a folder works (HarnessV4_Git_Plan step 2, GW-D20): its place, whether that is a linked worktree and of which
 * repository, and its branch, or the commit a detached HEAD is at. `whole` adds the base branch (GW-D21), how far the
 * place is ahead of it and behind, and what is uncommitted; `sinceBase` with it, the lines the place holds that its base
 * lacks (the composer's `+N −N`, the owner's of 11-08: "as a whole changes in current working branch"). Read-only; a
 * folder outside any repository, or one that is gone, is answered in words.
 * @param {string} folder @param {{ whole?: boolean, sinceBase?: boolean }} [o]
 * @returns {Promise<PlaceInfo>}
 */
export async function placeInfo(folder, { whole = false, sinceBase = false } = {}) {
  const extra = whole ? WHOLE_UNREAD : {};
  /** @param {string} error */
  const none = (error) => noPlace(folder, error, { whole });
  if (!folder) return none("no folder was named");
  const cwd = resolve(folder);
  const is = await folderThere(cwd);
  if (is === null) return none(`the folder did not answer in ${FOLDER_STAT_MS / 1000} s: the drive or share it is on may be offline`);
  if (!is) return none("the folder is gone");
  const dirs = await git(
    ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
    { cwd },
  );
  if (dirs.error) return none(dirs.error);
  const [place, gitDir, common] = dirs.out.split(/\r?\n/);
  if (dirs.code !== 0 || !place) return none(dirs.code !== 0 ? "not in a git repository" : "git named no top folder");
  const worktree = !!gitDir && !!common && gitDir !== common;
  const main = !worktree ? place : basename(common) === ".git" ? dirname(common) : null;
  const [sym, at] = await Promise.all([
    git(["symbolic-ref", "-q", "--short", "HEAD"], { cwd: place }),
    git(["rev-parse", "-q", "--verify", "--short", "HEAD"], { cwd: place }),
  ]);
  const branch = sym.code === 0 && sym.out ? sym.out : null;
  const head = at.code === 0 && at.out ? at.out : null;
  /** @type {PlaceInfo} */
  const info = { ok: true, cwd: folder, place, worktree, main, branch, detached: !branch, head, error: null, ...extra };
  if (!whole) return info;
  const reads = { listed: listedIn(place), based: baseOf(place) };
  await Promise.all([wholeOnto(info, reads), sinceBase ? sinceBaseOnto(info, reads) : null]);
  return info;
}

/**
 * What a place holds that its base lacks, onto its info as `sinceBase`: the working tree against where its branch left
 * the base — one diff, so a line a commit added and the working tree took back counts none, and a file moved counts as
 * moved (`-M`, as Changes reads it) —, an untracked file's lines as its diff would add them; on its base, or with none,
 * against HEAD; before the first commit, against nothing. Null where git could not tell, or the branch shares no commit
 * with its base.
 * @param {PlaceInfo} info  an ok one
 * @param {{ listed: ReturnType<typeof listedIn>, based: ReturnType<typeof baseOf> }} reads
 */
async function sinceBaseOnto(info, { listed, based }) {
  const place = /** @type {string} */ (info.place);
  const { head, branch } = info;
  info.sinceBase = null;
  const [st, base] = await Promise.all([listed, based]);
  if (st.code !== 0) return;
  let from = head ? "HEAD" : EMPTY_TREE;
  if (head && base && branch !== base.name) {
    const mb = await git(["merge-base", base.ref, "HEAD"], { cwd: place });
    if (mb.code !== 0 || !mb.out) return;
    from = mb.out.trim();
  }
  const num = await git(["diff-index", "--numstat", "-z", "-M", from], { cwd: place });
  if (num.code !== 0) return;
  // A file listed with no line changed and its path on its row is one git lists for its stat alone — touched, its
  // bytes as they were (the index is never refreshed, GW-D23) —: no change. A rename's row names its paths apart.
  const rows = String(num.out || "").split("\0").filter((l) => /^(-|\d+)\t(-|\d+)\t/.test(l));
  const tracked = rows.filter((l) => !/^0\t0\t./.test(l)).length;
  const untracked = parsePorcelainV2(st.out).files.filter((f) => f.kind === "untracked").map((f) => f.path);
  const totals = numstatTotals(num.out);
  info.sinceBase = { files: tracked + untracked.length, added: totals.added + (await untrackedLines(place, untracked)), removed: totals.removed };
}

/**
 * The lines untracked files add, as their diffs would: up to `MAX_BRANCH_FILES` of them, each read whole up to
 * `MAX_UNTRACKED_PATCH_BYTES` — a larger one, a binary one, a folder or one gone meanwhile counts none. Each file read
 * apart from the server's thread and its newlines found natively: the header's read runs at every turn's end.
 * @param {string} place @param {string[]} paths  repository-relative
 */
async function untrackedLines(place, paths) {
  const counts = await fewAtOnce(paths.slice(0, MAX_BRANCH_FILES), async (rel) => {
    try {
      const abs = join(place, rel);
      const st = await stat(abs);
      if (!st.isFile() || st.size > MAX_UNTRACKED_PATCH_BYTES) return 0;
      const buf = await readFile(abs);
      if (buf.subarray(0, 8192).includes(0)) return 0;
      let n = 0;
      for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
      return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
    } catch {
      return 0;
    }
  });
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Where a folder works and, where its place is kept apart from its base — a linked worktree, or a branch other than the
 * base —, what it holds that the base lacks: how far ahead and behind, and what is uncommitted, as a whole read says
 * them (the owner's of 10-31: "i might forget if a thread has unapplied work into main branch"). A place on its base, or
 * a main folder with none, reads its base alone: what is uncommitted there is in the base's own folder, kept apart from
 * nothing. Read-only.
 * @param {string} folder
 * @returns {Promise<PlaceInfo>}
 */
export async function apartInfo(folder) {
  const info = await placeInfo(folder);
  if (!info.ok || !info.place) return { ...info, ...WHOLE_UNREAD };
  const based = baseOf(info.place);
  const base = await based;
  /** @type {PlaceInfo} */
  const out = { ...info, ...WHOLE_UNREAD };
  if (!info.worktree && (!base || info.branch === base.name)) {
    if (!base) return out;
    return { ...out, base: base.name, onBase: true, ahead: info.head ? 0 : null, behind: info.head ? 0 : null };
  }
  await wholeOnto(out, { listed: listedIn(info.place), based });
  return out;
}

/**
 * What `git status` lists in a place, untracked files by their own names, without the index lock (GW-D23).
 * @param {string} place
 */
const listedIn = (place) => git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: place });

/**
 * The files uncommitted in the repository a folder belongs to (11-09) — staged or not, untracked ones by their own
 * names — as git names them from its top, read without the index lock (GW-D23): what of a task graph's merged change is
 * still uncommitted. Why not, where no repository holds the folder or git could not read it.
 * @param {string} folder @returns {Promise<{ ok: true, repo: string, files: string[] } | { ok: false, error: string }>}
 */
export async function uncommittedIn(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error || "no repository holds the folder" };
  const st = await listedIn(found.repo);
  if (st.code !== 0) return { ok: false, error: firstLine(st.err || st.error || `git status exited ${st.code}`) };
  return { ok: true, repo: found.repo, files: parsePorcelainV2(st.out).files.filter((f) => f.kind !== "ignored").map((f) => f.path) };
}

/**
 * The rest of a whole read onto a place's info: what is uncommitted, the base branch, how far ahead and behind it.
 * `listed` and `based`: the place's status and base, read once for every reader of them.
 * @param {PlaceInfo} info  an ok one
 * @param {{ listed: ReturnType<typeof listedIn>, based: ReturnType<typeof baseOf> }} reads
 */
async function wholeOnto(info, { listed, based }) {
  const place = /** @type {string} */ (info.place);
  const { head, branch } = info;
  const [st, base] = await Promise.all([listed, based]);
  if (st.code === 0) {
    const files = parsePorcelainV2(st.out).files.filter((f) => f.kind !== "ignored").length;
    const lines = await git(["diff-index", "--numstat", "-z", ...(head ? ["HEAD"] : ["--cached", EMPTY_TREE])], { cwd: place });
    info.uncommitted = { files, ...numstatTotals(lines.out) };
  }
  if (!base) return;
  info.base = base.name;
  info.onBase = branch === base.name;
  if (head && !info.onBase) {
    const ab = await git(["rev-list", "--left-right", "--count", `${base.ref}...HEAD`], { cwd: place });
    const m = /^(\d+)\s+(\d+)$/.exec(ab.out);
    if (ab.code === 0 && m) {
      info.behind = Number(m[1]);
      info.ahead = Number(m[2]);
    }
    // Nothing ahead is "merged" only where it had commits: a branch made a moment ago has none of its own yet, which its
    // reflog tells — one line, its making (seen live on S7: a new repro lane read "merged into main"). Unread, unsaid.
    if (branch && info.ahead === 0) {
      const log = await git(["reflog", "show", "-n", "2", "--format=%h", `refs/heads/${branch}`], { cwd: place });
      if (log.code === 0) info.fresh = log.out.split(/\r?\n/).filter(Boolean).length === 1;
    }
  } else if (head) {
    info.ahead = 0;
    info.behind = 0;
  }
}

/**
 * A place as the Changes tab reads it (the Designer's of 10-29): where it is, its branch and its base, how far ahead
 * and behind, when its last commit was, and each uncommitted file with its counts (core/changes-view.js `filesOf`) —
 * one status and one numstat for the files, beside `placeInfo`'s own reads and the base's.
 * @param {string} folder
 * @returns {Promise<PlaceInfo & { headAt: number | null, files: import("../../core/changes-view.js").PlaceFile[] }>}
 */
export async function placeChanges(folder) {
  const info = await placeInfo(folder);
  if (!info.ok || !info.place) return { ...info, ...WHOLE_UNREAD, headAt: null, files: [] };
  const place = info.place;
  const [st, counts, when, base] = await Promise.all([
    listedIn(place),
    git(["diff-index", "--numstat", "-z", "-M", ...(info.head ? ["HEAD"] : ["--cached", EMPTY_TREE])], { cwd: place }),
    info.head ? git(["log", "-1", "--format=%ct", "HEAD"], { cwd: place }) : Promise.resolve(null),
    baseOf(place),
  ]);
  const files = st.code === 0 ? filesOf(parsePorcelainV2(st.out).files, parseNumstat(counts.out)) : [];
  const added = files.reduce((n, f) => n + (f.added || 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed || 0), 0);
  /** @type {PlaceInfo & { headAt: number | null, files: import("../../core/changes-view.js").PlaceFile[] }} */
  const out = { ...info, ...WHOLE_UNREAD, uncommitted: st.code === 0 ? { files: files.length, added, removed } : null, headAt: when?.code === 0 ? Number(when.out.trim()) * 1000 || null : null, files };
  if (st.code !== 0) out.error = st.error || "git status failed";
  if (!base) return out;
  out.base = base.name;
  out.onBase = info.branch === base.name;
  if (info.head && !out.onBase) {
    const ab = await git(["rev-list", "--left-right", "--count", `${base.ref}...HEAD`], { cwd: place });
    const m = /^(\d+)\s+(\d+)$/.exec(ab.out);
    if (ab.code === 0 && m) {
      out.behind = Number(m[1]);
      out.ahead = Number(m[2]);
    }
  } else if (info.head) {
    out.ahead = 0;
    out.behind = 0;
  }
  return out;
}

/** The paths one `git log` names at most, and their characters: a Windows command line holds about 32,000. */
const LOG_PATHS = 100;
const LOG_CHARS = 16_000;

/**
 * Each named path's newest commit since a moment, in ms — what tells a write that is committed already from one that
 * sits. A `git log` for each part of the list, under Windows' command-line limit; `error`, where one failed: its paths
 * have no time then.
 * @param {string} place @param {number} sinceMs @param {string[]} paths
 * @returns {Promise<{ times: Map<string, number>, error: string | null }>}
 */
export async function lastCommits(place, sinceMs, paths) {
  /** @type {Map<string, number>} */
  const times = new Map();
  let error = /** @type {string | null} */ (null);
  // No window, no --since: git reads "@0" as no date at all and answers nothing.
  const since = sinceMs > 0 ? [`--since=@${Math.floor(sinceMs / 1000)}`] : [];
  for (const part of partsOf(paths)) {
    const r = await git(["-c", "core.quotepath=off", "log", ...since, "--format=@@%ct", "--name-only", "HEAD", "--", ...part], { cwd: place }).catch((e) => ({ code: -1, out: "", err: "", error: String(e?.message || e) }));
    if (r.code !== 0) {
      error ||= firstLine(r.error || r.err || r.out) || `git log exited ${r.code}`;
      continue;
    }
    for (const [path, at] of commitTimes(r.out)) if (!times.has(path)) times.set(path, at);
  }
  return { times, error };
}

/** A list of paths in parts of at most LOG_PATHS paths and LOG_CHARS characters. @param {string[]} paths */
function partsOf(paths) {
  /** @type {string[][]} */
  const out = [];
  let part = /** @type {string[]} */ ([]);
  let chars = 0;
  for (const p of paths) {
    if (part.length && (part.length >= LOG_PATHS || chars + p.length + 3 > LOG_CHARS)) {
      out.push(part);
      part = [];
      chars = 0;
    }
    part.push(p);
    chars += p.length + 3;
  }
  if (part.length) out.push(part);
  return out;
}

/**
 * A folder no place was read for, and why, in the shape `placeInfo` answers.
 * @param {string} cwd @param {string} error @param {{ whole?: boolean }} [o] @returns {PlaceInfo}
 */
export function noPlace(cwd, error, { whole = false } = {}) {
  const none = { ok: false, cwd, place: null, worktree: false, main: null, branch: null, detached: false, head: null };
  return { ...none, error, ...(whole ? WHOLE_UNREAD : {}) };
}

/**
 * @typedef {import("./changes.js").FileChange} FileChange
 * @typedef {{ files: FileChange[], more: number, totals: { files: number, added: number, removed: number } }} FileList
 *   up to `MAX_BRANCH_FILES` files, how many more there are, and the counts of them all
 * @typedef {{ committed: FileList | null, uncommitted: FileList | null }} BranchFiles  null where there is none to
 *   read (no base, or on it) or git could not tell
 * @typedef {PlaceInfo & { commits: { hash: string, subject: string }[], moreCommits: number, from: string | null,
 *   files: BranchFiles }} BranchPlace
 */

/**
 * What merging a place's branch would bring (HarnessV4_Git_Plan step 3, GW-D29): the place read whole, the commits it
 * has that its base lacks — their subjects, up to `MAX_BRANCH_COMMITS` —, the files those commits changed from where
 * the branch left the base (`from`), and what is uncommitted, untracked files included. On its base, or with none,
 * only what is uncommitted. Read-only; the working tree through the plumbing (GW-D31).
 * @param {string} folder @returns {Promise<BranchPlace>}
 */
export async function branchOf(folder) {
  const info = await placeInfo(folder);
  /** @type {BranchPlace} */
  const out = { ...info, ...WHOLE_UNREAD, commits: [], moreCommits: 0, from: null, files: { committed: null, uncommitted: null } };
  if (!info.ok || !info.place) return out;
  const place = info.place;
  // The place read whole, what is uncommitted and what the commits brought, side by side, its status and its base
  // read once for all three.
  const reads = { listed: listedIn(place), based: baseOf(place) };
  const [, uncommitted] = await Promise.all([wholeOnto(out, reads), uncommittedOf(place, info.head, reads.listed), committedOnto(out, place, reads.based)]);
  out.files.uncommitted = uncommitted;
  out.moreCommits = Math.max(0, (out.ahead ?? out.commits.length) - out.commits.length);
  return out;
}

/**
 * The commits a branch has that its base lacks, onto `out`: their subjects, where the branch left the base, and the
 * files they changed from there; git's refusal of the last as `out.error`. Nothing on the base itself, without one, or
 * before the first commit.
 * @param {BranchPlace} out @param {string} place @param {ReturnType<typeof baseOf>} based
 */
async function committedOnto(out, place, based) {
  const base = await based;
  if (!base || !out.head || out.branch === base.name) return;
  const [log, from] = await Promise.all([
    git(["log", `--max-count=${MAX_BRANCH_COMMITS}`, "--format=%h%x09%s", `${base.ref}..HEAD`], { cwd: place }),
    git(["merge-base", base.ref, "HEAD"], { cwd: place }),
  ]);
  if (log.code === 0)
    out.commits = log.out.split(/\r?\n/).filter(Boolean).map((l) => ({ hash: l.split("\t")[0], subject: l.split("\t").slice(1).join("\t") }));
  if (from.code !== 0 || !from.out) return;
  out.from = from.out.slice(0, 8);
  const d = await diffFiles(place, from.out, "HEAD");
  if (d.ok) out.files.committed = listOf(d.files);
  else out.error = d.error;
}

/** A list of files cut at `MAX_BRANCH_FILES`, counted whole. @param {FileChange[]} files @returns {FileList} */
const listOf = (files) => ({ files: files.slice(0, MAX_BRANCH_FILES), more: Math.max(0, files.length - MAX_BRANCH_FILES), totals: totalsOf(files) });

/**
 * A place's uncommitted files against HEAD: what `git status` lists, an untracked file by its own name, with the lines
 * the working tree adds and removes — an untracked file's its lines, read bounded. Without the index lock (GW-D23).
 * @param {string} place @param {string | null} head @param {ReturnType<typeof listedIn>} listed  its status
 * @returns {Promise<FileList | null>}  null where git could not tell
 */
async function uncommittedOf(place, head, listed) {
  const [st, num] = await Promise.all([listed, git(["diff-index", "--numstat", "-z", "-M", head ? "HEAD" : EMPTY_TREE], { cwd: place })]);
  if (st.code !== 0) return null;
  const counts = num.code === 0 ? parseNumstat(num.out) : new Map();
  /** @type {FileChange[]} */
  const files = [];
  for (const f of parsePorcelainV2(st.out).files) {
    if (f.kind === "ignored") continue;
    if (f.kind === "untracked") {
      const t = files.length < MAX_BRANCH_FILES ? untrackedText(join(place, f.path)) : { lines: null, binary: false };
      files.push({ path: f.path, oldPath: null, status: "added", added: t.lines?.length ?? 0, removed: 0, binary: t.binary });
      continue;
    }
    // A rename, an addition or a copy is the index's word; a change since, the working tree's.
    const letter = f.kind === "conflicted" ? "U" : "RCA".includes(f.index) ? f.index : f.worktree !== " " ? f.worktree : f.index;
    const c = counts.get(f.path) || { added: 0, removed: 0, binary: false };
    files.push({ path: f.path, oldPath: f.oldPath, status: STATUS_WORDS[letter] || letter, ...c });
  }
  return listOf(files);
}

/**
 * One file of a Branch read with its diff (GW-D29): `committed`, from where the branch left its base to HEAD; else
 * `uncommitted`, the working tree against HEAD (`diffOf`). `oldPath`: a rename's source.
 * @param {string} folder  the place
 * @param {string} path  repository-relative
 * @param {{ part: "committed" | "uncommitted", oldPath?: string | null, maxLines?: number }} o
 * @returns {Promise<FileDiff>}
 */
export async function branchFileOf(folder, path, { part, oldPath = null, maxLines = MAX_DIFF_LINES }) {
  if (part !== "committed") return diffOf(folder, path, { oldPath, maxLines });
  /** @param {string | null} error @param {string | null} [rel] @returns {FileDiff} */
  const none = (error, rel = null) => ({ ok: !error, path: rel, patch: "", truncated: false, lines: 0, binary: false, untracked: false, error });
  const found = await repoOf(folder);
  if (!found.repo) return none(found.error || "not in a git repository");
  const { repo } = found;
  let rel;
  try {
    rel = relative(resolve(repo), resolveInside(repo, join(folder, String(path || "")))).replace(/\\/g, "/");
  } catch (/** @type {any} */ e) {
    return none(e.message);
  }
  const base = await baseOf(repo);
  if (!base) return none("no base branch to compare with", rel);
  const from = await git(["merge-base", base.ref, "HEAD"], { cwd: repo });
  if (from.code !== 0 || !from.out) return none(`the branch shares no commit with ${base.name}`, rel);
  const d = await diffFiles(repo, from.out, "HEAD", { paths: oldPath ? [String(oldPath), rel] : [rel] });
  if (!d.ok) return none(d.error, rel);
  const f = d.files.find((x) => x.path === rel);
  if (!f) return none(null, rel);
  const [p] = await withPatches(repo, from.out, "HEAD", [f], maxLines);
  return { ...none(null, rel), patch: p.patch || "", truncated: !!p.truncated, lines: p.lines || 0, binary: f.binary, ...(p.size != null ? { size: p.size } : {}) };
}

/**
 * The branch a place is compared with (HarnessV4_Git_Plan GW-D21): the local branch `origin/HEAD` names, else that
 * remote branch, else the first of `BASE_NAMES` it has; null where there is none. `ref` is its whole name, never
 * mistaken for a tag of the same name.
 * @param {string} place @returns {Promise<{ name: string, ref: string } | null>}
 */
export async function baseOf(place) {
  const heads = BASE_NAMES.map((name) => `refs/heads/${name}`);
  const r = await git(["for-each-ref", "--format=%(refname)%09%(symref)", "refs/remotes/origin/HEAD", ...heads], { cwd: place });
  if (r.code !== 0) return null;
  /** @type {Map<string, string>} the ref, and the ref it points at (empty for a plain one) */
  const refs = new Map(r.out.split(/\r?\n/).filter(Boolean).map((l) => [l.split("\t")[0], l.split("\t")[1] || ""]));
  const named = refs.get("refs/remotes/origin/HEAD");
  if (named && named.startsWith("refs/remotes/origin/")) {
    const name = named.slice("refs/remotes/origin/".length);
    const local = await git(["rev-parse", "-q", "--verify", `refs/heads/${name}`], { cwd: place });
    return local.code === 0 ? { name, ref: `refs/heads/${name}` } : { name: `origin/${name}`, ref: named };
  }
  const name = BASE_NAMES.find((n) => refs.has(`refs/heads/${n}`));
  return name ? { name, ref: `refs/heads/${name}` } : null;
}

/**
 * @typedef {object} FileDiff  one file's diff as the Changes pane opens it
 * @property {boolean} ok
 * @property {string | null} path  repository-relative
 * @property {string} patch  the unified diff, clipped at the line cap; empty for a binary file or no change
 * @property {boolean} truncated
 * @property {number} lines  the patch's full line count
 * @property {boolean} binary
 * @property {number} [size]  a binary file's bytes
 * @property {boolean} untracked
 * @property {string | null} error  in words
 */

/**
 * One file's uncommitted change: the working tree against HEAD, staged and unstaged as one (HarnessV4_Git_Plan GW-D30),
 * clipped, read through the plumbing (GW-D31). An untracked file has no diff in git's eyes; it is shown as an addition
 * read from the working tree, bounded. `oldPath`: a rename's source, which git needs to show it as one.
 * @param {string} folder @param {string} path  repository- or folder-relative (resolved inside the repository)
 * @param {{ oldPath?: string | null, maxLines?: number }} [opts]
 * @returns {Promise<FileDiff>}
 */
export async function diffOf(folder, path, { oldPath = null, maxLines = MAX_DIFF_LINES } = {}) {
  const found = await repoOf(folder);
  if (!found.repo) return noDiff(found.error || "not in a git repository");
  const at = placed(found.repo, folder, path);
  return "error" in at ? noDiff(at.error) : diffAlone(found.repo, found.head || EMPTY_TREE, at, oldPath, maxLines);
}

/**
 * Many files' uncommitted changes, each as `diffOf` reads it alone, in their order: a Changes view's two hundred files
 * in a few git calls, where each file's own took four or five, one after another. Read together: the files no rename
 * names — listed with no file paired to another, as one path alone lists — their patches from one diff (`withPatches`),
 * and whether git tracks the ones it lists no change for from one `ls-files`. Read alone, as `diffOf` reads it: a
 * rename (`oldPath`), a path git reads as a pattern, a file whose path holds other changed files (one that was a
 * folder), and every file of a call that failed. `untracked`: the status says git does not track it, so it is read
 * from the working tree at once.
 * @param {string} folder @param {{ path: string, oldPath?: string | null, untracked?: boolean }[]} files
 * @param {{ maxLines?: number }} [opts]
 * @returns {Promise<FileDiff[]>}
 */
export async function diffsOf(folder, files, { maxLines = MAX_DIFF_LINES } = {}) {
  const found = await repoOf(folder);
  if (!found.repo) return files.map(() => noDiff(found.error || "not in a git repository"));
  const { repo } = found;
  const base = found.head || EMPTY_TREE;
  /** @type {FileDiff[]} */
  const out = new Array(files.length);
  /** @type {{ i: number, abs: string, rel: string }[]} */
  const together = [];
  /** @type {{ i: number, abs: string, rel: string }[]} */
  const alone = [];
  files.forEach((f, i) => {
    const at = placed(repo, folder, f.path);
    if ("error" in at) out[i] = noDiff(at.error);
    else if (f.untracked) out[i] = untrackedDiff(at.abs, at.rel, maxLines);
    else (f.oldPath || PATHSPEC_MAGIC.test(at.rel) ? alone : together).push({ i, ...at });
  });
  const d = together.length ? await diffFiles(repo, base, null, { paths: together.map((t) => t.rel), renames: false }) : null;
  if (d && !d.ok) alone.push(...together);
  else if (d) {
    /** Each path's change as the diff lists it, the first where two of the paths asked list one (a folder's). @type {Map<string, FileChange>} */
    const listed = new Map();
    for (const x of d.files) if (!listed.has(x.path)) listed.set(x.path, x);
    const holders = foldersOf(listed.keys());
    /** @type {{ i: number, abs: string, rel: string }[]} */
    const unlisted = [];
    /** @type {{ t: { i: number, abs: string, rel: string }, x: FileChange }[]} */
    const changed = [];
    for (const t of together) {
      const x = listed.get(t.rel);
      if (holders.has(t.rel)) alone.push(t);
      else if (x?.binary) out[t.i] = { ...noDiff(null, t.rel), binary: true, ...sizeOfWorking(t.abs) };
      else if (x) changed.push({ t, x });
      else unlisted.push(t);
    }
    const [patched, tracked] = await Promise.all([withPatches(repo, base, null, changed.map((c) => c.x), maxLines), trackedOf(repo, unlisted.map((t) => t.rel))]);
    changed.forEach(({ t }, k) => (out[t.i] = { ...noDiff(null, t.rel), patch: String(patched[k].patch), truncated: !!patched[k].truncated, lines: Number(patched[k].lines) }));
    for (const t of unlisted) {
      if (!tracked) alone.push(t);
      else out[t.i] = tracked.has(t.rel) ? noDiff(null, t.rel) : untrackedDiff(t.abs, t.rel, maxLines);
    }
  }
  const read = await fewAtOnce(alone, (t) => diffAlone(repo, base, t, files[t.i].oldPath ?? null, maxLines));
  alone.forEach((t, k) => (out[t.i] = read[k]));
  return out;
}

/** A file's diff where none was read, and why (`error`) or not. @param {string | null} error @param {string | null} [rel] @returns {FileDiff} */
const noDiff = (error, rel = null) => ({ ok: !error, path: rel, patch: "", truncated: false, lines: 0, binary: false, untracked: false, error });

/**
 * A path of `folder` inside its repository: where it is, and how git names it there — or why it is not inside.
 * @param {string} repo @param {string} folder @param {string} path
 * @returns {{ abs: string, rel: string } | { error: string }}
 */
function placed(repo, folder, path) {
  try {
    const abs = resolveInside(repo, join(folder, String(path || "")));
    return { abs, rel: relative(resolve(repo), abs).replace(/\\/g, "/") };
  } catch (/** @type {any} */ e) {
    return { error: e.message };
  }
}

/**
 * One file's change read alone (`diffOf`): its listing, with its rename's source where it has one, then its patch, its
 * size where it is binary, or — where git lists no change — whether git tracks it.
 * @param {string} repo @param {string} base @param {{ abs: string, rel: string }} at @param {string | null} oldPath @param {number} maxLines
 * @returns {Promise<FileDiff>}
 */
async function diffAlone(repo, base, { abs, rel }, oldPath, maxLines) {
  const d = await diffFiles(repo, base, null, { paths: oldPath ? [String(oldPath), rel] : [rel] });
  if (!d.ok) return noDiff(d.error, rel);
  const f = d.files.find((x) => x.path === rel);
  if (f?.binary) return { ...noDiff(null, rel), binary: true, ...sizeOfWorking(abs) };
  if (f) return { ...noDiff(null, rel), ...(await diffPatch(repo, base, null, f.oldPath ? [f.oldPath, rel] : rel, { maxLines })) };
  const tracked = await git(["ls-files", "--error-unmatch", "--", rel], { cwd: repo });
  if (tracked.code === 0) return noDiff(null, rel);
  return untrackedDiff(abs, rel, maxLines);
}

/**
 * Which of `rels` git tracks, as `ls-files --error-unmatch` asked of each tells: a file it holds, or a folder it holds
 * files in. Null where git could not answer.
 * @param {string} repo @param {string[]} rels  none git would read as a pattern
 * @returns {Promise<Set<string> | null>}
 */
async function trackedOf(repo, rels) {
  /** @type {Set<string>} */
  const tracked = new Set();
  for (let i = 0; i < rels.length; i += LS_FILES_PER_CALL) {
    const part = rels.slice(i, i + LS_FILES_PER_CALL);
    const r = await git(["ls-files", "-z", "--", ...part], { cwd: repo });
    if (r.code !== 0) return null;
    const held = r.out.split("\0").filter(Boolean);
    for (const rel of part) if (held.some((h) => h === rel || h.startsWith(`${rel}/`))) tracked.add(rel);
  }
  return tracked;
}
/** The paths one `ls-files` names at most: a Windows command line holds about 32,000 characters. */
const LS_FILES_PER_CALL = 100;

/**
 * A file git does not track, as its diff: an addition read from the working tree, bounded, clipped at `maxLines`.
 * @param {string} abs @param {string} rel @param {number} maxLines @returns {FileDiff}
 */
function untrackedDiff(abs, rel, maxLines) {
  const added = untrackedPatch(abs, rel);
  if (added.binary) return { ...noDiff(null, rel), untracked: true, binary: true, ...sizeOfWorking(abs) };
  const lines = added.patch ? added.patch.split("\n") : [];
  const cut = lines.length > maxLines;
  return { ...noDiff(null, rel), untracked: true, patch: (cut ? lines.slice(0, maxLines) : lines).join("\n"), truncated: cut, lines: lines.length };
}

/** A file's size in the working tree, or nothing. @param {string} abs @returns {{ size?: number }} */
function sizeOfWorking(abs) {
  try {
    return { size: statSync(abs).size };
  } catch {
    return {};
  }
}

/**
 * A file git does not track yet, read bounded: its lines, or that it is binary, or too large to read (`lines` null). A
 * folder git names whole — a repository of its own inside this one, which git never looks into — is never read as a
 * file: no lines, `folder`.
 * @param {string} abs @returns {{ lines: string[] | null, binary: boolean, size: number, folder?: boolean }}
 */
function untrackedText(abs) {
  let size = 0;
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return { lines: [], binary: false, size: 0, folder: true };
    size = st.size;
  } catch {
    return { lines: [], binary: false, size: 0 };
  }
  if (size > MAX_UNTRACKED_PATCH_BYTES) return { lines: null, binary: false, size };
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return { lines: null, binary: true, size };
  const body = buf.toString("utf8");
  const lines = body.split("\n");
  if (body.endsWith("\n")) lines.pop();
  return { lines, binary: false, size };
}

/**
 * A unified diff of a file git does not track yet: every line added. A binary file has none, nor has a folder git names
 * whole; an oversized one says so in a line. @param {string} abs @param {string} rel @returns {{ patch: string, binary: boolean }}
 */
function untrackedPatch(abs, rel) {
  const t = untrackedText(abs);
  if (t.binary || t.folder) return { patch: "", binary: t.binary };
  if (!t.lines) return { patch: `diff --git a/${rel} b/${rel}\nnew file\n(${Math.round(t.size / 1024)} KB: too large to show as a patch)`, binary: false };
  const head = [`diff --git a/${rel} b/${rel}`, "new file", "--- /dev/null", `+++ b/${rel}`, `@@ -0,0 +1,${t.lines.length} @@`];
  return { patch: [...head, ...t.lines.map((l) => `+${l}`)].join("\n"), binary: false };
}

/**
 * The recent commits, newest first.
 * @param {string} folder @param {{ limit?: number }} [opts]
 */
export async function logOf(folder, { limit = 30 } = {}) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, repo: null, commits: [], error: found.error };
  const n = Math.max(1, Math.min(MAX_LOG, Math.floor(Number(limit) || 30)));
  const r = await git(["log", `--max-count=${n}`, "--format=%H%x09%h%x09%an%x09%aI%x09%s"], { cwd: found.repo });
  if (r.code !== 0) return { ok: true, repo: found.repo, commits: [], error: found.head ? firstLine(r.err || r.error) : null };
  const commits = r.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, short, author, date, ...subject] = line.split("\t");
      return { hash, short, author, date, subject: subject.join("\t") };
    });
  return { ok: true, repo: found.repo, commits, error: null };
}

/**
 * Local and remote branches, the current one named.
 * @param {string} folder
 */
export async function branchesOf(folder) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, repo: null, current: null, local: [], remote: [], error: found.error };
  const r = await git(["for-each-ref", "--format=%(refname:short)%09%(objectname:short)%09%(HEAD)%09%(upstream:short)%09%(refname)", "refs/heads", "refs/remotes"], { cwd: found.repo });
  if (r.code !== 0) return { ok: false, repo: found.repo, current: null, local: [], remote: [], error: firstLine(r.err || r.error) };
  /** @type {Array<{ name: string, commit: string, upstream: string | null }>} */
  const local = [];
  /** @type {Array<{ name: string, commit: string }>} */
  const remote = [];
  let current = null;
  for (const line of r.out.split(/\r?\n/)) {
    if (!line) continue;
    const [name, commit, head, upstream, refname] = line.split("\t");
    if (refname.startsWith("refs/heads/")) {
      local.push({ name, commit, upstream: upstream || null });
      if (head === "*") current = name;
    } else if (!/\/HEAD$/.test(name)) remote.push({ name, commit });
  }
  return { ok: true, repo: found.repo, current, local, remote, error: null };
}

/**
 * A remote's URL as one key for the repository it names, so a project is matched on another machine by its remote
 * (the remote-agents plan's f-ident): its https and ssh forms compare equal — `git@github.com:o/r.git`,
 * `ssh://git@github.com/o/r`, `https://github.com/o/r.git` and `https://user@github.com/o/r` are each
 * `github.com/o/r`. The port, the user and any password, a trailing `.git` and slashes are dropped, and the case is
 * folded — the path's too: GitHub, GitLab and Bitbucket name `Owner/Repo` and `owner/repo` as one, and a person types
 * either; two repositories a server tells apart by case alone are rare. A local path stays a path, in forward slashes.
 * Null for none.
 * @param {string} url @returns {string | null}
 */
export function remoteKey(url) {
  return keyOf(url)?.toLowerCase() ?? null;
}

/** `remoteKey`'s key before its case is folded. @param {string} url @returns {string | null} */
function keyOf(url) {
  const s = String(url || "").trim();
  if (!s) return null;
  const tidy = (/** @type {string} */ p) => p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(s);
  if (scheme) {
    // file:///srv/r.git is the path /srv/r; file:///C:/r, the path C:/r.
    if (scheme[1].toLowerCase() === "file") return tidy(`/${scheme[2]}${scheme[3]}`.replace(/^\/+/, "/").replace(/^\/([a-z]:)/i, "$1")) || null;
    const host = hostOf(scheme[2]);
    const path = tidy(scheme[3]).replace(/^\//, "");
    return host ? (path ? `${host}/${path}` : host) : null;
  }
  // git's scp-like form, [user@]host:path — no slash before its colon, and a host longer than a Windows drive's letter.
  const scp = /^(?:[^@/:]+@)?(\[[^\]]*\]|[^:/]{2,}):(.*)$/.exec(s);
  if (scp) {
    const path = tidy(scp[2]).replace(/^\//, "");
    return path ? `${scp[1].toLowerCase()}/${path}` : scp[1].toLowerCase();
  }
  return tidy(s) || null;
}

/** A URL's authority without its user, password and port, its case folded. @param {string} authority */
const hostOf = (authority) => {
  const at = authority.slice(authority.lastIndexOf("@") + 1);
  return (at.startsWith("[") ? at.slice(0, at.indexOf("]") + 1) : at.split(":")[0]).toLowerCase();
};

/**
 * A remote's URL with no credentials in it, as an answer may say it: an http(s) or git URL loses its user and password
 * whole — `https://<token>@host/o/r` is how a token is often kept —, an ssh URL its password, its user staying (`git@`
 * is a login's name, never a secret). git's scp-like form has no password to lose.
 * @param {string} url @returns {string}
 */
export function withoutCredentials(url) {
  const s = String(url || "").trim();
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*@)(.*)$/i.exec(s);
  if (!m) return s;
  const ssh = /^(ssh|git\+ssh|ssh\+git):\/\/$/i.test(m[1]);
  const user = m[2].slice(0, -1).split(":")[0];
  return `${m[1]}${ssh && user ? `${user}@` : ""}${m[3]}`;
}

/**
 * A folder's remote: `origin`, else the first its repository's own config names, with no credentials in its URL
 * (`withoutCredentials`). Null where the folder is in no repository, git refuses it, or it has no remote. Read from
 * the repository's config alone — a remote in the person's global config is no remote of this repository's.
 * @param {string} folder @returns {Promise<{ name: string, url: string } | null>}
 */
export async function remoteOf(folder) {
  return (await remoteRead(folder)).remote;
}

/**
 * A folder's remote as `remoteOf` reads it, and whether git read the folder at all: `unread` where the folder or git did
 * not answer there — its stat past `FOLDER_STAT_MS` (`folderThere`), git that could not start or ran out of time —, so no
 * remote is known either way; a folder that is not there has none. `there`: `folderThere`'s options (the tests').
 * @param {string} folder @param {{ there?: Parameters<typeof folderThere>[1] }} [o]
 * @returns {Promise<{ remote: { name: string, url: string } | null, unread: boolean }>}
 */
export async function remoteRead(folder, { there } = {}) {
  const is = await folderThere(folder, there);
  if (is === null) return { remote: null, unread: true };
  if (!is) return { remote: null, unread: false };
  const r = await git(["config", "--local", "-z", "--get-regexp", "^remote\\..+\\.url$"], { cwd: folder });
  if (r.code === -1) return { remote: null, unread: true };
  // 1: no remote; anything else, no repository git will read.
  if (r.code !== 0) return { remote: null, unread: false };
  /** @type {{ name: string, url: string }[]} */
  const remotes = [];
  for (const entry of r.out.split("\0")) {
    const nl = entry.indexOf("\n");
    const name = nl > 0 ? /^remote\.(.+)\.url$/.exec(entry.slice(0, nl))?.[1] : null;
    if (name && !remotes.some((x) => x.name === name)) remotes.push({ name, url: entry.slice(nl + 1) });
  }
  const pick = remotes.find((x) => x.name === "origin") || remotes[0];
  return { remote: pick ? { name: pick.name, url: withoutCredentials(pick.url) } : null, unread: false };
}

/**
 * Folders' remotes' keys (`remoteKey`), each read again `ttl` after it was read (the remote desk of 11-22: a list of
 * chats or projects says each one's, so a desk lists a repository's on every machine as one): `of(folders)` gives those
 * read within `ttl` at once and reads the rest, `lanes` at a time, waiting `waitMs` at most for them — one read past it
 * is kept for the next ask, and one read again gives its last key meanwhile, so a desk's list does not come apart every
 * `ttl` (the review of s1c). A key is null where the folder has no remote; a folder git could not read just now
 * (`remoteRead`'s `unread`) is kept for no while and given none (undefined).
 * @param {{ read?: typeof remoteRead, now?: () => number, ttl?: number, lanes?: number }} [o]
 */
export function remoteKeys({ read = remoteRead, now = Date.now, ttl = 5 * 60_000, lanes = 4 } = {}) {
  /** @type {Map<string, { key: string | null, at: number }>} */
  const kept = new Map();
  /** Each folder read now, once however many ask. @type {Map<string, Promise<void>>} */
  const reading = new Map();
  /** The reads waiting for a lane. @type {(() => void)[]} */
  const waiting = [];
  let busy = 0;
  /** @param {string} folder @returns {Promise<void>} */
  const start = (folder) => {
    const had = reading.get(folder);
    if (had) return had;
    // Begun past this turn, once it is listed as read: a `read` that threw at once would let it go before then, and
    // the folder would stand read for ever (the review of s1c).
    const p = Promise.resolve().then(async () => {
      while (busy >= lanes) await new Promise((r) => void waiting.push(() => r(undefined)));
      busy++;
      try {
        const r = await read(folder);
        if (r.unread) kept.delete(folder);
        else kept.set(folder, { key: r.remote ? remoteKey(r.remote.url) : null, at: now() });
      } catch {
        kept.delete(folder);
      } finally {
        busy--;
        reading.delete(folder);
        waiting.shift()?.();
      }
    });
    reading.set(folder, p);
    return p;
  };
  /** @param {string} folder */
  const fresh = (folder) => {
    const k = kept.get(folder);
    return k && now() - k.at < ttl ? k : null;
  };
  return {
    /**
     * Each folder's key: those read within `ttl` at once, the rest read first, `waitMs` at most (Infinity: every one);
     * one read again that has not landed by then, its last.
     * @param {readonly string[]} folders @param {{ waitMs?: number }} [o] @returns {Promise<Map<string, string | null | undefined>>}
     */
    async of(folders, { waitMs = Infinity } = {}) {
      const all = [...new Set(folders.filter(Boolean))];
      const missing = all.filter((f) => !fresh(f));
      if (missing.length) {
        const reads = Promise.all(missing.map(start));
        if (waitMs === Infinity) await reads;
        else {
          /** @type {ReturnType<typeof setTimeout> | undefined} */
          let timer;
          await Promise.race([reads, new Promise((r) => (timer = setTimeout(r, waitMs)))]);
          clearTimeout(timer);
        }
      }
      return new Map(all.map((f) => [f, kept.get(f)?.key]));
    },
  };
}

/**
 * @typedef {object} CloneFacts  a folder's repository as another machine matches it (`cloneOf`)
 * @property {boolean} ok  false where no repository holds the folder, or git could not read it (`error`)
 * @property {string | null} path  the top folder of its repository or worktree, in this system's separators
 * @property {{ name: string, url: string } | null} remote  `remoteOf`'s
 * @property {string | null} head  the whole commit HEAD is at, so two machines' compare; null before the first commit
 * @property {string | null} branch  null on a detached HEAD
 * @property {boolean | null} dirty  anything uncommitted: a change, staged or not, or an untracked file; null unread
 * @property {string | null} error  in words
 */

/**
 * A folder's repository as another machine matches it: its top folder, its remote (`remoteOf`), the commit HEAD is at,
 * its branch, and whether anything is uncommitted. One status for the last three, without the index lock (GW-D23).
 * `remote`: read already.
 * @param {string} folder @param {{ remote?: { name: string, url: string } | null }} [o]
 * @returns {Promise<CloneFacts>}
 */
export async function cloneOf(folder, { remote } = {}) {
  const [found, st, rem] = await Promise.all([
    repoOf(folder),
    git([...NO_LOCKS, "status", "--porcelain=v2", "--branch", "-z"], { cwd: folder }),
    remote === undefined ? remoteOf(folder) : remote,
  ]);
  /** @type {CloneFacts} */
  const out = { ok: false, path: null, remote: rem, head: null, branch: null, dirty: null, error: null };
  if (!found.repo) return { ...out, error: found.error };
  out.path = resolve(found.repo);
  if (st.code !== 0) return { ...out, error: firstLine(st.error || st.err || `git status exited ${st.code}`) };
  const { branch, files } = parsePorcelainV2(st.out);
  return { ...out, ok: true, head: branch.oid, branch: branch.head, dirty: files.some((f) => f.kind !== "ignored") };
}

/**
 * Which of `folders` are clones of the repository `url` names, by `remoteKey` — in any of its forms, its ssh one for its
 * https one —, each repository's top folder once, in the folders' order: its path, HEAD, branch and whether it is dirty.
 * A folder that is gone, in no repository, or another repository's is left out. Each folder's remote is read first,
 * a few at a time (`fewAtOnce`); only a clone's status is read.
 * @param {string[]} folders @param {string} url
 * @returns {Promise<{ path: string, head: string | null, branch: string | null, dirty: boolean | null }[]>}
 */
export async function clonesOf(folders, url) {
  const key = remoteKey(url);
  if (!key) return [];
  const read = await fewAtOnce(folders, async (folder) => {
    if (!folder || !isFolder(folder)) return null;
    const remote = await remoteOf(folder);
    if (!remote || remoteKey(remote.url) !== key) return null;
    const c = await cloneOf(folder, { remote });
    return c.ok ? c : null;
  });
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ path: string, head: string | null, branch: string | null, dirty: boolean | null }[]} */
  const out = [];
  for (const c of read) {
    if (!c?.path) continue;
    const same = process.platform === "win32" ? c.path.toLowerCase() : c.path;
    if (seen.has(same)) continue;
    seen.add(same);
    out.push({ path: c.path, head: c.head, branch: c.branch, dirty: c.dirty });
  }
  return out;
}

/**
 * A folder another machine's launch names, as it stands against the repository `url` names: whether it is there,
 * whether git holds it, and whether as a clone of that repository (`remoteKey`, in any of its forms) — a subfolder of a
 * clone is its clone —, with its repository's top folder, HEAD, branch and whether it is dirty.
 * @param {string} folder @param {string} url
 * @returns {Promise<{ gone: boolean, git: boolean, same: boolean, path: string | null, head: string | null, branch: string | null, dirty: boolean | null }>}
 */
export async function folderFacts(folder, url) {
  const none = { gone: false, git: false, same: false, path: null, head: null, branch: null, dirty: null };
  if (!folder || !isFolder(folder)) return { ...none, gone: true };
  const remote = await remoteOf(folder);
  const c = await cloneOf(folder, { remote });
  if (!c.ok) return none;
  const key = remoteKey(url);
  return { ...none, git: true, same: !!key && !!remote && remoteKey(remote.url) === key, path: c.path, head: c.head, branch: c.branch, dirty: c.dirty };
}

/** Whether a folder stands at `path`. @param {string} path */
const isFolder = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Which of a place's files git ignores (HarnessV4_Four_Plan FO-D22): files no snapshot holds, so Changes never shows
 * them. A tracked file is never ignored, whatever the patterns say. git answers each path asked in its order, one line
 * each — `source:line:pattern<TAB>path`, `::<TAB>path` where no pattern matched, a pattern opening with `!` where one
 * keeps it — so each answer is read by its place in the order, never by how git spells the path back.
 * @param {string} place  the top folder of a repository or worktree @param {string[]} paths  relative to it
 * @returns {Promise<{ ignored: Set<string>, error: string | null }>}  the paths as given
 */
export async function ignoredOf(place, paths) {
  /** @type {Set<string>} */
  const ignored = new Set();
  const asked = [...new Set(paths.map((p) => String(p)).filter((p) => p && !/[\r\n]/.test(p)))];
  // In parts under Windows' command-line limit, as `lastCommits` asks (found reviewing the Space work: 200 long paths
  // on one line failed the read).
  for (const batch of partsOf(asked)) {
    const r = await git([...NO_LOCKS, "check-ignore", "--verbose", "--non-matching", "--", ...batch.map((p) => p.replace(/\\/g, "/"))], { cwd: place });
    // 0: an answer for each; 1: none matched; anything else is git's refusal.
    if (r.error || (r.code !== 0 && r.code !== 1)) return { ignored, error: firstLine(r.error || r.err || r.out) || `git check-ignore exited ${r.code}` };
    const lines = r.out ? r.out.split(/\r?\n/) : [];
    if (lines.length !== batch.length) return { ignored, error: `git check-ignore answered ${lines.length} lines for ${batch.length} paths` };
    lines.forEach((line, k) => {
      const m = /^(.*):(\d+):(.*)\t/.exec(line);
      if (m && !m[3].startsWith("!")) ignored.add(batch[k]);
    });
  }
  return { ignored, error: null };
}
