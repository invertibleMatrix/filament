// @ts-check
// The places of a repository (HarnessV4_Git_Plan steps 4 and 5): the worktrees git lists for it, Filament's helper
// copies left out, each read whole, and the writes Filament makes there on the developer's click (GW-D1): removing a
// worktree that loses nothing but what git ignores (GW-D10, GW-D36), putting it back on its branch (GW-D37), and making
// a new one for a chat's first send, taken back when that send fails (GW-D45). git's own `worktree remove` deletes the
// folder following a link inside it — on Windows a junction to the main folder's node_modules emptied that —, so the
// folder is moved aside, git's record of it dropped, and the folder deleted here, a link taken as a link (GW-D35).
// Every call goes through snapshot.js's `git()`: the fsmonitor off; Put back and a new worktree run no hook (GW-D11).
// No git, no repository: answered in words, never thrown.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { normalizeCwd } from "../../core/project-id.js";
import { firstLine, git, gitAbove, gitWithoutHooks, refNameOf, refusedWords, snapshotTree } from "./snapshot.js";
import { NO_LOCKS, noPlace, parsePorcelainV2, placeInfo } from "./inspect.js";
import { blobsNow } from "./carry.js";
import { TASK_HOME } from "./worktree.js";

/** What the sheet names of what git ignores in a place, at most; the rest are counted. */
const GOES_MAX = 6;
/** A checkout of a big repository takes its time (as a helper's copy does): Put back and a new worktree wait for it. */
const CHECKOUT_MS = 5 * 60_000;
/** The errors a folder held by a program gives when moved (Windows: a file open in it, or a process working there). */
const HELD = new Set(["EPERM", "EBUSY", "EACCES"]);
/** The longest name a new worktree takes. */
const NAME_MAX = 60;
/** How far a taken name counts up for a free one: `name-2` … */
const FREE_MAX = 99;

/** @param {number} n @param {string} one */
const many = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * @typedef {object} Worktree  one worktree as `git worktree list --porcelain` names it
 * @property {string} path  its top folder, as git spells it
 * @property {string | null} head  the commit it is at; null on a branch with no commit yet
 * @property {string | null} branch  its branch's short name; null when detached
 * @property {boolean} detached
 * @property {boolean} bare  the bare repository's own entry, no place to work in
 * @property {string | null} locked  why it is locked, "" when no reason was given; null when it is not
 * @property {string | null} prunable  why git would prune it (its folder is gone); null when it would not
 * @property {boolean} [main]  the repository's main folder
 */

/**
 * Whether a folder lies in a git repository — it, or a folder above it, holds `.git` —: a routine of a Space of the
 * person's own that writes works in a lane of its own there, else in the folder itself (HarnessV4_SpacesPlugins_Plan
 * A2c). Read without git, as the Space's sheet and its run say it alike.
 * @param {string} folder @param {(path: string) => boolean} [exists]
 */
export function inRepo(folder, exists = existsSync) {
  for (let at = folder, up = dirname(folder); ; at = up, up = dirname(up)) {
    if (exists(join(at, ".git"))) return true;
    if (up === at) return false;
  }
}

/**
 * `git worktree list --porcelain -z`: each worktree a run of `key value` fields, an empty field between two.
 * @param {string} z @returns {Worktree[]}
 */
export function parseWorktrees(z) {
  /** @type {Worktree[]} */
  const out = [];
  /** @type {Worktree | null} */
  let cur = null;
  for (const field of String(z || "").split("\0")) {
    if (!field) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    const sp = field.indexOf(" ");
    const key = sp < 0 ? field : field.slice(0, sp);
    const value = sp < 0 ? "" : field.slice(sp + 1);
    if (key === "worktree") {
      if (cur) out.push(cur);
      cur = { path: value, head: null, branch: null, detached: false, bare: false, locked: null, prunable: null };
    } else if (!cur) continue;
    else if (key === "HEAD") cur.head = /^0+$/.test(value) ? null : value;
    else if (key === "branch") cur.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") cur.detached = true;
    else if (key === "bare") cur.bare = true;
    else if (key === "locked") cur.locked = value;
    else if (key === "prunable") cur.prunable = value;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The worktrees of the repository a folder belongs to (GWC-42): the main folder first, as git names it, the others by
 * their folders (git lists them in its records' order, which differs between filesystems); the bare repository's own
 * entry (GWC-90) and Filament's helper copies, inside its git folder (`TASK_HOME`), left out. `common`: the
 * repository's git folder, which names it whichever worktree asks.
 * @param {string} folder
 * @returns {Promise<{ ok: boolean, main: string | null, common: string | null, worktrees: Worktree[], error: string | null }>}
 */
export async function worktreesOf(folder) {
  /** @param {string} error */
  const none = (error) => ({ ok: false, main: null, common: null, worktrees: [], error });
  if (!folder || !existsSync(folder)) return none("the folder is gone");
  const dir = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder });
  if (dir.error) return none(dir.error);
  if (dir.code !== 0 || !dir.out) return none(gitAbove(folder) ? refusedWords(dir) : "not in a git repository");
  const common = dir.out.split(/\r?\n/)[0];
  const list = await git(["worktree", "list", "--porcelain", "-z"], { cwd: folder });
  if (list.code !== 0) return none(firstLine(list.err || list.error || `git worktree list exited ${list.code}`));
  const all = parseWorktrees(list.out);
  const main = all[0] && !all[0].bare ? all[0].path : null;
  const copies = `${normalizeCwd(join(common, TASK_HOME))}/`;
  const worktrees = all
    .filter((w) => !w.bare && !`${normalizeCwd(w.path)}/`.startsWith(copies))
    .map((w) => ({ ...w, main: w.path === main }))
    .sort((a, b) => Number(b.main) - Number(a.main) || normalizeCwd(a.path).localeCompare(normalizeCwd(b.path)));
  return { ok: true, main, common, worktrees, error: null };
}

/** Filament's record of a worktree it made, beside git's record of it: the branch it was made from (`makeWorktree`). */
const FROM_FILE = "filament-from.json";
/** Filament's record of a fork's worktree, beside git's record of it: the chat it was made for (`markFork`). */
const FORK_FILE = "filament-fork.json";

/**
 * git's record of the worktree at `path`: as its `.git` file names it, else — its folder gone — the record in the
 * repository's git folder `common` whose `gitdir` names it. Each path read against the folder its file is in: git
 * writes them relative where `worktree.useRelativePaths` is on. Null where none does.
 * @param {string} path @param {string | null} [common]
 */
function recordAt(path, common = null) {
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(path, ".git"), "utf8"));
    if (m) return resolve(path, m[1]);
  } catch {}
  if (!common) return null;
  const want = normalizeCwd(join(path, ".git"));
  try {
    for (const n of readdirSync(join(common, "worktrees"))) {
      const record = join(common, "worktrees", n);
      try {
        if (normalizeCwd(resolve(record, readFileSync(join(record, "gitdir"), "utf8").trim())) === want) return record;
      } catch {}
    }
  } catch {}
  return null;
}
/** A record of Filament's beside git's record of a worktree, as JSON; null where there is none. @param {string | null} record @param {string} file */
const ownRecord = (record, file) => {
  if (!record) return null;
  try {
    const j = JSON.parse(readFileSync(join(record, file), "utf8"));
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
};

/**
 * @typedef {Omit<import("./inspect.js").PlaceInfo, "main"> & { path: string, name: string, main: boolean,
 *   locked: string | null, prunable: string | null, commit: string | null, missing: boolean, submodules: boolean,
 *   age: { commit: number | null, folder: number | null }, mergedInto: string | null, merged: boolean | null }}
 *   PlaceRead  a worktree read whole where its folder is there, `missing` where it is gone (GWC-43); `commit`, the
 *   whole id of the commit it is at, which Put back checks out for a detached one; `age`, when its last commit was made
 *   and when its folder last changed, in ms (the owner's of 11-09); `mergedInto`, the branch its own is compared with —
 *   the one it was made from where Filament recorded it, else the main folder's —, and `merged`, whether that branch
 *   has every commit of its own; null where it is on no branch, on that branch itself, or git could not tell
 */

/**
 * A worktree read whole (GW-D20's read), with whether submodules are checked out in it: their git folders live in its
 * record, which a removal drops (GWC-91). A folder that is gone is not read, nor one `refused` names a reason for: the
 * fence's, for a folder Filament may not read (GWC-89), answered as git listed it. `into`: the main folder's branch,
 * which its own is compared with where Filament did not record the one it was made from (the owner's of 11-09).
 * @param {Worktree} w @param {{ refused?: string | null, into?: string | null }} [o]
 * @returns {Promise<PlaceRead & { refused: boolean }>}
 */
export async function readWorktree(w, { refused = null, into = null } = {}) {
  const own = { path: w.path, name: basename(w.path), main: !!w.main, locked: w.locked, prunable: w.prunable, commit: w.head };
  const missing = w.prunable !== null || !existsSync(w.path);
  if (missing || refused) {
    const unread = noPlace(w.path, missing ? "its folder is gone" : String(refused), { whole: true });
    const listed = { place: w.path, worktree: !w.main, branch: w.branch, detached: w.detached, head: w.head ? w.head.slice(0, 8) : null };
    return { ...unread, ...listed, ...own, missing, submodules: false, refused: !missing, age: { commit: null, folder: null }, mergedInto: null, merged: null };
  }
  const from = w.main ? null : ownRecord(recordAt(w.path), FROM_FILE);
  const base = typeof from?.branch === "string" && from.branch ? from.branch : into;
  const [info, dir, when, merged] = await Promise.all([
    placeInfo(w.path, { whole: true }),
    git(["rev-parse", "--path-format=absolute", "--git-dir"], { cwd: w.path }),
    w.head ? git(["show", "-s", "--format=%ct", "HEAD"], { cwd: w.path }) : null,
    mergedInto(w, base),
  ]);
  const submodules = dir.code === 0 && !!dir.out && existsSync(join(dir.out.split(/\r?\n/)[0], "modules"));
  /** @type {number | null} */
  let folder = null;
  try {
    folder = statSync(w.path).mtimeMs;
  } catch {}
  const age = { commit: when && when.code === 0 && /^\d+$/.test(when.out) ? Number(when.out) * 1000 : null, folder };
  return { ...info, ...own, missing: false, submodules, refused: false, age, mergedInto: w.branch && base && w.branch !== base ? base : null, merged };
}

/**
 * Whether the branch `base` has every commit of the worktree's own branch (`git merge-base --is-ancestor`); null where
 * it is on no branch, on `base` itself, no `base` is named or git could not tell.
 * @param {Worktree} w @param {string | null} base
 * @returns {Promise<boolean | null>}
 */
async function mergedInto(w, base) {
  if (!w.branch || !w.head || !base || w.branch === base) return null;
  const r = await git(["merge-base", "--is-ancestor", `refs/heads/${w.branch}`, `refs/heads/${base}`], { cwd: w.path });
  return r.error ? null : r.code === 0 ? true : r.code === 1 ? false : null;
}

/**
 * Why a worktree offers no Remove (GW-D10), in words; null where removing it loses nothing but what git ignores. The
 * first reason that holds, in the order a person would see to them. `atWork`: the names of its chats at work now
 * (GW-D39). On a branch its folder takes no commit with it — the branch keeps them all —, so what its base lacks is no
 * reason; a detached one's commits are kept only where its base has them. `branch`: why it offers no Remove worktree
 * and branch (the owner's of 11-09) — the same, but the branch it is compared with is the one `mergedInto` names, which
 * must have every commit of it, the branch going too.
 * @param {PlaceRead & { refused: boolean }} p @param {string[]} atWork @param {{ branch?: boolean }} [o]
 * @returns {string | null}
 */
export function heldBack(p, atWork, { branch = false } = {}) {
  if (p.main) return "the repository's main folder";
  if (p.missing) return "its folder is gone";
  if (p.refused || !p.ok) return p.error || "git could not read it";
  if (p.locked !== null) return p.locked ? `locked: ${p.locked}` : "locked";
  if (branch && !p.branch) return "it is on no branch";
  if (!p.head) return "its branch has no commit yet";
  if (!p.uncommitted) return "git could not tell what is uncommitted";
  if (p.uncommitted.files) return `${many(p.uncommitted.files, "file")} uncommitted`;
  if (branch) {
    if (!p.mergedInto) return "no branch to compare it with";
    if (p.merged == null) return `git could not compare it with ${p.mergedInto}`;
    if (!p.merged) return `its branch holds commits ${p.mergedInto} lacks`;
  } else if (!p.branch) {
    if (!p.base) return "no base branch to compare with";
    if (p.ahead == null) return `git could not compare it with ${p.base}`;
    if (p.ahead) return `it holds ${many(p.ahead, "commit")} ${p.base} lacks`;
  }
  if (p.submodules) return "it holds submodules, whose git folders would go with it";
  if (atWork.length) return atWork.length === 1 ? `“${atWork[0]}” works here now` : `${atWork.length} chats work here now`;
  return null;
}

/**
 * What goes with a worktree's folder beside the branch's files (GW-D36): what git ignores there, a link marked as
 * one, which alone goes. Up to `GOES_MAX` named, the rest counted; null where git could not tell.
 * @param {string} place
 * @returns {Promise<{ names: { path: string, link: boolean }[], more: number } | null>}
 */
export async function goesWith(place) {
  const st = await git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--ignored"], { cwd: place });
  if (st.code !== 0) return null;
  const ignored = parsePorcelainV2(st.out).files.filter((f) => f.kind === "ignored").map((f) => f.path);
  const names = ignored.slice(0, GOES_MAX).map((path) => {
    let link = false;
    try {
      link = lstatSync(join(place, path.replace(/\/$/, ""))).isSymbolicLink();
    } catch {}
    return { path, link };
  });
  return { names, more: ignored.length - names.length };
}

/**
 * Remove a worktree (GW-D35): its folder moved aside first — a program holding a file in it makes that fail with
 * nothing changed (GWC-80) —, git's record of that one worktree dropped (`git worktree remove` on a folder that is no
 * longer there deletes no file), then the folder deleted here, a link removed as a link, never followed (GWC-78). The
 * caller checked it may go (`heldBack`, GW-D40). `left`: the moved folder, where its deletion stopped part way.
 * @param {string} at  a folder of the repository's other than this worktree: its main folder, or its git folder
 * @param {string} path  the worktree's top folder, as git lists it
 * @returns {Promise<{ ok: true, left: string | null } | { ok: false, error: string }>}
 */
export async function removeWorktree(at, path) {
  const aside = join(dirname(path), `.${basename(path)}.filament-removing-${Date.now().toString(36)}`);
  try {
    renameSync(path, aside);
  } catch (/** @type {any} */ e) {
    if (HELD.has(e.code)) return { ok: false, error: `a program is using it (${e.code}): close what works there, then remove it again` };
    return { ok: false, error: `its folder could not be moved aside: ${firstLine(e.message)}` };
  }
  const r = await git(["worktree", "remove", path], { cwd: at });
  if (r.code !== 0) {
    let stays = "";
    try {
      renameSync(aside, path);
    } catch {
      stays = `; its folder is at ${aside}`;
    }
    return { ok: false, error: `git kept its record of the worktree: ${firstLine(r.err || r.out || r.error)}${stays}` };
  }
  try {
    // Its files are the project's — a package's or a nested repository's read-only ones among them: the promise form, as
    // electron's Node, the desktop app's, stops at a read-only file where the promise form does not (HarnessV3-Native NA1).
    await rm(aside, { recursive: true, force: true });
    return { ok: true, left: null };
  } catch {
    return { ok: true, left: aside };
  }
}

/**
 * Put a removed worktree back (GW-D37): its branch checked out at its folder again, or, for a detached one, its
 * commit. Without the repository's hooks (GW-D11). git's refusal — the folder taken again, the branch gone or checked
 * out elsewhere — in words, nothing half made (GWC-84). `make`: its branch went with it (Remove worktree and branch,
 * the owner's of 11-09), and is made again at `head`; one of that name made since is git's refusal.
 * @param {string} at  a folder of the repository's (its main folder, or its git folder)
 * @param {{ path: string, branch: string | null, head: string, make?: boolean }} w
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function putBack(at, { path, branch, head, make = false }) {
  if (existsSync(path)) return { ok: false, error: `something is at ${path} again` };
  const where = branch ? (make ? ["-b", branch, path, head] : [path, branch]) : ["--detach", path, head];
  const r = await gitWithoutHooks(["worktree", "add", ...where], { cwd: at, timeoutMs: CHECKOUT_MS });
  if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.out || r.error || `git worktree add exited ${r.code}`) };
  return { ok: true };
}

/**
 * Why `name` is no name for a new worktree's branch, in words; null where it is one (GWC-106). Letters, digits and
 * ". _ - /", narrowed by git's rules for a branch name: not starting with "-" or "/", not ending with "/" or ".", no
 * ".." and no "//", no part starting with "." or ending with ".lock".
 * @param {string} name
 * @returns {string | null}
 */
export function badName(name) {
  if (!name) return "a name is needed";
  if (name.length > NAME_MAX) return `at most ${NAME_MAX} characters`;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return "only letters, digits and . _ - /";
  if (/^[-/]/.test(name)) return `it cannot start with “${name[0]}”`;
  if (/[/.]$/.test(name)) return `it cannot end with “${name.at(-1)}”`;
  if (name.includes("..") || name.includes("//")) return `it cannot hold “${name.includes("..") ? ".." : "//"}”`;
  if (name.split("/").some((p) => p.startsWith(".") || p.endsWith(".lock"))) return "no part of it can start with “.” or end with “.lock”";
  if (name === "HEAD") return "git keeps that name for itself";
  return null;
}

/**
 * The folder a new worktree named `name` gets: `<main folder>-<name>` beside the main folder (GW-D45).
 * @param {string} main @param {string} name
 */
export const worktreeFolder = (main, name) => join(dirname(main), `${basename(main)}-${name.replace(/\//g, "-")}`);

/**
 * @typedef {{ ok: true, name: string, main: string, repo: string, here: string, place: string, branch: string | null,
 *   folder: string | null, cwd: string | null, from: { branch: string | null, head: string | null }, commit: string,
 *   uncommitted: number | null, bad: string | null, taken: "branch" | "folder" | null, free: string | null,
 *   refused: string | null, lacks: string | null } | { ok: false, error: string }} WorktreePlan  `place`: the top
 *   folder of the place it starts from, where its template is copied from (HarnessV4_Four_Plan FO-D33)
 */

/** Why a chat cannot work in the subfolder `lacks` of a new worktree, in words (GW-D50). @param {string} lacks */
export const lacksWords = (lacks) => `${lacks} is not in the commit the new worktree starts at, so it would not have that folder`;

/**
 * @typedef {{ ok: true, count: number | null } | { ok: false, error: string }} LeftBehind  `count` null where no
 *   worktree would be made: the folder is in no repository, or its branch has no commit yet; not ok where git could
 *   not tell, why in words
 */

/** The modes of a file a copy carries: none, or a plain file, executable or not (carry.js). A link or a submodule is neither. */
const PLAIN_MODES = new Set(["000000", "100644", "100755"]);
/** How many untracked files are looked at on disk at once, for the links among them. */
const LSTATS_AT_ONCE = 32;

/**
 * How many files a new worktree made from `folder` leaves behind in the place `folder` is in (GWC-103): the files a
 * flow's Bring my uncommitted edits would copy into it (carry.js `bringUncommitted`), no more and no fewer — each
 * plain file whose content in the working tree differs from the last commit's, and each untracked plain file git does
 * not ignore. A worktree starts at a commit, so none of them is in it. `count` null where none would be made, as
 * `ownWorktree` reads it: no git to ask, no repository above the folder, no commit yet. One `git status` that writes
 * nothing, read as the copy reads its snapshot: a rename is its two files; a change staged and undone in the working
 * tree is none; a link, a submodule or an embedded repository is none, as the copy leaves them. What the rows leave
 * open costs more: a file whose working tree alone may be the commit's — staged and changed again, in conflict, taken
 * out of the index and kept — is hashed as `add` would hash it and compared with the commit's; the untracked files
 * are looked at on disk, one lstat each, for the links among them; either needs the repository's top folder, one
 * `rev-parse` more.
 * @param {string} folder
 * @returns {Promise<LeftBehind>}
 */
export async function leftBehind(folder) {
  const st = await git([...NO_LOCKS, "status", "--porcelain=v2", "--branch", "--no-ahead-behind", "--no-renames", "-z", "--untracked-files=all"], { cwd: folder });
  if (st.code !== 0) {
    // No git to ask, or no repository above the folder: a box works in the folder, and nothing is left behind. Git
    // refusing the repository the folder is in, or not answering, is a failure, in words — in any language git speaks.
    if (st.error) return /^git is not installed/.test(st.error) ? { ok: true, count: null } : { ok: false, error: st.error };
    return gitAbove(folder) ? { ok: false, error: refusedWords(st) } : { ok: true, count: null };
  }
  const read = parsePorcelainV2(st.out);
  if (!read.branch.oid) return { ok: true, count: null };
  // The untracked files by path. An embedded repository is one entry with a slash at its end: the copy adds it as a
  // submodule, and leaves it.
  const untracked = new Set(read.files.filter((f) => f.kind === "untracked" && !f.path.endsWith("/")).map((f) => f.path));
  let count = 0;
  /** The files whose working tree may be the commit's, each with the commit's blob. @type {{ path: string, blob: string }[]} */
  const unsure = [];
  for (const f of read.files) {
    if (f.kind === "ignored" || f.kind === "untracked" || f.submodule) continue;
    if (!f.modes || !f.headBlob) {
      count += 1;
      continue;
    }
    // Taken out of the index and kept on disk, so untracked: the copy adds it back, and carries it where its content differs.
    if (f.modes.index === "000000" && untracked.has(f.path)) {
      untracked.delete(f.path);
      unsure.push({ path: f.path, blob: f.headBlob });
      continue;
    }
    // A link in the commit or in the working tree: the copy leaves it.
    if (!PLAIN_MODES.has(f.modes.head) || !PLAIN_MODES.has(f.modes.worktree)) continue;
    // Gone from the working tree. A conflicted row's columns name the conflict's sides (`UD`: deleted by them), not the
    // working tree, which its mode alone tells of.
    const gone = f.kind === "conflicted" ? f.modes.worktree === "000000" : f.worktree === "D" || f.modes.worktree === "000000";
    // Read as a rename, against the flag: its old name is gone from the working tree, its new one is new to the commit.
    if (f.oldPath) {
      count += gone ? 1 : 2;
      continue;
    }
    const inCommit = f.modes.head !== "000000";
    if (gone) {
      if (inCommit) count += 1;
      continue;
    }
    // The commit lacks it, or its mode changed; the working tree is the index's, which differs from the commit's; or
    // the index is the commit's, which the working tree differs from: it differs from the commit for sure. In conflict
    // the columns say nothing of the commit's: its content is read.
    if (!inCommit || f.modes.worktree !== f.modes.head || (f.kind !== "conflicted" && (f.worktree === " " || f.index === " "))) {
      count += 1;
      continue;
    }
    unsure.push({ path: f.path, blob: f.headBlob });
  }
  if (!untracked.size && !unsure.length) return { ok: true, count };
  // The paths are the repository's own, read at its top.
  const top = await git(["rev-parse", "--show-toplevel"], { cwd: folder });
  if (top.code !== 0 || !top.out) return { ok: false, error: firstLine(top.err || top.error || `git rev-parse exited ${top.code}`) };
  const root = top.out.split(/\r?\n/)[0];
  count += await plainFilesAmong(root, [...untracked]);
  if (!unsure.length) return { ok: true, count };
  const now = await blobsNow(root, unsure.map((u) => u.path));
  if (!now.ok) return now;
  // A path that is a link, or a folder, is none: the copy leaves it.
  const odd = new Set(now.odd);
  return { ok: true, count: count + unsure.filter((u) => !odd.has(u.path) && now.blobs.get(u.path) !== u.blob).length };
}

/**
 * How many of the paths are plain files on disk: a link, or anything else, the copy leaves; one gone since git listed
 * it is none. `LSTATS_AT_ONCE` at a time. @param {string} root @param {string[]} paths
 */
async function plainFilesAmong(root, paths) {
  let n = 0;
  for (let i = 0; i < paths.length; i += LSTATS_AT_ONCE) {
    const stats = await Promise.all(paths.slice(i, i + LSTATS_AT_ONCE).map((p) => lstat(join(root, p)).catch(() => null)));
    for (const s of stats) if (s?.isFile()) n += 1;
  }
  return n;
}

/**
 * A new worktree as a send would make it from `folder` (GW-D45), read now, made nowhere: its branch and folder, the
 * folder the chat would work in (the same place in it as `folder` in its own, GWC-117), the commit it starts at and
 * the branch that commit is on (GWC-104, GWC-105), how many uncommitted files stay behind in `here`, the place `folder`
 * is in (GWC-103). `bad`: why the name is no branch name (GWC-106); `taken`: "branch" or "folder", with the first free
 * name (GWC-48); `refused`: why Filament may not work in the new folder, as `refuse` says (GWC-107); `lacks`: the
 * subfolder `folder` is, where the commit holds no such folder — one git does not track (GW-D50, GWC-119). Not ok
 * where no worktree can start from `folder`.
 * @param {string} folder @param {string} name
 * @param {{ refuse?: (folder: string) => string | null }} [o]
 * @returns {Promise<WorktreePlan>}
 */
export async function planWorktree(folder, name, { refuse = () => null } = {}) {
  const wt = await worktreesOf(folder);
  if (!wt.ok) return { ok: false, error: wt.error || "not in a git repository" };
  if (!wt.main) return { ok: false, error: "a bare repository has no main folder to put a worktree beside" };
  const main = wt.main;
  const [at, commit, refs, left] = await Promise.all([
    placeInfo(folder),
    git(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { cwd: folder }),
    git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], { cwd: folder }),
    leftBehind(folder),
  ]);
  const uncommitted = left.ok ? left.count : null;
  if (!at.ok || !at.place) return { ok: false, error: at.error || "not in a git repository" };
  if (commit.code !== 0 || !commit.out) return { ok: false, error: "its branch has no commit yet: a worktree starts at a commit" };
  // Compared without case: on Windows a branch's file and its folder take no second name that differs only so.
  const branches = new Set(refs.code === 0 ? refs.out.split(/\r?\n/).filter(Boolean).map((b) => b.toLowerCase()) : []);
  /** @param {string} n */
  const takenBy = (n) => (branches.has(n.toLowerCase()) ? "branch" : existsSync(worktreeFolder(main, n)) ? "folder" : null);
  const bad = badName(name);
  const taken = bad ? null : takenBy(name);
  let free = null;
  for (let i = 2; taken && !free && i <= FREE_MAX; i++) if (!badName(`${name}-${i}`) && !takenBy(`${name}-${i}`)) free = `${name}-${i}`;
  const made = bad ? null : worktreeFolder(main, name);
  const id = commit.out.split(/\r?\n/)[0];
  // The folder as the filesystem spells it: the commit's paths are compared with their case.
  let real = resolve(folder);
  try {
    real = realpathSync.native(real);
  } catch {}
  const below = relative(at.place, real);
  const sub = below.replace(/\\/g, "/");
  const kind = sub ? await git(["cat-file", "-t", `${id}:${sub}`], { cwd: folder }) : null;
  const lacks = kind && !(kind.code === 0 && kind.out.trim() === "tree") ? sub : null;
  return {
    ok: true,
    name,
    main,
    repo: basename(main),
    here: basename(at.place),
    place: at.place,
    branch: bad ? null : name,
    folder: made,
    cwd: made && below ? join(made, below) : made,
    from: { branch: at.branch, head: at.head },
    commit: id,
    uncommitted,
    bad,
    taken,
    free,
    refused: made ? refuse(made) : null,
    lacks,
  };
}

/**
 * @typedef {{ ok: true, name: string, branch: string, folder: string, cwd: string, main: string, commit: string,
 *   place: string } | { ok: false, error: string, free?: string | null }} MadeWorktree  `place`: the one it was made
 *   from (`WorktreePlan`'s)
 */

/**
 * Make the worktree a chat's first send asked for (GW-D45): checked again as `planWorktree` reads it, then its branch
 * made at the commit `folder` is at, then the worktree checked out on it, without the repository's hooks (GW-D11). The
 * branch comes first so that two sends of one name cannot both have it (GWC-112): the second is refused, and only a
 * branch this call made is ever deleted. When the checkout fails, that branch is deleted; git takes back the folder it
 * began. `orFree`: the name is Filament's own, made from the message, so a taken one gives way to the first free one
 * (GW-D44). Refusals in words, with a free name where the name is taken.
 * @param {string} folder @param {string} name
 * @param {{ refuse?: (folder: string) => string | null, orFree?: boolean }} [o]
 * @returns {Promise<MadeWorktree>}
 */
export async function makeWorktree(folder, name, { refuse = () => null, orFree = false } = {}) {
  let plan = await planWorktree(folder, name, { refuse });
  if (plan.ok && plan.taken && orFree && plan.free) plan = await planWorktree(folder, (name = plan.free), { refuse });
  if (!plan.ok) return plan;
  if (plan.bad) return { ok: false, error: `“${name}” is no branch name: ${plan.bad}` };
  if (plan.taken || !plan.folder || !plan.cwd) {
    const what = plan.taken === "folder" ? `the folder ${plan.folder}` : `the branch ${name}`;
    return { ok: false, error: `${what} is there already${plan.free ? `; ${plan.free} is free` : ""}`, free: plan.free };
  }
  if (plan.refused) return { ok: false, error: plan.refused };
  if (plan.lacks) return { ok: false, error: lacksWords(plan.lacks) };
  const branch = await gitWithoutHooks(["branch", name, plan.commit], { cwd: plan.main });
  if (branch.code !== 0) return { ok: false, error: `git did not make the branch ${name}: ${firstLine(branch.err || branch.out || branch.error)}` };
  const add = await gitWithoutHooks(["worktree", "add", plan.folder, name], { cwd: plan.main, timeoutMs: CHECKOUT_MS });
  if (add.code !== 0) {
    const said = firstLine(add.err || add.out || add.error || `git worktree add exited ${add.code}`);
    const dropped = await gitWithoutHooks(["branch", "-D", name], { cwd: plan.main });
    const stays = dropped.code === 0 ? "" : `; the branch ${name} it made stays (${firstLine(dropped.err || dropped.error)})`;
    return { ok: false, error: `git did not make the worktree: ${said}${stays}` };
  }
  // The branch it was made from, beside git's record of it: what the places compare its branch with (the owner's of
  // 11-09). Not kept, the main folder's branch stands in.
  if (plan.from.branch) {
    const record = recordAt(plan.folder);
    try {
      if (record) writeFileSync(join(record, FROM_FILE), JSON.stringify({ branch: plan.from.branch }));
    } catch {}
  }
  return { ok: true, name, branch: name, folder: plan.folder, cwd: plan.cwd, main: plan.main, commit: plan.commit, place: plan.place };
}

/**
 * A worktree of its own for a flow's team box that writes (HarnessV4_OneAgent_Plan OA5): made from `folder` as a chat's
 * first send makes one (`makeWorktree`), its name the first free one from `name`. `outside`: why none can be — the
 * folder is in no git repository, or its repository has no commit yet — so the box works in the folder (OA-D13); any
 * other failure is refused in words.
 * @param {string} folder @param {string} name
 * @param {{ refuse?: (folder: string) => string | null }} [o]
 * @returns {Promise<MadeWorktree | { ok: false, outside: string } | { ok: false, error: string }>}
 */
export async function ownWorktree(folder, name, { refuse = () => null } = {}) {
  const wt = await worktreesOf(folder);
  // Only no repository, or no git to ask, is a reason to work in the folder: git refusing one is not.
  if (!wt.ok && /^(not in a git repository|git is not installed)/.test(String(wt.error))) return { ok: false, outside: "it is not in a git repository" };
  if (!wt.ok) return { ok: false, error: String(wt.error || "git could not read its repository") };
  const head = await git(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { cwd: folder });
  if (head.code !== 0 || !head.out) {
    // No commit yet is the one quiet no whose repository reads whole: a branch that points nowhere, or git timing out,
    // is refused in words, never a reason to change the person's folder (OA5-B6). rev-parse says both the same way;
    // rev-list over every ref does not.
    const all = head.code === 1 && !head.error ? await git(["rev-list", "-n1", "--all"], { cwd: folder }) : null;
    if (all && all.code === 0) return { ok: false, outside: "its git repository has no commit yet" };
    const said = all || head;
    return { ok: false, error: `git could not read its last commit: ${firstLine(said.err || said.error || said.out || `git exited ${said.code}`)}` };
  }
  return makeWorktree(folder, name, { refuse, orFree: true });
}

/**
 * Take back a worktree `makeWorktree` made for a session that was then not made (GW-D45), or for a chat's move that
 * failed or went back (HarnessV4_Git_Plan GW-D71, GW-D79): removed as Remove removes one (GW-D35), then its branch
 * deleted. Both are Filament's own. → what stays, in words, or null.
 * @param {{ main: string, folder: string, branch: string }} made
 * @returns {Promise<string | null>}
 */
export async function takeBack(made) {
  const gone = await removeWorktree(made.main, made.folder);
  if (!gone.ok) return `the worktree ${made.folder} stays: ${gone.error}`;
  const dropped = await gitWithoutHooks(["branch", "-D", made.branch], { cwd: made.main });
  return dropped.code === 0 ? null : `the branch ${made.branch} stays: ${firstLine(dropped.err || dropped.error)}`;
}

// ---- forks (the owner's of 11-09) -----------------------------------------------------------------------------------

/** Where what a fork held that its commit did not is kept as its chat is deleted. @param {string} chain */
export const forkKeptRef = (chain) => `refs/filament/forks/${refNameOf(chain)}/kept`;

/**
 * A fork's worktree marked as Filament's, for the chat it was made for (app/fork.js): beside git's record of it, which
 * goes with the worktree, so the fork is found by its chat once that chat is deleted and its row with it. `commit`: the
 * one it was checked out at. False where it could not be marked.
 * @param {string} path @param {{ chain: string, commit: string }} o
 */
export function markFork(path, { chain, commit }) {
  const record = recordAt(path);
  if (!record) return false;
  try {
    writeFileSync(join(record, FORK_FILE), JSON.stringify({ chain, commit, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {{ path: string, chain: string, commit: string | null, at: number | null, head: string | null,
 *   missing: boolean, locked: string | null, submodules: boolean }} Fork  a fork's worktree as `forksOf` reads it: the
 *   chat it was made for, the commit it was checked out at and when, the commit it is at now; `missing`, its folder is
 *   gone; `submodules`, submodules are checked out in it, their git folders in git's record of it
 */

/**
 * The forks' worktrees of the repository a folder is in: each worktree Filament marked for a chat's fork (`markFork`).
 * The developer's own, and Filament's helper copies, are none. No repository: answered in words.
 * @param {string} folder
 * @returns {Promise<{ ok: true, main: string | null, common: string, forks: Fork[] } | { ok: false, error: string }>}
 */
export async function forksOf(folder) {
  const wt = await worktreesOf(folder);
  if (!wt.ok || !wt.common) return { ok: false, error: String(wt.error || "not in a git repository") };
  /** @type {Fork[]} */
  const forks = [];
  for (const w of wt.worktrees) {
    if (w.main) continue;
    const record = recordAt(w.path, wt.common);
    const m = ownRecord(record, FORK_FILE);
    if (typeof m?.chain !== "string" || !m.chain) continue;
    forks.push({
      path: w.path,
      chain: m.chain,
      commit: typeof m.commit === "string" ? m.commit : null,
      at: Number(m.at) || null,
      head: w.head,
      missing: w.prunable !== null || !existsSync(w.path),
      locked: w.locked,
      submodules: !!record && existsSync(join(record, "modules")),
    });
  }
  return { ok: true, main: wt.main, common: wt.common, forks };
}

/**
 * Why a deleted chat's fork stays, in words; null where it may go (the owner's of 11-09, and its review): the first
 * that holds. Locked by someone; submodules checked out in it, whose git folders live in git's record of it, which its
 * removal drops (as Remove refuses them, `heldBack`); and — no sheet is shown, as Remove shows one — anyone who uses
 * its folder: its own chat still at work as it was deleted, another chat at work there, a project whose folder is in
 * it, another chat whose folder is in it or whose agents wrote there. It is never moved away under them.
 * @param {Fork} f
 * @param {{ chats?: { name: string, atWork: boolean }[], projects?: string[], own?: boolean }} [o]  `chats`: the chats
 *   in its folder (memory's `chatsIn`), each at work now or not; `projects`: the folders of the projects in it; `own`:
 *   its own chat is at work still
 * @returns {string | null}
 */
export function forkHeldBack(f, { chats = [], projects = [], own = false } = {}) {
  if (f.locked !== null) return f.locked ? `locked: ${f.locked}` : "locked";
  if (f.submodules) return "it holds submodules, whose git folders would go with it";
  if (own) return "its chat was still at work as it was deleted";
  const named = (/** @type {{ name: string }} */ c) => (c.name ? `“${c.name}”` : "an untitled chat");
  const working = chats.filter((c) => c.atWork);
  if (working.length) return working.length === 1 ? `${named(working[0])} works here now` : `${working.length} chats work here now`;
  if (projects.length) return projects.length === 1 ? `the project at ${projects[0]} is in it` : `${projects.length} projects are in it`;
  if (chats.length) return chats.length === 1 ? `${named(chats[0])} works in it` : `${chats.length} chats work in it`;
  return null;
}

/**
 * A fork's worktree goes, its chat deleted (the owner's of 11-09): what it holds that the commit it was checked out at
 * does not — edits, untracked files git does not ignore, commits made on it — kept first on `forkKeptRef`, so nothing is
 * lost, said in `kept`; then it is removed as Remove removes a worktree (`removeWorktree`): moved aside, git's record of
 * it dropped, the folder deleted, a link as a link, never followed. `ignored`: what git ignored there, which went with
 * it (`goesWith`), for the log to name, as no sheet did. One whose folder is gone has commits made on it kept, then
 * git's record of it dropped. One `forkHeldBack` keeps — locked, holding submodules — stays, and so does one whose
 * content could not be kept: why, in words. Who uses its folder is the caller's to ask (`forkHeldBack`), and `using`
 * asks it again once what it holds is kept — a snapshot can take a minute —, just before it moves: where that names
 * someone, it stays, `inUse`, what it held kept all the same (the review of 11-09).
 * @param {string} at  a folder of the repository's other than the fork: its main folder, or its git folder
 * @param {Fork} f
 * @param {{ using?: () => string | null }} [o]
 * @returns {Promise<{ ok: true, kept: string | null, left: string | null, ignored: Awaited<ReturnType<typeof goesWith>> } | { ok: false, error: string, inUse?: true }>}
 */
export async function removeFork(at, f, { using = () => null } = {}) {
  const held = forkHeldBack(f);
  if (held) return { ok: false, error: held };
  const ref = forkKeptRef(f.chain);
  /** @param {string} commit */
  const keepCommits = async (commit) => {
    const r = await git(["update-ref", ref, commit], { cwd: at });
    return r.code === 0 ? null : `the commits made on it could not be kept: ${firstLine(r.err || r.out || r.error)}`;
  };
  if (f.missing) {
    // What was uncommitted went with its folder; commits made on it are reached by nothing once git's record of it goes.
    const kept = f.head && f.head !== f.commit ? ref : null;
    const failed = kept && f.head ? await keepCommits(f.head) : null;
    if (failed) return { ok: false, error: failed };
    const r = await git(["worktree", "remove", f.path], { cwd: at });
    return r.code === 0 ? { ok: true, kept, left: null, ignored: null } : { ok: false, error: `git kept its record of the worktree: ${firstLine(r.err || r.out || r.error)}` };
  }
  const snap = await snapshotTree(f.path, { name: `fork-${f.chain}-kept`, ref, message: `Filament: fork ${f.chain}'s folder, kept as its chat was deleted` });
  if (!snap.ok) return { ok: false, error: `what it holds could not be kept: ${snap.error}` };
  /** @type {string | null} */
  let kept = snap.changed ? ref : null;
  // Nothing uncommitted, but commits made on it: they are kept, as nothing else reaches them once it goes.
  if (!kept && snap.at && f.commit && snap.at !== f.commit) {
    const failed = await keepCommits(snap.at);
    if (failed) return { ok: false, error: failed };
    kept = ref;
  }
  const ignored = await goesWith(f.path);
  const used = using();
  if (used) return { ok: false, error: used, inUse: true };
  const gone = await removeWorktree(at, f.path);
  if (!gone.ok) return gone;
  return { ok: true, kept, left: gone.left, ignored };
}
