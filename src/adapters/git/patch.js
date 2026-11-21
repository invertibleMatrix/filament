// @ts-check
// A builder's patch workspace (the owner's plan of 11-09 for big repos, Phase 1). A worktree of a big repository takes
// minutes and gigabytes to check out for each builder; most of them read a few hundred files and change a dozen. A patch
// is no checkout: a real folder at the place its worktree would take — `<git common dir>/filament-worktrees/<id>` — that
// holds only the files the builder read or wrote, each copied up from the commit it is laid over (`readFrom`) as a
// builder's checkout would write it (`cat-file --filters`: line endings; the files Git LFS keeps as their pointers, a
// read fetching one as a worktree's does, `fetchPatchLfs`). Its file tools (adapters/tools/patch-hands.js) read
// the overlay first, then that commit, so the builder sees the whole project at the same paths. Its record is kept beside
// the copies, `<home>/.patches/<id>.json`, out of their names; the copies' reconcile, trim and Clean up never read it
// as a copy (worktree.js `patchRecorded`). Each exchange's end captures it as a commit on its agent's refs, as a worktree's
// is — a temporary index read from `readFrom`, the overlay's files added from it as the work tree, what git ignores left
// out — and the overlay stays, parked, for its next question. What only a checkout can do (a command, a language server,
// a hook) moves it to a worktree at the same place first: its work captured, the overlay set aside, a copy taken at the
// capture, what git ignores in the overlay copied in (`promotePatch`). Launching one costs a ref and a folder.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { firstLine, git, repoOf, snapshotTree } from "./snapshot.js";
import {
  PATCH_RECORDS, SKIP_LFS, TASK_HOME, TASK_REF_PREFIX, batchSnapshot, changedFiles, commonDirOf, copiesOwner, diffTaskWork, fetchLfsAt, forgetTaskWorktree, gitBytes, holdHome, noCopyOf, othersLive, outsideWords,
  takeTaskWorktree,
} from "./worktree.js";

/**
 * Filament's record of a patch workspace: who holds it (as a copy's record says), its agent, the commit its work is
 * measured against (`base`) and the one its overlay is laid over (`readFrom`), when it was last used, its state — `busy`
 * while an exchange works in it, `parked` between them —, the newest capture it holds (`captured`), and `unsaved` where
 * its work could not be kept on its refs.
 * @typedef {{ owner: string, home?: string, agent: string, base: string, readFrom: string, at: number, state: "busy" | "parked", captured?: string, unsaved?: { error: string, at: number } }} PatchRecord
 */
/**
 * A patch workspace, shaped as a worktree is (worktree.js `TaskWorktree`) where the registry reads one: `dest` its top
 * folder (the repository's top's counterpart), `workdir` the session folder's counterpart inside it, `base` what its
 * work is measured against — and `kind` "patch", `readFrom` the commit its overlay is laid over, `rel` the session
 * folder's path from the repository's top ("" at the top), `gitDir` the repository's git folder.
 * @typedef {{ kind: "patch", repo: string, dest: string, workdir: string, base: string, linked: string[], readFrom: string, rel: string, gitDir: string }} PatchWorkspace
 */

/** The most a file copied up may hold: past it a read says it is too big, as a worktree's read of it would. */
export const COPY_UP_MAX = 64 * 1024 * 1024;
/** What a capture's message names. */
const WORK_MESSAGE = (/** @type {string} */ id) => `Filament: sub-agent ${id}'s work`;
/** git reads every path it is given as a literal, never a pathspec's pattern. */
const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };
/**
 * Every git that writes a temporary index writes it whole: never a split index, whose shared part would land in the
 * repository's git folder.
 */
const UNSPLIT = ["-c", "core.splitIndex=false"];
/** @param {string} home @param {string} id */
const recordFile = (home, id) => join(home, PATCH_RECORDS, `${id}.json`);
/** A copy's place for a move's aside, out of the copies' names (they start with no dot). @param {string} home @param {string} id */
const movingOf = (home, id) => join(home, `.patch-${id}.moving`);

/** The patch workspaces this process works in now, by folder: a reconcile never captures one under its exchange. @type {Set<string>} */
const inUse = new Set();
/** @param {string} dest */
const useKey = (dest) => (process.platform === "win32" ? resolve(dest).toLowerCase() : resolve(dest));
/**
 * Each patch workspace's file tools at work in its overlay now, and its move under way, by folder (the review of
 * d65a984a9): its tools go side by side, and a move waits for them, then holds the overlay alone — a read's copy-up
 * never lands in a folder set aside, nor makes one where its copy goes. @type {Map<string, { ops: number, idle: (() => void)[], moving: Promise<void> | null }>}
 */
const turns = new Map();
/** @param {string} key */
const turnOf = (key) => {
  let t = turns.get(key);
  if (!t) turns.set(key, (t = { ops: 0, idle: [], moving: null }));
  return t;
};
/** @param {string} key @param {{ ops: number, moving: Promise<void> | null }} t */
const turnOver = (key, t) => {
  if (!t.ops && !t.moving && turns.get(key) === t) turns.delete(key);
};
/**
 * `fn` at work in a patch workspace's overlay — a file tool's, beside the others there —, once a move under way is over.
 * @template T @param {{ dest: string }} ws @param {() => Promise<T>} fn @returns {Promise<T>}
 */
export async function inOverlay(ws, fn) {
  const key = useKey(ws.dest);
  for (let t = turns.get(key); t?.moving; t = turns.get(key)) await t.moving;
  const t = turnOf(key);
  t.ops++;
  try {
    return await fn();
  } finally {
    t.ops--;
    if (!t.ops) for (const go of t.idle.splice(0)) go();
    turnOver(key, t);
  }
}
/**
 * `fn` holding a patch workspace's overlay alone: once the file tools at work in it are done, and none starts until it
 * is over. @template T @param {{ dest: string }} ws @param {() => Promise<T>} fn @returns {Promise<T>}
 */
async function aloneIn(ws, fn) {
  const key = useKey(ws.dest);
  for (let t = turns.get(key); t?.moving; t = turns.get(key)) await t.moving;
  const t = turnOf(key);
  /** @type {() => void} */
  let over = () => {};
  t.moving = new Promise((r) => (over = () => r()));
  try {
    if (t.ops) await new Promise((r) => t.idle.push(() => r(undefined)));
    return await fn();
  } finally {
    t.moving = null;
    over();
    turnOver(key, t);
  }
}

/**
 * Filament's record of `id`'s patch workspace in a repository's home; null where there is none, or it does not read.
 * @param {string} home @param {string} id @returns {PatchRecord | null}
 */
export function patchRecordOf(home, id) {
  try {
    const r = JSON.parse(readFileSync(recordFile(home, id), "utf8"));
    return r && typeof r.base === "string" && typeof r.readFrom === "string" ? r : null;
  } catch {
    return null;
  }
}
/**
 * Whether the folder at `dest` is sub-agent `id`'s patch workspace still — its place and its record —, as a copy's
 * record says it is its own (worktree.js `copyHeldBy`): a patch let go with its chat, or moved to a worktree, holds
 * none of it there as a patch.
 * @param {string | null | undefined} dest @param {string} id
 */
export const patchHeldBy = (dest, id) => !!dest && basename(dest) === id && existsSync(recordFile(dirname(dest), id)) && existsSync(dest);
/**
 * A patch's record, written whole (a reader finds the old record or the new one), naming this Filament.
 * @param {string} home @param {string} id @param {Omit<PatchRecord, "owner" | "home">} rec
 */
function writeRecord(home, id, rec) {
  mkdirSync(join(home, PATCH_RECORDS), { recursive: true });
  const file = recordFile(home, id);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...rec, ...copiesOwner() }));
  renameSync(tmp, file);
}
/** @param {string} home @param {string} id */
const dropRecord = (home, id) => rmSync(recordFile(home, id), { force: true });
/** @param {PatchWorkspace} ws */
const homeOf = (ws) => dirname(ws.dest);
/** @param {PatchWorkspace} ws */
const idOf = (ws) => ws.dest.slice(homeOf(ws).length + 1);

/** A file (never a link, never a folder) stands at `p`. @param {string} p */
const fileAt = (p) => {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Where `abs` is in a patch workspace, as a path from the repository's top with forward slashes; null where it lies
 * outside the workspace (an added folder, a linked dependency folder of the developer's).
 * @param {PatchWorkspace} ws @param {string} abs
 */
export function relOf(ws, abs) {
  const r = relative(ws.dest, resolve(abs));
  if (r === "") return "";
  if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) return null;
  return r.split(sep).join("/");
}
/** The overlay's path of a path from the repository's top. @param {PatchWorkspace} ws @param {string} rel */
const overlayPath = (ws, rel) => (rel ? join(ws.dest, ...rel.split("/")) : ws.dest);

/**
 * The entries of `readFrom` at the paths asked, by path: each one's mode, type, blob or tree, and size (a blob's).
 * `recursive`: every file under the paths, for a search or a listing.
 * @param {PatchWorkspace} ws @param {readonly string[]} paths @param {{ recursive?: boolean, signal?: AbortSignal | null }} [o]
 * @returns {Promise<Map<string, { mode: string, type: string, sha: string, size: number }>>}
 */
export async function entriesOf(ws, paths, { recursive = false, signal = null } = {}) {
  /** @type {Map<string, { mode: string, type: string, sha: string, size: number }>} */
  const out = new Map();
  const asked = [...new Set(paths.map((p) => p || "."))];
  // A long list goes in parts, inside what a command line takes.
  for (let at = 0; at < asked.length; ) {
    const part = [];
    let chars = 0;
    while (at < asked.length && (part.length === 0 || chars + asked[at].length < 8000)) {
      chars += asked[at].length + 1;
      part.push(asked[at++]);
    }
    const r = await gitBytes(["ls-tree", "-z", "-l", ...(recursive ? ["-r"] : []), "--full-tree", ws.readFrom, "--", ...part], { cwd: ws.repo, env: LITERAL, signal });
    if (r.code !== 0) throw new Error(`git could not read the project's files (${firstLine(r.err) || `exit ${r.code}`})`);
    for (const rec of r.out.toString("utf8").split("\0")) {
      const tab = rec.indexOf("\t");
      if (tab < 0) continue;
      const [mode, type, sha, size] = rec.slice(0, tab).split(/\s+/);
      out.set(rec.slice(tab + 1), { mode, type, sha, size: Number(size) || 0 });
    }
  }
  return out;
}

/**
 * What a path is in a patch workspace, copied up where it is a file of `readFrom` the overlay does not hold yet (as a
 * builder's checkout writes it: its line endings, its executable bit, a file Git LFS keeps as its pointer — a read
 * fetches it, `fetchPatchLfs`, refusing one past its cap from the pointer's size before anything is fetched, as a
 * worktree's read does; smudged here, its size went unread and the object whole through memory). `file` — at `rel` (a
 * link followed to the file it names inside the project); `folder` — a folder or a submodule; `big` — a file past
 * `COPY_UP_MAX`, its size; `none` — nothing there.
 * @param {PatchWorkspace} ws @param {string} rel
 * @returns {Promise<{ kind: "file", rel: string } | { kind: "folder" } | { kind: "big", size: number } | { kind: "none" } | { kind: "link", target: string }>}
 */
export async function copyUp(ws, rel, depth = 0) {
  const abs = overlayPath(ws, rel);
  if (fileAt(abs)) return { kind: "file", rel };
  const e = (await entriesOf(ws, [rel])).get(rel);
  if (!e) return { kind: "none" };
  if (e.type !== "blob" || e.mode === "160000") return { kind: "folder" };
  if (e.mode === "120000") {
    const target = (await gitBytes(["cat-file", "blob", e.sha], { cwd: ws.repo })).out.toString("utf8");
    const to = posix.normalize(posix.join(posix.dirname(rel), target));
    if (depth > 8 || posix.isAbsolute(target) || to === ".." || to.startsWith("../")) return { kind: "link", target };
    const got = await copyUp(ws, to, depth + 1);
    return got.kind === "none" || got.kind === "folder" ? { kind: "link", target } : got;
  }
  if (e.size > COPY_UP_MAX) return { kind: "big", size: e.size };
  const b = await gitBytes([...SKIP_LFS, "cat-file", "--filters", `--path=${rel}`, e.sha], { cwd: ws.repo });
  if (b.code !== 0) throw new Error(`git could not read ${rel} (${firstLine(b.err) || `exit ${b.code}`})`);
  place(abs, b.out, e.mode);
  return { kind: "file", rel };
}
/**
 * A file copied up into the overlay — never over one already there: two reads of one file side by side, the second
 * finds the first's. @param {string} abs @param {Buffer} bytes @param {string} mode
 */
const place = (abs, bytes, mode) => {
  mkdirSync(dirname(abs), { recursive: true });
  try {
    writeFileSync(abs, bytes, { flag: "wx" });
  } catch (/** @type {any} */ e) {
    if (e?.code !== "EEXIST") throw e;
    return;
  }
  if (mode === "100755" && process.platform !== "win32") chmodSync(abs, 0o755);
};

/**
 * Many files of `readFrom` copied up at once, for a search: a temporary index of those files alone, checked out into
 * the overlay by `git checkout-index` — as a builder's checkout writes them, its filters, line endings and executable
 * bit, the files Git LFS keeps as their pointers (a search of a few may match thousands, never smudged). Those the
 * overlay holds already are passed over (never written over), as is a file past `COPY_UP_MAX` or a link. How many came
 * up; one git could not write is said in its words.
 * @param {PatchWorkspace} ws @param {readonly string[]} rels @param {Map<string, { mode: string, type: string, sha: string, size: number }>} entries
 * @param {{ signal?: AbortSignal | null }} [o]
 */
export async function copyUpMany(ws, rels, entries, { signal = null } = {}) {
  const want = rels.filter((r) => {
    const e = entries.get(r);
    return e && e.type === "blob" && (e.mode === "100644" || e.mode === "100755") && e.size <= COPY_UP_MAX && !fileAt(overlayPath(ws, r));
  });
  if (!want.length) return 0;
  const tmp = mkdtempSync(join(tmpdir(), "filament-patch-up-"));
  try {
    const env = { GIT_INDEX_FILE: join(tmp, "index"), GIT_DIR: ws.gitDir, GIT_WORK_TREE: ws.dest };
    const info = want.map((r) => {
      const e = /** @type {{ mode: string, sha: string }} */ (entries.get(r));
      return `${e.mode} ${e.sha}\t${r}\0`;
    });
    const ui = await gitBytes([...UNSPLIT, "update-index", "--add", "-z", "--index-info"], { cwd: ws.dest, env, input: Buffer.from(info.join(""), "utf8"), signal });
    if (ui.code !== 0) throw new Error(`git could not read the project's files (${firstLine(ui.err) || `exit ${ui.code}`})`);
    // A file another read copied up meanwhile stays as it is: git says so and goes on with the rest.
    const co = await gitBytes([...SKIP_LFS, "checkout-index", "-z", "--stdin"], { cwd: ws.dest, env, input: Buffer.from(want.map((r) => `${r}\0`).join(""), "utf8"), signal });
    const up = want.filter((r) => fileAt(overlayPath(ws, r))).length;
    if (co.code !== 0 && up < want.length) throw new Error(`git could not copy up the project's files (${firstLine(co.err) || `exit ${co.code}`})`);
    return up;
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * The file at `abs`, copied up into a patch workspace as its Git LFS pointer, fetched in place as a worktree's read
 * fetches it (worktree.js `fetchLfsFile`): only where its bytes are its pointer as `readFrom` has it, and as git reads
 * it back. The read hand asks it once it read the pointer's size under its cap (hands.js `opRead`).
 * @param {PatchWorkspace} ws @param {string} abs
 * @returns {Promise<{ ok: true } | { ok: false, lfs: boolean, error: string }>}
 */
export async function fetchPatchLfs(ws, abs) {
  const rel = relOf(ws, abs);
  if (!rel) return { ok: false, lfs: false, error: "" };
  return fetchLfsAt(ws.repo, rel, abs, async () => (await entriesOf(ws, [rel])).get(rel)?.sha || "");
}

/**
 * The files the overlay holds, as paths from the repository's top, sorted: links are passed over (never followed), and
 * so is a `.git` of its own.
 * @param {PatchWorkspace | { dest: string }} ws @param {string} [under]  a folder of it, from the top
 */
export function overlayFiles(ws, under = "") {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ dir, /** @type {string} */ rel) => {
    /** @type {import("node:fs").Dirent[]} */
    let list = [];
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of list) {
      if (d.name === ".git" || d.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(dir, d.name), r);
      else if (d.isFile()) out.push(r);
    }
  };
  walk(under ? join(ws.dest, ...under.split("/")) : ws.dest, under);
  return out.sort();
}

/** The repository's git folder, for git run with the overlay as its work tree. @param {string} repo */
const gitDirOf = async (repo) => {
  const r = await git(["rev-parse", "--absolute-git-dir"], { cwd: repo });
  return r.code === 0 && r.out ? r.out : null;
};

/**
 * Open a builder's patch workspace (the owner's plan of 11-09): the working tree captured as its base, as a worktree's
 * launch captures it (HEAD itself when nothing differs), and a folder made at its copy's place — no checkout. `allowed`
 * vets the place (the loop's folder rule). Not made, why and of which kind, as a worktree's (`NoCopy`).
 * @param {string} folder  the session's folder
 * `batch`: the launches asked with it, whose snapshot it shares while that is being taken (worktree.js `batchSnapshot`).
 * @param {{ id: string, allowed?: (path: string) => boolean, signal?: AbortSignal | null, batch?: string | null }} o
 * @returns {Promise<{ ok: true, wt: PatchWorkspace } | import("./worktree.js").NoCopy>}
 */
export async function openPatch(folder, { id, allowed = () => true, signal = null, batch = null }) {
  const found = await repoOf(folder);
  if (!found.repo) return noCopyOf(found.error);
  if (!found.head) return noCopyOf("the repository has no commit yet");
  const repo = found.repo;
  const common = await commonDirOf(repo);
  const gitDir = await gitDirOf(repo);
  if (!common || !gitDir) return { ok: false, error: "git could not name the repository's git folder", kind: "failed" };
  const home = join(common, TASK_HOME);
  const dest = join(home, id);
  if (!allowed(dest)) return { ok: false, error: outsideWords(dest), kind: "failed" };
  if (existsSync(dest)) return { ok: false, error: "a folder stands where its workspace goes", kind: "failed" };
  const ref = `${TASK_REF_PREFIX}${id}/base`;
  const snap = batch
    ? await batchSnapshot(repo, batch, id, signal)
    : await snapshotTree(repo, { name: `subagent-${id}-base`, ref, message: `Filament: the working tree when sub-agent ${id} started`, signal });
  if (!snap.ok) return { ok: false, error: signal?.aborted ? "it was stopped while its workspace was made" : snap.error || "the working tree could not be captured", kind: "failed" };
  const base = snap.commit || found.head;
  if (batch || !snap.commit) {
    const ur = await git(["update-ref", ref, base], { cwd: repo });
    if (ur.code !== 0) return { ok: false, error: `git update-ref failed: ${firstLine(ur.err || ur.out || ur.error)}`, kind: "failed" };
  }
  return made(folder, { repo, home, gitDir, id, base, readFrom: base, captured: base });
}

/**
 * A patch workspace's folder and record, at work: `readFrom` the commit its overlay lies over.
 * @param {string} folder @param {{ repo: string, home: string, gitDir: string, id: string, base: string, readFrom: string, captured: string }} o
 * @returns {{ ok: true, wt: PatchWorkspace } | { ok: false, error: string, kind: "failed" }}
 */
function made(folder, { repo, home, gitDir, id, base, readFrom, captured }) {
  const dest = join(home, id);
  const r = relative(repo, resolve(folder));
  const rel = r && !r.startsWith("..") ? r.split(sep).join("/") : "";
  const workdir = rel ? join(dest, ...rel.split("/")) : dest;
  try {
    mkdirSync(workdir, { recursive: true });
    holdHome(home);
    writeRecord(home, id, { agent: id, base, readFrom, at: Date.now(), state: "busy", captured });
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `its workspace could not be made (${firstLine(e?.message)})`, kind: "failed" };
  }
  inUse.add(useKey(dest));
  return { ok: true, wt: { kind: "patch", repo, dest, workdir, base, linked: [], readFrom, rel, gitDir } };
}

/**
 * A sub-agent's newest work in its patch workspace again, for its next question: its overlay as it stands where it
 * holds that work (`captured` is `head`), else emptied and laid over `head` — an apply, a send back or a capture since
 * moved its work on. One whose work could not be kept on its refs is refused, as its copy would be.
 * @param {string} folder @param {{ id: string, base: string, head: string, allowed?: (path: string) => boolean }} o
 * @returns {Promise<{ ok: true, wt: PatchWorkspace } | { ok: false, error: string }>}
 */
export async function revivePatch(folder, { id, base, head, allowed = () => true }) {
  const found = await repoOf(folder);
  if (!found.repo) return { ok: false, error: found.error };
  const repo = found.repo;
  const common = await commonDirOf(repo);
  const gitDir = await gitDirOf(repo);
  if (!common || !gitDir) return { ok: false, error: "git could not name the repository's git folder" };
  const home = join(common, TASK_HOME);
  const dest = join(home, id);
  if (!allowed(dest)) return { ok: false, error: outsideWords(dest) };
  const rec = patchRecordOf(home, id);
  if (rec && othersLive(home, rec.owner)) return { ok: false, error: "its workspace is held by another Filament that works in this repository" };
  if (rec?.unsaved) return { ok: false, error: `its workspace holds work that could not be kept on its refs (${rec.unsaved.error}): it stays as it is until that can be done` };
  const holds = !!rec && rec.captured === head && existsSync(dest);
  if (!holds) {
    try {
      await rm(dest, { recursive: true, force: true });
    } catch (/** @type {any} */ e) {
      return { ok: false, error: `its workspace could not be emptied (${firstLine(e?.message)})` };
    }
  }
  const r = made(folder, { repo, home, gitDir, id, base, readFrom: holds && rec ? rec.readFrom : head, captured: head });
  return r.ok ? r : { ok: false, error: r.error };
}

/**
 * The tree the overlay makes over `readFrom`: a temporary index read from it, then every file of the overlay added from
 * it as the work tree — one git tracks there as it stands, one it does not unless git ignores it (the `.gitignore` of
 * each folder on its way copied up first, so git reads its rules) — and written as a tree. Never the repository's index.
 * @param {PatchWorkspace} ws @param {{ signal?: AbortSignal | null }} [o]
 * @returns {Promise<{ ok: true, tree: string } | { ok: false, error: string }>}
 */
async function treeOf(ws, { signal = null } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "filament-patch-"));
  try {
    const index = { GIT_INDEX_FILE: join(tmp, "index") };
    // Paths on standard input are read as paths already (check-ignore refuses the literal magic).
    const here = { ...index, GIT_DIR: ws.gitDir, GIT_WORK_TREE: ws.dest };
    const said = (/** @type {{ code: number, err: string }} */ r, /** @type {string} */ what) => `git ${what} failed: ${firstLine(r.err) || `exit ${r.code}`}`;
    const rt = await gitBytes([...UNSPLIT, "read-tree", ws.readFrom], { cwd: ws.repo, env: index, signal });
    if (rt.code !== 0) return { ok: false, error: said(rt, "read-tree") };
    let files = overlayFiles(ws);
    if (files.length) {
      // What git ignores is read from the .gitignore of each folder on a file's way: those the overlay lacks come up first.
      const dirs = new Set([""]);
      for (const f of files) for (let d = posix.dirname(f); d !== "." && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
      const rules = [...dirs].map((d) => (d ? `${d}/.gitignore` : ".gitignore"));
      const at = await entriesOf(ws, rules, { signal });
      for (const g of rules) if (at.has(g) && !fileAt(overlayPath(ws, g))) await copyUp(ws, g);
      files = overlayFiles(ws);
      const ci = await gitBytes(["check-ignore", "-z", "--stdin"], { cwd: ws.dest, env: here, input: Buffer.from(files.map((f) => `${f}\0`).join(""), "utf8"), signal });
      if (ci.code !== 0 && ci.code !== 1) return { ok: false, error: said(ci, "check-ignore") };
      const ignored = new Set(ci.out.toString("utf8").split("\0").filter(Boolean));
      const same = await unchangedOf(ws, files.filter((f) => !ignored.has(f)), signal);
      const kept = files.filter((f) => !ignored.has(f) && !same.has(f));
      if (kept.length) {
        const ui = await gitBytes([...UNSPLIT, "update-index", "--add", "-z", "--stdin"], { cwd: ws.dest, env: here, input: Buffer.from(kept.map((f) => `${f}\0`).join(""), "utf8"), signal });
        if (ui.code !== 0) return { ok: false, error: said(ui, "update-index") };
      }
    }
    const wt = await gitBytes([...UNSPLIT, "write-tree"], { cwd: ws.repo, env: index, signal });
    if (wt.code !== 0) return { ok: false, error: said(wt, "write-tree") };
    return { ok: true, tree: wt.out.toString("utf8").trim() };
  } catch (/** @type {any} */ e) {
    return { ok: false, error: firstLine(e?.message || String(e)) };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * The overlay's files whose bytes, as they stand, are their blob at `readFrom` — copied up and never changed, a Git LFS
 * pointer among them —, which the temporary index holds already: git's filters never run on them again (a required
 * git-lfs this machine lacks failed the capture on a pointer the builder only read).
 * @param {PatchWorkspace} ws @param {readonly string[]} files @param {AbortSignal | null} signal
 */
async function unchangedOf(ws, files, signal) {
  /** @type {Set<string>} */
  const out = new Set();
  if (!files.length) return out;
  const at = await entriesOf(ws, files, { signal });
  for (const f of files) {
    const e = at.get(f);
    if (!e || e.type !== "blob" || (e.mode !== "100644" && e.mode !== "100755")) continue;
    try {
      const abs = overlayPath(ws, f);
      const st = statSync(abs);
      if (st.size !== e.size || (process.platform !== "win32" && (e.mode === "100755") !== ((st.mode & 0o100) !== 0))) continue;
      const bytes = readFileSync(abs);
      if (createHash(e.sha.length === 64 ? "sha256" : "sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === e.sha) out.add(f);
    } catch {}
  }
  return out;
}

/**
 * The overlay as a commit over `previous || base`, where its tree differs from that one's; else that one itself.
 * @param {PatchWorkspace} ws @param {{ id: string, parent: string, message: string, signal?: AbortSignal | null }} o
 * @returns {Promise<{ ok: true, head: string } | { ok: false, error: string }>}
 */
async function commitOf(ws, { parent, message, signal = null }) {
  const t = await treeOf(ws, { signal });
  if (!t.ok) return t;
  const pt = await git(["rev-parse", "--verify", "-q", `${parent}^{tree}`], { cwd: ws.repo, signal });
  if (pt.code === 0 && pt.out === t.tree) return { ok: true, head: parent };
  const ct = await git(["commit-tree", t.tree, "-p", parent, "-m", message], { cwd: ws.repo, signal });
  if (ct.code !== 0 || !ct.out) return { ok: false, error: `git commit-tree failed: ${firstLine(ct.err || ct.out || ct.error)}` };
  return { ok: true, head: ct.out };
}

/**
 * Capture a patch workspace as its sub-agent's newest work (`…/work`), measured against `base` — whose ref is written
 * again too, as a worktree's capture does (worktree.js `captureTaskWork`); its record then holds that capture.
 * @param {PatchWorkspace} ws @param {{ id: string, previous?: string | null, base?: string, signal?: AbortSignal | null }} o
 * @returns {Promise<{ ok: true, head: string, files: import("./worktree.js").ChangedFile[] } | { ok: false, error: string }>}
 */
export async function capturePatch(ws, { id, previous = null, base = ws.base, signal = null }) {
  // A move a failure left set aside goes back first: what stands at its place is no overlay of its (the review of
  // d65a984a9: a capture of that wrote a commit without its work over its refs).
  if (existsSync(movingOf(homeOf(ws), id))) {
    const s = await settleMove(ws.repo, homeOf(ws), id);
    if (s !== "back") return { ok: false, error: s === "moved" ? "its workspace moved to a worktree" : `its workspace is set aside at ${movingOf(homeOf(ws), id)}, and could not be put back` };
  }
  const c = await commitOf(ws, { id, parent: previous || base, message: WORK_MESSAGE(id), signal });
  if (!c.ok) return c;
  for (const [name, at] of [[`${TASK_REF_PREFIX}${id}/work`, c.head], [`${TASK_REF_PREFIX}${id}/base`, base]]) {
    const ur = await git(["update-ref", name, at], { cwd: ws.repo });
    if (ur.code !== 0) return { ok: false, error: `git update-ref failed: ${firstLine(ur.err || ur.out || ur.error)}` };
  }
  const rec = patchRecordOf(homeOf(ws), id);
  if (rec) writeRecord(homeOf(ws), id, { ...withoutUnsaved(rec), captured: c.head, at: Date.now() });
  return { ok: true, head: c.head, files: await changedFiles(ws.repo, base, c.head) };
}
/** @param {PatchRecord} rec */
const withoutUnsaved = (rec) => {
  const { unsaved: _, owner: _o, home: _h, ...rest } = rec;
  return rest;
};

/**
 * A running builder's change so far (HarnessV3-TaskGraph-v2 TG2-D17), as a worktree's (worktree.js `taskWorkSoFar`):
 * its overlay over its base, as a commit under no ref — its refs and record untouched —, never read under its move.
 * @param {PatchWorkspace} ws @param {{ id: string, previous?: string | null }} o
 * @returns {Promise<{ ok: true, files: import("./worktree.js").ChangedFile[], diff: string } | { ok: false, error: string }>}
 */
export async function patchSoFar(ws, { id, previous = null }) {
  const c = await inOverlay(ws, () => commitOf(ws, { id, parent: previous || ws.base, message: `Filament: sub-agent ${id}'s work so far` }));
  if (!c.ok) return { ok: false, error: c.error || "its work could not be read" };
  return { ok: true, files: await changedFiles(ws.repo, ws.base, c.head), diff: await diffTaskWork(ws.repo, ws.base, c.head) };
}

/**
 * A patch workspace's folder as the Changes tab reads a place (inspect.js `placeChanges`), where `dest` is one: it is no
 * work tree to ask git's status of (the review of d65a984a9: its place said "not in a git repository"), so its files are
 * what its overlay changes over the commit it is laid over — as a worktree's uncommitted files are what it changed over
 * the commit it was checked out at —, its HEAD that commit, detached; its repository's main folder as git lists it.
 * Never read under its move. Null where `dest` is no patch workspace.
 * @param {string} dest
 * @returns {Promise<(import("./inspect.js").PlaceInfo & { headAt: number | null, files: import("../../core/changes-view.js").PlaceFile[] }) | null>}
 */
export async function patchPlace(dest) {
  const home = dirname(resolve(dest));
  const id = basename(resolve(dest));
  const rec = patchRecordOf(home, id);
  if (!rec || !existsSync(dest)) return null;
  // Git reads the repository from its git folder, whose copies' home this is.
  const common = dirname(home);
  /** @type {PatchWorkspace} */
  const ws = { kind: "patch", repo: common, dest: resolve(dest), workdir: resolve(dest), base: rec.base, linked: [], readFrom: rec.readFrom, rel: "", gitDir: common };
  const t = await inOverlay(ws, () => treeOf(ws));
  const changed = t.ok ? await changedFiles(common, rec.readFrom, t.tree).catch(() => null) : null;
  const listed = await git(["worktree", "list", "--porcelain"], { cwd: common });
  const main = /^worktree (.+)$/m.exec(listed.out || "")?.[1] || null;
  /** @type {import("../../core/changes-view.js").PlaceFile[]} */
  const files = (changed || []).map((f) => ({ path: f.path, oldPath: null, status: f.status === "A" ? "A" : f.status === "D" ? "D" : "M", added: f.binary ? null : f.added, removed: f.binary ? null : f.removed, binary: f.binary, untracked: false }));
  return {
    ok: true,
    cwd: dest,
    place: ws.dest,
    worktree: true,
    main,
    branch: null,
    detached: true,
    head: rec.readFrom.slice(0, 7),
    error: changed ? null : `its files could not be read (${t.ok ? "git could not compare them" : t.error})`,
    base: null,
    onBase: false,
    ahead: null,
    behind: null,
    uncommitted: changed ? { files: files.length, added: files.reduce((n, f) => n + (f.added || 0), 0), removed: files.reduce((n, f) => n + (f.removed || 0), 0) } : null,
    headAt: null,
    files,
  };
}

/**
 * The files a capture's work changes that the overlay lacks, copied up — laid over its newer work once an apply, a send
 * back or a capture moved it on (`revivePatch`), it holds only what was touched since, and `readFrom` has the rest as
 * that work has it —, so its folder holds
 * its version of each at its path, as a worktree's does: the Changes page opens it there. Never over one there; how
 * many came up.
 * @param {PatchWorkspace} ws @param {readonly import("./worktree.js").ChangedFile[]} files  its capture's
 */
export async function holdWork(ws, files) {
  const rels = files.filter((f) => f.status !== "D" && !fileAt(overlayPath(ws, f.path))).map((f) => f.path);
  return rels.length ? copyUpMany(ws, rels, await entriesOf(ws, rels)) : 0;
}

/**
 * A patch workspace given back at its exchange's end, its work captured: parked as it stands, for its next question.
 * @param {PatchWorkspace} ws
 */
export function parkPatch(ws) {
  inUse.delete(useKey(ws.dest));
  const rec = patchRecordOf(homeOf(ws), idOf(ws));
  if (rec) writeRecord(homeOf(ws), idOf(ws), { ...withoutUnsaved(rec), state: "parked", at: Date.now() });
}
/**
 * A patch workspace whose work could not be captured at its exchange's end, nor on a second try: it stays busy, its
 * record saying why and since when, as a copy's (worktree.js `markUnsaved`).
 * @param {PatchWorkspace} ws @param {string} error
 */
export function markPatchUnsaved(ws, error) {
  const rec = patchRecordOf(homeOf(ws), idOf(ws));
  if (!rec) return false;
  writeRecord(homeOf(ws), idOf(ws), { ...withoutUnsaved(rec), unsaved: { error: String(error), at: rec.unsaved?.at || Date.now() } });
  return true;
}

/**
 * A patch workspace moves to a worktree at the same place (the owner's plan of 11-09): what only a checkout can do — a
 * command, a language server, a hook — needs one. Its work is captured first (a capture that fails moves nothing: the
 * overlay stays, marked unsaved); the overlay is set aside, out of the copies' names; a copy of `kind` is taken at the
 * capture (`takeTaskWorktree`) — a sparse one's cone holding, beside `paths` and what it changed, the folders of the
 * files the overlay holds: what it read —, the files Git LFS keeps as their pointers, as a builder's copy holds them
 * (a check's whole checkout of them took minutes and gigabytes, and failed where an object was not here); what the
 * overlay held that the copy lacks — what git ignores, a build's output — is copied in, and so is the content of a
 * pointer it fetched; the overlay goes, and so does its record. It waits for its file tools at work in the overlay, and
 * holds it alone (`aloneIn`). A taking that fails puts the overlay back where it was, its record with it, what the
 * taking left at its place gone first — and so does the next move, or the next capture, where that could not be done
 * (`settleMove`). `changed`: how many files its work changes.
 * @param {PatchWorkspace} ws @param {string} folder  the session's folder
 * @param {{ id: string, previous?: string | null, base?: string, allowed?: (path: string) => boolean, keep?: ReadonlySet<string>, signal?: AbortSignal | null, kind?: import("./worktree.js").CopyKind, paths?: readonly string[] }} o
 * @returns {Promise<{ ok: true, wt: import("./worktree.js").TaskWorktree, head: string, files: import("./worktree.js").ChangedFile[] } | { ok: false, error: string, unsaved?: true }>}
 */
export function promotePatch(ws, folder, { id, previous = null, base = ws.base, allowed = () => true, keep = new Set(), signal = null, kind = "worktree", paths = [] }) {
  return aloneIn(ws, async () => {
    const home = homeOf(ws);
    const moving = movingOf(home, id);
    if (existsSync(moving) && (await settleMove(ws.repo, home, id)) !== "back") return { ok: false, error: `a move of it is left set aside at ${moving}, and could not be put back` };
    const cap = await capturePatch(ws, { id, previous, base, signal });
    if (!cap.ok) {
      markPatchUnsaved(ws, cap.error);
      return { ok: false, error: `its work could not be kept first (${cap.error})`, unsaved: true };
    }
    const reach = kind === "sparse" ? [...paths, ...overlayFiles(ws)] : paths;
    try {
      renameSync(ws.dest, moving);
    } catch (/** @type {any} */ e) {
      return { ok: false, error: /^(EPERM|EBUSY|EACCES)$/.test(String(e?.code)) ? `a program is using its folder (${e.code})` : `its folder could not be set aside (${firstLine(e?.message)})` };
    }
    const took = await takeTaskWorktree(folder, { id, commit: cap.head, base, allowed, keep, signal, kind, paths: reach, lfs: "pointers" });
    if (!took.ok) {
      await settleMove(ws.repo, home, id, { made: false });
      return { ok: false, error: took.error };
    }
    await copyInto(moving, took.wt.dest);
    inUse.delete(useKey(ws.dest));
    dropRecord(home, id);
    await rm(moving, { recursive: true, force: true }).catch(() => {});
    return { ok: true, wt: took.wt, head: cap.head, files: cap.files };
  });
}
/**
 * A move of `id`'s overlay set aside, put right (the review of d65a984a9): where its copy was made — a checkout at its
 * place —, the move is finished: what the overlay held that the copy lacks copied in, the patch gone ("moved"); else
 * what a taking left at its place goes — a checkout cut halfway, and git's record of it — and the overlay goes back
 * ("back"); "stuck" where it could not. `made` false: its taking failed, so whatever stands at its place is its leftover.
 * @param {string} repo @param {string} home @param {string} id @param {{ made?: boolean }} [o]
 * @returns {Promise<"moved" | "back" | "stuck">}
 */
async function settleMove(repo, home, id, { made = true } = {}) {
  const moving = movingOf(home, id);
  const dest = join(home, id);
  if (made && existsSync(join(dest, ".git"))) {
    await copyInto(moving, dest);
    dropRecord(home, id);
    await rm(moving, { recursive: true, force: true }).catch(() => {});
    return "moved";
  }
  if (existsSync(dest)) await forgetTaskWorktree(repo, dest);
  try {
    renameSync(moving, dest);
    return "back";
  } catch {
    return "stuck";
  }
}
/**
 * What a set-aside overlay holds that the copy made from its capture lacks — what git ignores — copied in at the same
 * places; a link is never followed, and nothing else the copy has is written over: only a Git LFS pointer the overlay
 * held fetched, its content copied over it where git reads that as the copy's own file — no fetch twice.
 * @param {string} from @param {string} to
 */
async function copyInto(from, to) {
  /** @type {string[]} */
  const fetched = [];
  for (const f of overlayFiles({ dest: from })) {
    const at = join(to, ...f.split("/"));
    const src = join(from, ...f.split("/"));
    if (existsSync(at)) {
      if (lfsPointerAt(at) && !lfsPointerAt(src)) fetched.push(f);
      continue;
    }
    try {
      mkdirSync(dirname(at), { recursive: true });
      copyFileSync(src, at);
      if (process.platform !== "win32") chmodSync(at, statSync(src).mode & 0o777);
    } catch {}
  }
  for (const f of fetched) {
    const src = join(from, ...f.split("/"));
    const blob = await git(["rev-parse", "--verify", "-q", `HEAD:${f}`], { cwd: to });
    const back = await gitBytes(["hash-object", `--path=${f}`, "--", src], { cwd: to });
    if (blob.code !== 0 || back.code !== 0 || back.out.toString("utf8").trim() !== blob.out) continue;
    try {
      copyFileSync(src, join(to, ...f.split("/")));
    } catch {}
  }
}
/** A Git LFS pointer stands at `p`: a file under 1 KB that starts as one. @param {string} p */
const lfsPointerAt = (p) => {
  try {
    return statSync(p).size < 1024 && readFileSync(p, "latin1").startsWith("version https://git-lfs.github.com/spec/v1\n");
  } catch {
    return false;
  }
};

/**
 * A patch workspace that keeps nothing goes (one that runs in a copy, AG-7): its folder and record, nothing captured.
 * @param {PatchWorkspace} ws
 */
export async function dropPatch(ws) {
  inUse.delete(useKey(ws.dest));
  await rm(ws.dest, { recursive: true, force: true });
  dropRecord(homeOf(ws), idOf(ws));
}

/** Where a repository's home keeps its cards' launches in patches, for rule 10 (workspace-kind.js). */
const MOVES_FILE = "moves";
/** How many of a card's launches are kept. */
const MOVES_KEPT = 10;
/**
 * A card's newest launches in patches in this repository, newest last: how many calls each made before it moved to a
 * worktree, null where it never did.
 * @param {string} home @param {string} card @returns {(number | null)[]}
 */
export function movesOf(home, card) {
  try {
    const all = JSON.parse(readFileSync(join(home, PATCH_RECORDS, MOVES_FILE), "utf8"));
    const list = all && Array.isArray(all[card]) ? all[card] : [];
    return list.map((/** @type {any} */ n) => {
      const calls = n && typeof n === "object" ? n.calls : n;
      return typeof calls === "number" && calls >= 0 ? calls : null;
    });
  } catch {
    return [];
  }
}
/**
 * One launch of a card in a patch, counted: `calls` before it moved to a worktree, null where it has not. `id`, its
 * sub-agent's: a launch counted as not moved — at an exchange's end — is counted again in its place once it moves, on a
 * later exchange or after a restart (the review of d65a984a9: rule 10 never saw a move after the first exchange);
 * counted again as not moved, or once moved, it stays as it is.
 * @param {string} home @param {string} card @param {number | null} calls @param {string | null} [id]
 */
export function noteMove(home, card, calls, id = null) {
  const file = join(home, PATCH_RECORDS, MOVES_FILE);
  /** @type {Record<string, (number | null | { id: string, calls: number | null })[]>} */
  let all = {};
  try {
    const read = JSON.parse(readFileSync(file, "utf8"));
    if (read && typeof read === "object" && !Array.isArray(read)) all = read;
  } catch {}
  const list = Array.isArray(all[card]) ? all[card] : [];
  const at = id ? list.findIndex((n) => !!n && typeof n === "object" && n.id === id) : -1;
  if (at >= 0) {
    const was = /** @type {{ id: string, calls: number | null }} */ (list[at]);
    if (calls == null || was.calls != null) return;
    list[at] = { id: was.id, calls };
  } else list.push(id ? { id, calls } : calls);
  all[card] = list.slice(-MOVES_KEPT);
  try {
    mkdirSync(join(home, PATCH_RECORDS), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, file);
  } catch {}
}

/**
 * A deleted chat's helper's patch workspace lets go (worktree.js `letGoTaskWork`): what it holds kept on its refs, then
 * its folder and its record go. One another living Filament holds, or one this process works in, stays.
 * @param {string} repo @param {string} home @param {string} id
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function letGoPatch(repo, home, id) {
  const dest = join(home, id);
  const rec = patchRecordOf(home, id);
  if (inUse.has(useKey(dest))) return { ok: false, error: "in use now" };
  if (rec && othersLive(home, rec.owner)) return { ok: false, error: "another Filament that works in this repository holds it" };
  if (rec && existsSync(dest)) {
    const kept = await keepPatchWork(repo, home, id, rec);
    if (!kept.ok) return { ok: false, error: `its work could not be kept on its refs (${kept.error})` };
  }
  try {
    await rm(dest, { recursive: true, force: true });
  } catch (/** @type {any} */ e) {
    return { ok: false, error: `its folder could not be removed (${firstLine(e?.message)})` };
  }
  dropRecord(home, id);
  return { ok: true };
}

/**
 * What a patch workspace holds onto its agent's refs, measured against its refs' base, else its record's.
 * @param {string} repo @param {string} home @param {string} id @param {PatchRecord} rec
 */
async function keepPatchWork(repo, home, id, rec) {
  const gitDir = await gitDirOf(repo);
  if (!gitDir) return { ok: false, error: "git could not name the repository's git folder" };
  const ref = async (/** @type {string} */ leaf) => {
    const r = await git(["rev-parse", "--verify", "-q", `${TASK_REF_PREFIX}${id}/${leaf}^{commit}`], { cwd: repo });
    return r.code === 0 && r.out ? r.out : null;
  };
  const base = (await ref("base")) || rec.base;
  /** @type {PatchWorkspace} */
  const ws = { kind: "patch", repo, dest: join(home, id), workdir: join(home, id), base, linked: [], readFrom: rec.readFrom, rel: "", gitDir };
  const cap = await capturePatch(ws, { id, previous: (await ref("work")) || null, base });
  return cap.ok ? { ok: true, error: "" } : { ok: false, error: cap.error };
}

/**
 * The patch workspaces a crash left at work in a repository's home, put right as its copies are (worktree.js
 * `reconcile`): one busy that this process does not work in, `keep` does not name and no other living Filament holds
 * has what it holds kept on its agent's refs and is parked — where that fails it stays busy, its record saying why. A
 * move a crash cut is finished: its overlay put back where no copy was made — what the taking left at its place gone
 * first —, or let go where one was (`settleMove`).
 * @param {string} repo @param {string} home @param {ReadonlySet<string>} keep
 */
export async function keepOrphanPatches(repo, home, keep) {
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(join(home, PATCH_RECORDS)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  } catch {
    return;
  }
  for (const id of names) {
    const dest = join(home, id);
    const rec = patchRecordOf(home, id);
    if (!rec || keep.has(id) || inUse.has(useKey(dest)) || othersLive(home, rec.owner)) continue;
    if (existsSync(movingOf(home, id)) && (await settleMove(repo, home, id)) !== "back") continue;
    if (rec.state !== "busy" || !existsSync(dest)) continue;
    const kept = await keepPatchWork(repo, home, id, rec);
    const now = patchRecordOf(home, id) || rec;
    if (kept.ok) writeRecord(home, id, { ...withoutUnsaved(now), state: "parked", at: rec.at || Date.now() });
    else writeRecord(home, id, { ...withoutUnsaved(now), unsaved: { error: kept.error, at: rec.unsaved?.at || Date.now() } });
  }
}
