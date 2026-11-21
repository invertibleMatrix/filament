// @ts-check
// Carrying a chat's own uncommitted files from one place to another (HarnessV4_Git_Plan §12, GW-D82): read-only
// questions — what a commit holds of each file, what each file in a working tree would be added as — and the two
// writes a move is made of: a place's files written as a snapshot holds them (`writeAs`), and a place's files put
// back to its last commit (`toLastCommit`). Both are git's own restore, so line endings, modes and binary files come
// out as a checkout makes them; no patch text is applied. A flow's new worktree takes a copy of its folder's
// uncommitted files the same way (`bringUncommitted`): the move's first write alone, the folder keeping its own. Paths
// are repository-relative with forward slashes, git's own spelling, and reach git literally (a name with `*` or `:` is
// a name). Answered in words, never thrown.
import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { NO_LOCKS, parsePorcelainV2 } from "./inspect.js";
import { firstLine, git, snapshotTree } from "./snapshot.js";

/** Every path a git call names is a name, never a pattern. */
const LITERAL = Object.freeze({ GIT_LITERAL_PATHSPECS: "1" });
/** The modes of what a copy carries: no file, or a plain one, executable or not. A link or a submodule is none. */
const PLAIN_MODES = new Set(["000000", "100644", "100755"]);
/** The paths one git call names at most: a long list goes in parts, under Windows' command-line limit. */
const PATHS_PER_CALL = 100;
/**
 * The most one `cat-file --batch-check` may answer, in bytes: well under the runner's 8 MB cap on what git says (the bug
 * hunt of 10-30: a long chat's questions of every snapshot, in one call, passed it and refused the move's read).
 */
const BATCH_ANSWER_BYTES = 4 * 1024 * 1024;
/** The most git answers one question with: its id, type and size, or the question itself and ` missing`. @param {string} q */
const answerBytes = (q) => Math.max(Buffer.byteLength(q) + 10, 100);

/** @template T @param {T[]} list @returns {T[][]} */
const parts = (list) => {
  /** @type {T[][]} */
  const out = [];
  for (let i = 0; i < list.length; i += PATHS_PER_CALL) out.push(list.slice(i, i + PATHS_PER_CALL));
  return out;
};

/**
 * The blob each path has in a commit; null where it has none there (no such file, or not a file).
 * @param {string} place  the top folder of a repository or worktree @param {string} rev @param {string[]} paths
 * @returns {Promise<{ ok: true, blobs: Map<string, string | null> } | { ok: false, error: string }>}
 */
export async function blobsAt(place, rev, paths) {
  /** @type {Map<string, string | null>} */
  const blobs = new Map(paths.map((p) => [p, null]));
  for (const part of parts(paths)) {
    const r = await git(["ls-tree", "-r", "-z", "--full-tree", rev, "--", ...part], { cwd: place, env: LITERAL });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git ls-tree exited ${r.code}`) };
    for (const row of r.out.split("\0")) {
      const m = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(row);
      if (m && blobs.has(m[2])) blobs.set(m[2], m[1]);
    }
  }
  return { ok: true, blobs };
}

/**
 * The blob each path has in each of many commits, in one git call (`cat-file --batch-check`): a long chat's move read
 * asked `ls-tree` once per snapshot its rounds took, two hundred git processes and more, one after another (the owner's
 * of 10-30: the sheet's read took 50 s). Null where a commit has no file at the path — no such file, not a file, or no
 * such commit — as `blobsAt` says it. A path a line of git's batch cannot name (a line break in it) is read by its
 * commit's own `blobsAt`.
 * @param {string} place  the top folder of a repository or worktree @param {Map<string, string[]>} asks  each commit with its paths
 * @returns {Promise<{ ok: true, held: Map<string, Map<string, string | null>> } | { ok: false, error: string }>}
 */
export async function blobsAtEach(place, asks) {
  /** @type {Map<string, Map<string, string | null>>} */
  const held = new Map();
  /** @type {[string, string][]} */
  const lines = [];
  for (const [rev, paths] of asks) {
    held.set(rev, new Map(paths.map((p) => [p, null])));
    const odd = paths.filter((p) => /[\r\n]/.test(p));
    for (const p of paths) if (!odd.includes(p)) lines.push([rev, p]);
    if (!odd.length) continue;
    const at = await blobsAt(place, rev, odd);
    if (!at.ok) return at;
    for (const [p, b] of at.blobs) held.get(rev)?.set(p, b);
  }
  if (!lines.length) return { ok: true, held };
  // In parts whose answers fit what one call may say (`BATCH_ANSWER_BYTES`): a handful of calls for the longest chat.
  /** @type {[string, string][][]} */
  const batches = [[]];
  let bytes = 0;
  for (const line of lines) {
    const size = answerBytes(`${line[0]}:${line[1]}`);
    if (bytes + size > BATCH_ANSWER_BYTES && batches[batches.length - 1].length) {
      batches.push([]);
      bytes = 0;
    }
    batches[batches.length - 1].push(line);
    bytes += size;
  }
  for (const batch of batches) {
    const r = await git(["cat-file", "--batch-check", "--buffer"], { cwd: place, input: batch.map(([rev, p]) => `${rev}:${p}\n`).join("") });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git cat-file exited ${r.code}`) };
    // One answer a line, in the order asked: `<id> <type> <size>`, else the question with `missing` (or `ambiguous`).
    const answers = r.out.split(/\r?\n/);
    if (answers.length !== batch.length) return { ok: false, error: "git cat-file answered for fewer paths than it was asked" };
    batch.forEach(([rev, p], i) => {
      const m = /^([0-9a-f]{40,64}) (\S+) \d+$/.exec(answers[i]);
      if (m && m[2] === "blob") held.get(rev)?.set(p, m[1]);
    });
  }
  return { ok: true, held };
}

/**
 * What each path's file in a working tree would be added as (its clean filters applied, as a snapshot's `add` does);
 * null where there is no file. `odd`: a path that is a folder, a link or anything but a plain file, which no move
 * carries.
 * @param {string} place @param {string[]} paths
 * @returns {Promise<{ ok: true, blobs: Map<string, string | null>, odd: string[] } | { ok: false, error: string }>}
 */
export async function blobsNow(place, paths) {
  /** @type {Map<string, string | null>} */
  const blobs = new Map(paths.map((p) => [p, null]));
  /** @type {string[]} */
  const odd = [];
  /** @type {string[]} */
  const files = [];
  for (const p of paths) {
    let st = null;
    try {
      st = lstatSync(join(place, p));
    } catch {}
    if (!st) continue;
    if (st.isFile()) files.push(p);
    else odd.push(p);
  }
  for (const part of parts(files)) {
    const r = await git(["hash-object", "--", ...part], { cwd: place });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git hash-object exited ${r.code}`) };
    const ids = r.out.split(/\r?\n/).filter(Boolean);
    if (ids.length !== part.length) return { ok: false, error: "git hash-object answered for fewer files than it was asked" };
    part.forEach((p, i) => blobs.set(p, ids[i]));
  }
  return { ok: true, blobs, odd };
}

/**
 * The paths a place's index holds.
 * @param {string} place @param {string[]} paths
 * @returns {Promise<{ ok: true, tracked: Set<string> } | { ok: false, error: string }>}
 */
async function inIndex(place, paths) {
  const tracked = new Set();
  for (const part of parts(paths)) {
    const r = await git(["ls-files", "-z", "--", ...part], { cwd: place, env: LITERAL });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git ls-files exited ${r.code}`) };
    for (const p of r.out.split("\0")) if (p) tracked.add(p);
  }
  return { ok: true, tracked };
}

/**
 * A file deleted, and the folders it leaves empty up to the place's top. @param {string} place @param {string} path
 */
function removeFile(place, path) {
  const top = resolve(place);
  const abs = join(top, path);
  if (existsSync(abs)) unlinkSync(abs);
  for (let dir = dirname(abs); dir.startsWith(top + sep); dir = dirname(dir)) {
    try {
      if (readdirSync(dir).length) break;
      rmdirSync(dir);
    } catch {
      break;
    }
  }
}

/**
 * Write each path's file in a place's working tree as `rev` holds it: from its blob there, or deleted where `rev` has
 * none. The index is left as it is, so what was the last commit's stays so and the rest shows as uncommitted. Deleted
 * first: a file that became a folder, or a name whose case alone changed where the disk ignores case, is in the way of
 * the one written.
 * @param {string} place @param {string} rev @param {string[]} paths
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function writeAs(place, rev, paths) {
  const at = await blobsAt(place, rev, paths);
  if (!at.ok) return at;
  try {
    for (const p of paths) if (!at.blobs.get(p)) removeFile(place, p);
  } catch (/** @type {any} */ e) {
    return { ok: false, error: firstLine(e?.message || String(e)) };
  }
  const present = paths.filter((p) => at.blobs.get(p));
  for (const part of parts(present)) {
    const r = await git(["restore", `--source=${rev}`, "--worktree", "--", ...part], { cwd: place, env: LITERAL });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git restore exited ${r.code}`) };
  }
  return { ok: true };
}

/**
 * Put each path in a place back to its last commit, the index with it: a file the commit holds as it holds it, one it
 * does not removed from the index and the folder.
 * @param {string} place @param {string[]} paths
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function toLastCommit(place, paths) {
  const [head, idx] = await Promise.all([blobsAt(place, "HEAD", paths), inIndex(place, paths)]);
  if (!head.ok) return head;
  if (!idx.ok) return idx;
  // git restores what HEAD or the index names; a file neither names is git's to no one, and is deleted here.
  const known = paths.filter((p) => head.blobs.get(p) || idx.tracked.has(p));
  for (const part of parts(known)) {
    const r = await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...part], { cwd: place, env: LITERAL });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git restore exited ${r.code}`) };
  }
  try {
    for (const p of paths) if (!head.blobs.get(p) && !idx.tracked.has(p)) removeFile(place, p);
  } catch (/** @type {any} */ e) {
    return { ok: false, error: firstLine(e?.message || String(e)) };
  }
  return { ok: true };
}

/**
 * The paths a place has anything uncommitted on: staged, changed, untracked or in conflict (an ignored file is not).
 * @param {string} place @param {string[]} paths
 * @returns {Promise<{ ok: true, dirty: string[] } | { ok: false, error: string }>}
 */
export async function dirtyOf(place, paths) {
  const want = new Set(paths);
  /** @type {Set<string>} */
  const dirty = new Set();
  for (const part of parts(paths)) {
    const r = await git([...NO_LOCKS, "status", "--porcelain=v2", "-z", "--untracked-files=all", "--", ...part], { cwd: place, env: LITERAL });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git status exited ${r.code}`) };
    for (const f of parsePorcelainV2(r.out).files) {
      if (f.kind === "ignored") continue;
      for (const p of [f.path, f.oldPath]) if (p && want.has(p)) dirty.add(p);
    }
  }
  return { ok: true, dirty: paths.filter((p) => dirty.has(p)) };
}

/**
 * A copy of a folder's uncommitted files in a new worktree of its repository (HarnessV4_OneAgent_Plan OA5, a flow's
 * Bring my uncommitted edits): each file `from` has uncommitted — changed, added, deleted, and untracked where git does
 * not ignore it — written into `to` as it stands in `from`, and left uncommitted there. Read from a snapshot of `from`
 * kept by no ref, so `from`'s files, its index and its refs stay as they are; written by `writeAs`, so `to`'s index stays
 * at its commit and what `from` staged comes out unstaged. Plain files alone, as a move carries them: a link or a
 * submodule that differs stays, named in `stays`.
 * @param {string} from  the top folder the worktree was made from @param {string} to  the new worktree's top folder
 * @param {string} base  the commit `to` was made at: `from`'s last
 * @returns {Promise<{ ok: true, files: string[], stays: string[] } | { ok: false, error: string }>}
 */
export async function bringUncommitted(from, to, base) {
  const snap = await snapshotTree(from, { name: "bring", previous: base, keep: false, message: "Filament: the folder's uncommitted files, for a new worktree" });
  if (!snap.ok) return { ok: false, error: `its folder could not be snapshotted: ${snap.error}` };
  if (!snap.changed || !snap.commit) return { ok: true, files: [], stays: [] };
  const d = await git(["diff-tree", "-r", "-z", "--no-renames", base, snap.commit], { cwd: from });
  if (d.code !== 0) return { ok: false, error: firstLine(d.err || d.error || `git diff-tree exited ${d.code}`) };
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const stays = [];
  // `-z`: each change its `:<old mode> <new mode> <old id> <new id> <status>` field, then its path's.
  const fields = d.out.split("\0");
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) /.exec(fields[i]);
    if (!m || !fields[i + 1]) return { ok: false, error: "git diff-tree answered in a form Filament does not read" };
    (PLAIN_MODES.has(m[1]) && PLAIN_MODES.has(m[2]) ? files : stays).push(fields[i + 1]);
  }
  if (!files.length) return { ok: true, files, stays };
  const wrote = await writeAs(to, snap.commit, files);
  return wrote.ok ? { ok: true, files, stays } : wrote;
}
